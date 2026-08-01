/**
 * VoltForge — time-domain simulation engine.
 *
 * Fixed-step piecewise-linear (PWL) state-space simulation of the switched
 * converter, integrated with semi-implicit (symplectic) Euler. Each topology
 * is preloaded at its analytic steady-state operating point (inductor current
 * and cap voltage from averaged-model math) so it settles within a handful of
 * switching periods; we then record >= 6 periods for waveform display and
 * ripple extraction.
 *
 * Real switched dynamics: sync-buck (and plain buck, simulated synchronous),
 * boost, interleaved-sync-buck (2 phases, 180 deg), dab (series-inductor
 * power-transfer waveform, phase shift solved from the classic DAB power
 * equation), totem-pole-pfc (one line half-cycle, averaged current-loop model
 * at reduced sample density).
 *
 * llc / psfb / flyback / forward-active-clamp return operating-point-math
 * approximations (marked "approximate" in notes).
 */

import type {
  DesignSpec,
  SimulationResult,
  TopologyId,
  WaveformTrace,
} from "@/lib/types";
import { clamp } from "@/lib/util";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI;

/** Square wave in cycle units: sq(0..0.5) = +1, sq(0.5..1) = -1. */
function sq(cycles: number): 1 | -1 {
  return (((cycles % 1) + 1) % 1) < 0.5 ? 1 : -1;
}

/**
 * Output-cap-bank ESR model: bank of ~10 µF / 5 mΩ ceramic units in parallel,
 * so ESR scales inversely with total capacitance (esr = 50e-9 / C ohm).
 */
function bankEsrOhm(cF: number): number {
  return 5e-8 / cF;
}

function trace(name: string, unit: string, t: number[], v: number[]): WaveformTrace {
  return { name, unit, t, v };
}

/** Peak-peak of v over the trailing window of width windowS. */
function ppOverLastWindow(t: number[], v: number[], windowS: number): number {
  const nEnd = t.length - 1;
  if (nEnd < 0) return 0;
  const tStart = t[nEnd] - windowS;
  let mx = -Infinity;
  let mn = Infinity;
  for (let i = nEnd; i >= 0 && t[i] >= tStart - 1e-15; i--) {
    if (v[i] > mx) mx = v[i];
    if (v[i] < mn) mn = v[i];
  }
  return mx - mn;
}

function checkInputs(spec: DesignSpec, fswHz: number, lH: number, cF: number): void {
  if (!(fswHz > 0) || !(lH > 0) || !(cF > 0)) {
    throw new Error(`simulate: fsw/L/C must be > 0 (got fsw=${fswHz} Hz, L=${lH} H, C=${cF} F)`);
  }
  if (!(spec.voutV > 0) || !(spec.poutW > 0) || !(spec.vinNomV > 0)) {
    throw new Error("simulate: spec.vinNomV, voutV and poutW must be > 0");
  }
}

/** Gaussian elimination with partial pivoting (n <= 3 here). */
function solveLinear(m: number[][], b: number[]): number[] | undefined {
  const n = b.length;
  const a = m.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return undefined;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / a[i][i]);
}

/**
 * Exact periodic steady state of a switched-linear converter. The one-period
 * map of a PWL circuit on a fixed time grid is affine, x' = A·x + b, so the
 * periodic orbit is the fixed point x* = (I − A)⁻¹·b — solved here by probing
 * the map (monodromy shooting). Falls back to plain settling if (I − A) is
 * near-singular (an undamped state).
 */
function periodicSteadyState(map: (x: number[]) => number[], x0: number[]): number[] {
  const n = x0.length;
  const f0 = map(x0);
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    const d = 0.01 * (1 + Math.abs(x0[j])); // map is affine: any probe size works
    const xp = x0.slice();
    xp[j] += d;
    const fj = map(xp);
    for (let i = 0; i < n; i++) A[i][j] = (fj[i] - f0[i]) / d;
  }
  const m: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - A[i][j]),
  );
  const b = f0.map((fi, i) => fi - A[i].reduce((s, aij, j) => s + aij * x0[j], 0));
  const xs = solveLinear(m, b);
  if (xs && xs.every(Number.isFinite)) return xs;
  let x = f0;
  for (let k = 0; k < 200; k++) x = map(x); // fallback: brute-force settle
  return x;
}

// ---------------------------------------------------------------------------
// Buck-family PWL core (sync-buck, interleaved, and buck-equivalent stages)
// ---------------------------------------------------------------------------

interface BuckCoreResult {
  t: number[];
  vout: number[];
  /** Per-phase inductor currents. */
  iPh: number[][];
  iTot: number[];
  /** Phase-0 switch-node voltage. */
  vsw: number[];
  dtS: number;
  dutyEff: number;
}

/**
 * Synchronous buck PWL state-space: nPhases inductors into a common output
 * cap, phases evenly interleaved. Duty = vout/vin with a small feed-forward
 * trim compensating the modelled DCR droop, so the open-loop mean lands on
 * the target. Semi-implicit Euler (iL updated first, then vC sees new iL).
 */
function buckCore(
  vinV: number,
  voutV: number,
  poutW: number,
  fswHz: number,
  lH: number,
  cF: number,
  nPhases: number,
  spp: number,
  settlePeriods: number,
  recordPeriods: number,
): BuckCoreResult {
  const R = (voutV * voutV) / poutW;
  const esr = bankEsrOhm(cF);
  // Per-phase DCR sized for ~0.5 % total droop, then trimmed out of the duty.
  const rL = 0.005 * R * nPhases;
  const D = clamp((voutV * 1.005) / vinV, 0.02, 0.98);

  const T = 1 / fswHz;
  const dt = T / spp;
  const iOutPh = poutW / voutV / nPhases;
  const dIl = (voutV * (1 - D)) / (lH * fswHz); // per-phase pk-pk ripple

  // Analytic steady-state preload: triangle value at each phase's position.
  const triangleAt = (x: number): number =>
    x < D
      ? iOutPh - dIl / 2 + dIl * (x / D)
      : iOutPh + dIl / 2 - dIl * ((x - D) / (1 - D));

  const t: number[] = [];
  const vo: number[] = [];
  const vsw: number[] = [];
  const iPh: number[][] = Array.from({ length: nPhases }, () => []);
  const iTot: number[] = [];

  // State vector: [iL_0 .. iL_{nPhases-1}, vC]. One-period map (affine).
  const onePeriod = (x0: number[], record: boolean, tBaseS = 0): number[] => {
    const s = x0.slice();
    for (let k = 0; k < spp; k++) {
      const cyc = k / spp;
      let iSum = 0;
      let sw0 = false;
      for (let p = 0; p < nPhases; p++) {
        const xph = (cyc + p / nPhases) % 1;
        const on = xph < D;
        if (p === 0) sw0 = on;
        const vNode = on ? vinV : 0;
        s[p] += (dt * (vNode - s[nPhases] - s[p] * rL)) / lH;
        iSum += s[p];
      }
      const v = (s[nPhases] + esr * iSum) / (1 + esr / R);
      s[nPhases] += (dt * (iSum - v / R)) / cF;
      if (record) {
        t.push(tBaseS + k * dt);
        vo.push(v);
        vsw.push(sw0 ? vinV : 0);
        for (let p = 0; p < nPhases; p++) iPh[p].push(s[p]);
        iTot.push(iSum);
      }
    }
    return s;
  };

  // Analytic preload -> exact periodic orbit via affine period-map shooting.
  const preload: number[] = [];
  for (let p = 0; p < nPhases; p++) preload.push(triangleAt(p / nPhases));
  preload.push(voutV);
  let x = periodicSteadyState((y) => onePeriod(y, false), preload);
  for (let i = 0; i < settlePeriods; i++) x = onePeriod(x, false);
  for (let i = 0; i < recordPeriods; i++) x = onePeriod(x, true, i * T);
  return { t, vout: vo, iPh, iTot, vsw, dtS: dt, dutyEff: D };
}

// ---------------------------------------------------------------------------
// Rectified-current core for the approximated topologies (llc, flyback)
// ---------------------------------------------------------------------------

interface RectCoreResult {
  t: number[];
  vout: number[];
  ipri: number[];
  isec: number[];
}

/**
 * Integrates the output cap against an analytically constructed secondary
 * (rectified) current waveform: dvC/dt = (isec - vout/R)/C. Used by the
 * approximate topologies where only operating-point math is available.
 */
function rectCore(
  fswHz: number,
  cF: number,
  R: number,
  voutV: number,
  spp: number,
  settlePeriods: number,
  recordPeriods: number,
  ipriAt: (x: number) => number,
  isecAt: (x: number) => number,
): RectCoreResult {
  const dt = 1 / fswHz / spp;
  let vC = voutV;
  const totalSteps = (settlePeriods + recordPeriods) * spp;
  const recStart = settlePeriods * spp;
  const t: number[] = [];
  const vo: number[] = [];
  const ipri: number[] = [];
  const isec: number[] = [];
  for (let k = 0; k < totalSteps; k++) {
    const x = (k % spp) / spp;
    const is = isecAt(x);
    const v = vC;
    vC += (dt * (is - v / R)) / cF;
    if (k >= recStart) {
      t.push((k - recStart) * dt);
      vo.push(v);
      ipri.push(ipriAt(x));
      isec.push(is);
    }
  }
  return { t, vout: vo, ipri, isec };
}

// ---------------------------------------------------------------------------
// DAB helpers (exported — used by tests and the optimizer's sanity checks)
// ---------------------------------------------------------------------------

/**
 * Classic single-phase-shift DAB power equation:
 * P = n·V1·V2·φ·(1 − |φ|/π) / (2π·fsw·L), φ in rad, L = primary-referred
 * series (leakage + external) inductance, n = Np/Ns.
 * Positive φ transfers power V1 → V2; negative φ reverses it.
 */
export function dabPowerW(
  phiRad: number,
  v1V: number,
  v2V: number,
  n: number,
  fswHz: number,
  lH: number,
): number {
  return (n * v1V * v2V * phiRad * (1 - Math.abs(phiRad) / Math.PI)) / (TWO_PI * fswHz * lH);
}

/**
 * Solves the DAB power equation for the phase shift (rad). Clamps to just
 * under the φ = π/2 maximum-power point when |P| exceeds what the tank can
 * transfer. Sign of the result follows the sign of pW.
 */
export function dabPhaseShiftRad(
  pW: number,
  v1V: number,
  v2V: number,
  n: number,
  fswHz: number,
  lH: number,
): number {
  const denom = n * v1V * v2V;
  if (!(denom > 0) || !(fswHz > 0) || !(lH > 0)) return 0;
  const k = (TWO_PI * fswHz * lH * Math.abs(pW)) / denom;
  const kMax = Math.PI / 4; // φ(1 − φ/π) peaks at π/4 when φ = π/2
  const kc = Math.min(k, kMax * 0.9999);
  const phi = (Math.PI / 2) * (1 - Math.sqrt(1 - (4 * kc) / Math.PI));
  return Math.sign(pW) * phi;
}

/** True when the requested power exceeds the DAB tank's transfer capability. */
function dabClamped(pW: number, v1V: number, v2V: number, n: number, fswHz: number, lH: number): boolean {
  return (TWO_PI * fswHz * lH * Math.abs(pW)) / (n * v1V * v2V) > (Math.PI / 4) * 0.9999;
}

// ---------------------------------------------------------------------------
// Per-topology simulations
// ---------------------------------------------------------------------------

/** Settle periods for the first-order approximated engines (rectCore). */
const SETTLE = 24;
/** Polish periods run after the exact period-map fixed point (fp hygiene). */
const POLISH = 2;
const RECORD = 8;

function simSyncBuck(id: TopologyId, spec: DesignSpec, fswHz: number, lH: number, cF: number): SimulationResult {
  const spp = 640;
  const r = buckCore(spec.vinNomV, spec.voutV, spec.poutW, fswHz, lH, cF, 1, spp, POLISH, RECORD);
  const T = 1 / fswHz;
  const notes = [
    `sync-buck PWL state-space (semi-implicit Euler), D=${r.dutyEff.toFixed(4)} incl. DCR-droop trim`,
    `steady state via analytic preload + affine period-map shooting; ${RECORD} recorded periods @ ${spp} samples/period`,
  ];
  if (id === "buck") notes.push("plain buck simulated as synchronous (CCM forced; negative iL allowed at light load)");
  return {
    topologyId: id,
    traces: [
      trace("vout", "V", r.t, r.vout),
      trace("iL", "A", r.t, r.iPh[0]),
      trace("vsw", "V", r.t, r.vsw),
    ],
    voutRippleVpp: ppOverLastWindow(r.t, r.vout, T),
    inductorRippleApp: ppOverLastWindow(r.t, r.iPh[0], T),
    notes,
  };
}

function simInterleavedBuck(spec: DesignSpec, fswHz: number, lH: number, cF: number): SimulationResult {
  const spp = 800;
  const r = buckCore(spec.vinNomV, spec.voutV, spec.poutW, fswHz, lH, cF, 2, spp, POLISH, RECORD);
  const T = 1 / fswHz;
  return {
    topologyId: "interleaved-sync-buck",
    traces: [
      trace("vout", "V", r.t, r.vout),
      trace("iL", "A", r.t, r.iPh[0]),
      trace("iL2", "A", r.t, r.iPh[1]),
      trace("iLtot", "A", r.t, r.iTot),
      trace("vsw", "V", r.t, r.vsw),
    ],
    voutRippleVpp: ppOverLastWindow(r.t, r.vout, T),
    // Per-phase ripple (what sizes each inductor); iLtot shows the cancelled sum.
    inductorRippleApp: ppOverLastWindow(r.t, r.iPh[0], T),
    notes: [
      `2-phase interleaved sync-buck PWL state-space, 180 deg shift, per-phase L=${(lH * 1e6).toFixed(2)} µH`,
      "inductorRippleApp is per-phase; trace iLtot shows ripple cancellation into the cap",
      `steady state via analytic preload + affine period-map shooting; ${RECORD} recorded periods @ ${spp} samples/period`,
    ],
  };
}

function simBoost(spec: DesignSpec, fswHz: number, lH: number, cF: number): SimulationResult {
  const vin = spec.vinNomV;
  const vout = spec.voutV;
  const P = spec.poutW;
  const R = (vout * vout) / P;
  const esr = bankEsrOhm(cF);
  const rL = (0.005 * vin * vin) / P; // ~0.5 % loss, trimmed below
  const D = clamp(1 - (0.995 * vin) / vout, 0.02, 0.98);

  const spp = 640;
  const dt = 1 / fswHz / spp;
  const T = 1 / fswHz;
  const iAvg = P / vin; // input-side average inductor current
  const dIl = (vin * D) / (lH * fswHz);

  const t: number[] = [];
  const vo: number[] = [];
  const iLr: number[] = [];
  const vsw: number[] = [];

  // State vector [iL, vC]; affine one-period map.
  const onePeriod = (x0: number[], record: boolean, tBaseS = 0): number[] => {
    let [iL, vC] = x0;
    for (let k = 0; k < spp; k++) {
      const x = k / spp;
      const on = x < D; // low-side switch on -> inductor charging, vsw = 0
      iL += (dt * (vin - (on ? 0 : vC) - iL * rL)) / lH;
      const iToOut = on ? 0 : iL;
      const v = (vC + esr * iToOut) / (1 + esr / R);
      vC += (dt * (iToOut - v / R)) / cF;
      if (record) {
        t.push(tBaseS + k * dt);
        vo.push(v);
        iLr.push(iL);
        vsw.push(on ? 0 : v);
      }
    }
    return [iL, vC];
  };

  // Preload (rising ramp during on), then exact orbit via period-map shooting.
  let x = periodicSteadyState((y) => onePeriod(y, false), [iAvg - dIl / 2, vout]);
  for (let i = 0; i < POLISH; i++) x = onePeriod(x, false);
  for (let i = 0; i < RECORD; i++) x = onePeriod(x, true, i * T);
  return {
    topologyId: "boost",
    traces: [
      trace("vout", "V", t, vo),
      trace("iL", "A", t, iLr),
      trace("vsw", "V", t, vsw),
    ],
    voutRippleVpp: ppOverLastWindow(t, vo, T),
    inductorRippleApp: ppOverLastWindow(t, iLr, T),
    notes: [
      `synchronous boost PWL state-space (semi-implicit Euler), D=${D.toFixed(4)} incl. DCR-droop trim`,
      `steady state via analytic preload + affine period-map shooting; ${RECORD} recorded periods @ ${spp} samples/period`,
    ],
  };
}

function simDab(spec: DesignSpec, fswHz: number, lH: number, cF: number): SimulationResult {
  const V1 = spec.vinNomV;
  const Vo = spec.voutV;
  const P = spec.poutW;
  const n = V1 / Vo; // Np/Ns chosen for matched referred voltages (min circulating current)
  const R = (Vo * Vo) / P;
  const esr = bankEsrOhm(cF);
  const w = TWO_PI * fswHz;
  const phi = dabPhaseShiftRad(P, V1, Vo, n, fswHz, lH);
  const clamped = dabClamped(P, V1, Vo, n, fswHz, lH);
  const V2r = n * Vo; // secondary voltage referred to primary

  // Analytic steady-state preload for iL at the primary switching instant:
  // iL(0) = −[V1·π + V2'·(2φ − π)] / (2ω·L)   (half-wave symmetry)
  const iL0 = -(V1 * Math.PI + V2r * (2 * phi - Math.PI)) / (2 * w * lH);
  // Small series R so the iL DC mode is damped (makes I−A non-singular).
  const rS = (lH * fswHz) / 6;

  const spp = 720;
  const dt = 1 / fswHz / spp;
  const T = 1 / fswHz;
  const phiCyc = phi / TWO_PI;
  const t: number[] = [];
  const vo: number[] = [];
  const iLr: number[] = [];
  const vpri: number[] = [];
  const vsec: number[] = [];

  // State vector [iL, vC]; the bridge patterns are functions of the grid index
  // only, so the one-period map is affine.
  const onePeriod = (x0: number[], record: boolean, tBaseS = 0): number[] => {
    let [iL, vC] = x0;
    for (let k = 0; k < spp; k++) {
      const x = k / spp;
      const s1 = sq(x);
      const s2 = sq(x - phiCyc);
      const v1 = s1 * V1;
      const v2r = s2 * n * vC;
      iL += (dt * (v1 - v2r - iL * rS)) / lH;
      const idc = s2 * n * iL; // secondary bridge output current into the cap
      const v = (vC + esr * idc) / (1 + esr / R);
      vC += (dt * (idc - v / R)) / cF;
      if (record) {
        t.push(tBaseS + k * dt);
        vo.push(v);
        iLr.push(iL);
        vpri.push(v1);
        vsec.push(s2 * v);
      }
    }
    return [iL, vC];
  };

  let x = periodicSteadyState((y) => onePeriod(y, false), [iL0, Vo]);
  for (let i = 0; i < POLISH; i++) x = onePeriod(x, false);
  for (let i = 0; i < RECORD; i++) x = onePeriod(x, true, i * T);
  const notes = [
    `DAB single-phase-shift: φ=${((phi * 180) / Math.PI).toFixed(2)} deg from P=n·V1·V2·φ(1−|φ|/π)/(2π·fsw·L), n=${n.toFixed(3)}`,
    "series-inductor trapezoid + bridge voltages; output cap integrated against rectified secondary current",
    `steady state via analytic iL preload + affine period-map shooting; ${RECORD} recorded periods @ ${spp} samples/period`,
  ];
  if (clamped) notes.push("requested power exceeds tank capability at this L/fsw — φ clamped near π/2 (max power)");
  return {
    topologyId: "dab",
    traces: [
      trace("vout", "V", t, vo),
      trace("iL", "A", t, iLr),
      trace("vpri", "V", t, vpri),
      trace("vsec", "V", t, vsec),
    ],
    voutRippleVpp: ppOverLastWindow(t, vo, T),
    inductorRippleApp: ppOverLastWindow(t, iLr, T),
    notes,
  };
}

function simTotemPolePfc(spec: DesignSpec, fswHz: number, lH: number, cF: number): SimulationResult {
  const vrms = spec.gridVacRms ?? 230;
  const fLine = 50; // assumed; ripple scales trivially for 60 Hz grids
  const vpk = Math.SQRT2 * vrms;
  const notes: string[] = [
    `totem-pole PFC averaged current-loop model over one line half-cycle (${fLine} Hz grid assumed)`,
  ];
  let vbus = spec.voutV;
  if (vbus < 1.05 * vpk) {
    vbus = Math.max(400, 1.1 * vpk);
    notes.push(`spec.voutV below grid peak — simulated DC bus at ${vbus.toFixed(0)} V`);
  }
  const P = spec.poutW;
  const R = (vbus * vbus) / P;
  const ipk = (Math.SQRT2 * P) / vrms; // unity-PF line current peak

  const half = 1 / (2 * fLine);
  const nRec = 3000; // reduced sample density: ~few samples per switching period
  const dt = half / nRec;
  const settleHalves = 3;
  let vC = vbus;
  const t: number[] = [];
  const vo: number[] = [];
  const iLr: number[] = [];
  const vac: number[] = [];
  const totalSteps = (settleHalves + 1) * nRec;
  const recStart = settleHalves * nRec;
  for (let k = 0; k < totalSteps; k++) {
    const tt = k * dt;
    const s = Math.sin(TWO_PI * fLine * tt);
    const vin = vpk * Math.abs(s);
    const iLine = ipk * s; // ideal current loop: sinusoidal line current, PF = 1
    const pin = vin * Math.abs(iLine);
    const idc = pin / Math.max(vC, 1);
    vC += (dt * (idc - vC / R)) / cF;
    if (k >= recStart) {
      t.push((k - recStart) * dt);
      vo.push(vC);
      iLr.push(iLine);
      vac.push(vpk * s);
    }
  }
  // Switching-frequency inductor ripple is analytic (not resolved at this
  // sample density): dI(vin) = vin·(1 − vin/vbus)/(L·fsw), max at vin = vbus/2.
  const ripplePk =
    vpk >= vbus / 2
      ? vbus / (4 * lH * fswHz)
      : (vpk * (1 - vpk / vbus)) / (lH * fswHz);
  notes.push(
    `reduced sample density (${nRec} samples per half-cycle); switching ripple not resolved in traces`,
    "inductorRippleApp is the analytic worst-case switching ripple vin(1−vin/vbus)/(L·fsw)",
    "voutRippleVpp is the 2×line-frequency bus ripple over the recorded half-cycle",
  );
  return {
    topologyId: "totem-pole-pfc",
    traces: [
      trace("vout", "V", t, vo),
      trace("iL", "A", t, iLr),
      trace("vac", "V", t, vac),
    ],
    voutRippleVpp: ppOverLastWindow(t, vo, half),
    inductorRippleApp: ripplePk,
    notes,
  };
}

function simLlc(id: TopologyId, spec: DesignSpec, fswHz: number, lH: number, cF: number): SimulationResult {
  const vin = spec.vinNomV;
  const Vo = spec.voutV;
  const P = spec.poutW;
  const vEff = id === "llc-half-bridge" ? vin / 2 : vin;
  const n = vEff / Vo; // unity gain at resonance
  const R = (Vo * Vo) / P;
  const iOut = P / Vo;
  const lmH = 8 * lH; // assumed Lm/Lr ratio of 8 (typical 5–10)
  const imPk = (n * Vo) / (4 * fswHz * lmH); // magnetizing triangle peak

  const spp = 512;
  const isecAt = (x: number): number => (Math.PI / 2) * iOut * Math.abs(Math.sin(TWO_PI * x));
  const ipriAt = (x: number): number => {
    const triangle = x < 0.5 ? -1 + 4 * x : 3 - 4 * x;
    return ((Math.PI / 2) * (iOut / n)) * Math.sin(TWO_PI * x) + imPk * triangle;
  };
  const r = rectCore(fswHz, cF, R, Vo, spp, SETTLE, RECORD, ipriAt, isecAt);
  const T = 1 / fswHz;
  return {
    topologyId: id,
    traces: [
      trace("vout", "V", r.t, r.vout),
      trace("iL", "A", r.t, r.ipri), // resonant-tank primary current
      trace("isec", "A", r.t, r.isec),
    ],
    voutRippleVpp: ppOverLastWindow(r.t, r.vout, T),
    inductorRippleApp: ppOverLastWindow(r.t, r.ipri, T),
    notes: [
      "approximate: LLC at-resonance operating-point construction, not full resonant state-space",
      `sinusoidal tank current + magnetizing triangle (Lm = 8·Lr assumed), n=${n.toFixed(3)}, ${
        id === "llc-half-bridge" ? "half" : "full"
      }-bridge`,
      "output cap integrated against rectified |sin| secondary current",
    ],
  };
}

function simPsfb(spec: DesignSpec, fswHz: number, lH: number, cF: number): SimulationResult {
  const vin = spec.vinNomV;
  const Vo = spec.voutV;
  const dEff = 0.7;
  const n = (dEff * vin) / Vo; // sets effective secondary duty to 0.7
  const vinEff = Vo / dEff;
  const spp = 500;
  // Output stage behaves as a buck at 2×fsw (full-wave rectified secondary).
  // Record 2×RECORD effective periods so the window spans >= 6 primary periods.
  const r = buckCore(vinEff, Vo, spec.poutW, 2 * fswHz, lH, cF, 1, spp, POLISH, 2 * RECORD);
  // Primary current: reflected output-inductor current, alternating at fsw
  // (PSFB circulates near-constant current through the freewheel interval).
  const ipri = r.t.map((tt, i) => (sq(tt * fswHz) * r.iPh[0][i]) / n);
  const T = 1 / (2 * fswHz);
  return {
    topologyId: "psfb",
    traces: [
      trace("vout", "V", r.t, r.vout),
      trace("iL", "A", r.t, r.iPh[0]),
      trace("ipri", "A", r.t, ipri),
      trace("vsw", "V", r.t, r.vsw),
    ],
    voutRippleVpp: ppOverLastWindow(r.t, r.vout, T),
    inductorRippleApp: ppOverLastWindow(r.t, r.iPh[0], T),
    notes: [
      "approximate: PSFB modelled as buck-equivalent output stage at 2×fsw, Deff=0.70, n=" + n.toFixed(3),
      "ipri is the reflected trapezoid (circulating freewheel current retained); ZVS transitions not resolved",
    ],
  };
}

function simFlyback(spec: DesignSpec, fswHz: number, lH: number, cF: number): SimulationResult {
  const vin = spec.vinNomV;
  const Vo = spec.voutV;
  const P = spec.poutW;
  const R = (Vo * Vo) / P;
  const n = ((2 / 3) * vin) / Vo; // Np/Ns targeting D = 0.4 at nominal input
  const D = (n * Vo) / (n * Vo + vin);
  const iAvgOn = P / (vin * D);
  const dI = (vin * D) / (lH * fswHz);
  const iA = iAvgOn - dI / 2;
  const notes: string[] = [
    `approximate: flyback operating-point waveform construction (Lp=${(lH * 1e6).toFixed(1)} µH treated as magnetizing), n=${n.toFixed(3)}, D=${D.toFixed(3)}`,
  ];

  let ipriAt: (x: number) => number;
  let isecAt: (x: number) => number;
  if (iA >= 0) {
    // CCM: primary ramps iA→iB over D·Ts; secondary n·iB→n·iA over (1−D)·Ts.
    const iB = iAvgOn + dI / 2;
    ipriAt = (x) => (x < D ? iA + (dI * x) / D : 0);
    isecAt = (x) => (x >= D ? n * (iB - (dI * (x - D)) / (1 - D)) : 0);
    notes.push("CCM operation");
  } else {
    // DCM: full energy transfer each cycle, ½·Lp·Ipk²·fsw = P.
    const iPk = Math.sqrt((2 * P) / (lH * fswHz));
    const xOn = (lH * iPk * fswHz) / vin;
    const xFall = (lH * iPk * fswHz) / (n * Vo);
    ipriAt = (x) => (x < xOn ? (iPk * x) / xOn : 0);
    isecAt = (x) => (x >= xOn && x < xOn + xFall ? n * iPk * (1 - (x - xOn) / xFall) : 0);
    notes.push(`DCM operation (Ipk=${iPk.toFixed(2)} A)`);
  }
  const spp = 512;
  const r = rectCore(fswHz, cF, R, Vo, spp, SETTLE, RECORD, ipriAt, isecAt);
  const T = 1 / fswHz;
  return {
    topologyId: "flyback",
    traces: [
      trace("vout", "V", r.t, r.vout),
      trace("iL", "A", r.t, r.ipri), // primary (magnetizing) current
      trace("isec", "A", r.t, r.isec),
    ],
    voutRippleVpp: ppOverLastWindow(r.t, r.vout, T),
    inductorRippleApp: ppOverLastWindow(r.t, r.ipri, T),
    notes,
  };
}

function simForward(spec: DesignSpec, fswHz: number, lH: number, cF: number): SimulationResult {
  const vin = spec.vinNomV;
  const Vo = spec.voutV;
  const D = 0.45;
  const n = (D * vin) / Vo; // Np/Ns so nominal duty lands at 0.45
  const vinEff = Vo / D; // secondary-referred input
  const spp = 640;
  const r = buckCore(vinEff, Vo, spec.poutW, fswHz, lH, cF, 1, spp, POLISH, RECORD);
  // Reflected primary current during the on interval (magnetizing + reset ignored).
  const ipri = r.vsw.map((v, i) => (v > vinEff / 2 ? r.iPh[0][i] / n : 0));
  const T = 1 / fswHz;
  return {
    topologyId: "forward-active-clamp",
    traces: [
      trace("vout", "V", r.t, r.vout),
      trace("iL", "A", r.t, r.iPh[0]),
      trace("ipri", "A", r.t, ipri),
      trace("vsw", "V", r.t, r.vsw),
    ],
    voutRippleVpp: ppOverLastWindow(r.t, r.vout, T),
    inductorRippleApp: ppOverLastWindow(r.t, r.iPh[0], T),
    notes: [
      `approximate: forward (active clamp) as secondary-referred buck, n=${n.toFixed(3)}, D=${D.toFixed(2)}`,
      "magnetizing/reset current and clamp resonance not modelled; ipri is the reflected on-interval current",
    ],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fixed-step PWL state-space simulation of the converter at one operating
 * point. lUh/cOutUf are the power-stage inductance (per phase where relevant;
 * series tank L for dab; magnetizing L for flyback) and output capacitance.
 * Load is resistive: R = vout²/pout.
 */
export function simulate(
  id: TopologyId,
  spec: DesignSpec,
  fswHz: number,
  lUh: number,
  cOutUf: number,
): SimulationResult {
  const lH = lUh * 1e-6;
  const cF = cOutUf * 1e-6;
  checkInputs(spec, fswHz, lH, cF);
  switch (id) {
    case "buck":
    case "sync-buck":
      return simSyncBuck(id, spec, fswHz, lH, cF);
    case "interleaved-sync-buck":
      return simInterleavedBuck(spec, fswHz, lH, cF);
    case "boost":
      return simBoost(spec, fswHz, lH, cF);
    case "dab":
      return simDab(spec, fswHz, lH, cF);
    case "totem-pole-pfc":
      return simTotemPolePfc(spec, fswHz, lH, cF);
    case "llc-half-bridge":
    case "llc-full-bridge":
      return simLlc(id, spec, fswHz, lH, cF);
    case "psfb":
      return simPsfb(spec, fswHz, lH, cF);
    case "flyback":
      return simFlyback(spec, fswHz, lH, cF);
    case "forward-active-clamp":
      return simForward(spec, fswHz, lH, cF);
  }
}
