/**
 * VoltForge optimizer — the composition root.
 *
 * designConverter(spec) drives the whole engine chain:
 *   scoreTopologies → top ≤3 qualified topologies
 *   → candidate sweep: (primary switch, capped to 8 by Rds·Qg FoM) × fsw grid
 *   → per candidate: operating points, parallel count, electro-thermal
 *     iteration (losses at solved Tj), magnetics, cap bank, rough BOM cost,
 *     power-density estimate
 *   → feasibility + Pareto flags (efficiency ↑, cost ↓, density ↑)
 *   → winner = best feasible, weighted 50 % efficiency / 30 % cost /
 *     20 % density, honoring targetEfficiencyPct and costCeilingUsd
 *   → full DesignResult: schematic, BOM, layout, compensator, simulation,
 *     firmware, efficiency curve, compliance (last).
 *
 * Shared per-(topology, fsw) work (operating points, magnetics, cap bank,
 * non-swept switch positions) is cached so the sweep stays well under the
 * ~15 s budget.
 */

import type {
  BomLine,
  CapacitorPart,
  ControllerPart,
  DesignCandidateSummary,
  DesignResult,
  DesignSpec,
  DeviceLoss,
  EfficiencyPoint,
  GateDriver,
  LossBreakdown,
  MagneticDesign,
  SwitchDevice,
  SwitchOperatingPoint,
  ThermalReport,
  TopologyId,
  TopologyOperatingPoints,
  TopologyScore,
} from "@/lib/types";
import { clamp, logSpace, roundSig } from "@/lib/util";
import { CAPACITORS, CONTROLLERS, GATE_DRIVERS, HEATSINKS, findSwitches } from "@/lib/data";
import { capacitorLossW, deviceLoss, pickParallelCount } from "@/lib/loss";
import { operatingPoints, scoreTopologies } from "@/lib/topology";
import { designMagnetic } from "@/lib/magnetics";
import { iterateThermal } from "@/lib/thermal";
import { designCompensator } from "@/lib/control";
import { simulate } from "@/lib/simulation";
import { generateFirmware } from "@/lib/firmware";
import { buildSchematic } from "@/lib/schematic";
import { buildBom } from "@/lib/bom";
import { layoutGuidance } from "@/lib/layout";
import { checkCompliance } from "@/lib/compliance";

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Device Vds rating must exceed the worst off-state voltage by this factor. */
const VDS_MARGIN = 1.25;
/** Relaxed margin used only when the catalog has nothing at 1.25×. */
const VDS_MARGIN_RELAXED = 1.1;
/** Capacitor voltage derating (per series element). */
const CAP_V_MARGIN = 1.1;
/** Cap devices per topology by best Rds·Qg figure of merit. */
const MAX_DEVICES_PER_TOPO = 8;
const MAX_TOPOLOGIES = 3;
const FSW_LO_HZ = 100e3;
const FSW_HI_HZ = 1e6;
const FSW_POINTS = 5;
// Constraint: High-power designs rarely exceed these frequencies without severe losses
const FSW_MAX_FOR_POWER: Record<string, number> = {
  "llc-full-bridge": 250e3,        // LLC: 100-250 kHz for high-efficiency (skin effect avoidance)
  "llc-half-bridge": 250e3,        // LLC half: 100-250 kHz typical
  "psfb": 300e3,                    // PSFB: 50-300 kHz typical
  "dab": 150e3,                     // DAB: 50-150 kHz typical (soft-switching at lower freq)
  "flyback": 500e3,                 // Flyback: 100-500 kHz typical
  "totem-pole-pfc": 200e3,         // PFC: 50-200 kHz typical
};
const LOAD_POINTS_PCT = [10, 25, 50, 75, 100];
/** Everything-that-isn't-modelled volume multiplier (case, connectors, air). */
const PACKAGING_FACTOR = 2;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Switching figure of merit: lower Rds(on)·Qg = better high-frequency FET. */
function fomRdsQg(d: SwitchDevice): number {
  return d.rdsOnMohm25 * d.qgNc;
}

function fswGrid(spec: DesignSpec, topoId?: string): number[] {
  // Determine max frequency based on topology (avoid unrealistic high-frequency designs)
  let fswMax = FSW_HI_HZ;
  if (topoId && FSW_MAX_FOR_POWER[topoId]) {
    fswMax = Math.min(fswMax, FSW_MAX_FOR_POWER[topoId]);
  }

  if (spec.fswHz !== undefined && spec.fswHz > 0) {
    // User-forced frequency: sweep a narrow geometric neighborhood centered
    // on it (the middle point is exactly spec.fswHz).
    const f = spec.fswHz;
    return [...new Set(logSpace(f / 1.5, f * 1.5, 3).map((x) => clamp(x, 25e3, fswMax)))];
  }
  return logSpace(FSW_LO_HZ, fswMax, FSW_POINTS);
}

/**
 * Switch candidates for one operating point: rated ≥ VDS_MARGIN × stress,
 * able to carry the RMS current with ≤4 parallel dice, best-FoM first,
 * capped to MAX_DEVICES_PER_TOPO.
 */
function qualifiedDevices(op: SwitchOperatingPoint, warnings: string[]): SwitchDevice[] {
  const iMinA = op.iRmsA / (4 * 0.7); // 4 parallel max, 70 % Id derating
  let list = findSwitches({ minVdsV: VDS_MARGIN * op.vOffV, minIdA: iMinA });
  if (list.length === 0) {
    list = findSwitches({ minVdsV: VDS_MARGIN_RELAXED * op.vOffV, minIdA: iMinA });
    if (list.length > 0) {
      warnings.push(
        `No catalog switch offers ${VDS_MARGIN}× margin on ${roundSig(op.vOffV, 3)} V ` +
          `(${op.role}); relaxed to ${VDS_MARGIN_RELAXED}×.`,
      );
    }
  }
  if (list.length === 0) {
    // Last resort: the highest-voltage parts in the catalog.
    list = findSwitches({ minIdA: iMinA })
      .sort((a, b) => b.vdsMaxV - a.vdsMaxV)
      .slice(0, MAX_DEVICES_PER_TOPO);
    warnings.push(
      `No catalog switch is rated for the ${roundSig(op.vOffV, 3)} V stress at ` +
        `${op.role}; using the highest-voltage parts available (check series stacking).`,
    );
  }
  return list.sort((a, b) => fomRdsQg(a) - fomRdsQg(b)).slice(0, MAX_DEVICES_PER_TOPO);
}

function overheadW(spec: DesignSpec): number {
  // Controller + gate rails + sensing scale weakly with power; fans/pumps add.
  let w = 1.5 + 0.0015 * spec.poutW;
  if (spec.cooling === "forced-air") w += 2.5;
  if (spec.cooling === "liquid" || spec.cooling === "cold-plate") w += 4;
  return w;
}

// ---------------------------------------------------------------------------
// Capacitor bank sizing
// ---------------------------------------------------------------------------

interface CapBankEntry {
  part: CapacitorPart;
  /** Series elements per string (voltage stacking). */
  seriesN: number;
  /** Parallel strings. */
  parallelN: number;
  /** Total pieces = seriesN × parallelN (what the schematic/BOM sees). */
  qty: number;
  totalUf: number;
  lossW: number;
}

/**
 * Pick the cheapest catalog capacitor arrangement that meets voltage
 * (with series stacking), RMS ripple current and minimum capacitance.
 */
function selectCapBank(busV: number, iRmsA: number, minUf: number): CapBankEntry {
  let best: CapBankEntry | undefined;
  let bestCost = Infinity;
  for (const part of CAPACITORS) {
    const seriesN = Math.max(1, Math.ceil((CAP_V_MARGIN * busV) / part.voltageV));
    if (seriesN > 3) continue; // silly stacks are not a real design
    const stringUf = part.capUf / seriesN;
    const nRipple = iRmsA > 0 ? Math.ceil(iRmsA / (0.8 * part.iRmsA)) : 1;
    const nCap = minUf > 0 ? Math.ceil(minUf / stringUf) : 1;
    const parallelN = Math.max(1, nRipple, nCap);
    const qty = seriesN * parallelN;
    if (qty > 60) continue; // unbuildable bank
    const cost = qty * part.priceUsd1k;
    if (cost < bestCost) {
      const iPerString = iRmsA / parallelN;
      // String ESR = seriesN × part ESR → loss = parallelN·seriesN·(i²·ESR).
      const lossW = parallelN * seriesN * capacitorLossW(part, iPerString);
      best = { part, seriesN, parallelN, qty, totalUf: parallelN * stringUf, lossW };
      bestCost = cost;
    }
  }
  // CAPACITORS is non-empty; even so, fall back defensively.
  if (!best) {
    const part = CAPACITORS[0];
    best = { part, seriesN: 1, parallelN: 1, qty: 1, totalUf: part.capUf, lossW: 0 };
  }
  return best;
}

/** Minimum output capacitance (µF) to hold the ripple spec — per topology. */
function outputMinUf(id: TopologyId, spec: DesignSpec, fsw: number, capRmsA: number): number {
  const ripplePct = spec.rippleVoutPct ?? 1;
  const vppV = Math.max((ripplePct / 100) * spec.voutV, 1e-3);
  if (id === "totem-pole-pfc") {
    // Twice-line-frequency energy ripple dominates the DC link. Industry
    // practice allows ≥5 % pk-pk on the link (the load rail spec belongs to
    // the downstream stage).
    const vppLinkV = Math.max(vppV, 0.05 * spec.voutV);
    return (1e6 * spec.poutW) / (2 * Math.PI * 100 * spec.voutV * vppLinkV);
  }
  if (id === "buck" || id === "sync-buck" || id === "interleaved-sync-buck") {
    // Triangular ripple current: ΔVpp = ΔI/(8·f·C); ΔI = √12·Icap,rms.
    const dIA = Math.sqrt(12) * capRmsA;
    return (1e6 * dIA) / (8 * fsw * vppV);
  }
  // Chopped rectifier current (boost, bridges): charge-based ΔQ ≈ Irms/(2f).
  return (1e6 * capRmsA) / (2 * fsw * vppV);
}

/** Input-capacitor RMS ripple current estimate, per topology family. */
function inputCapRmsA(id: TopologyId, spec: DesignSpec): number {
  const iinA = spec.poutW / spec.vinNomV;
  const ioutA = spec.poutW / spec.voutV;
  switch (id) {
    case "buck":
    case "sync-buck": {
      const d = clamp(spec.voutV / spec.vinNomV, 0.02, 0.98);
      return ioutA * Math.sqrt(d * (1 - d)); // chopped input current
    }
    case "interleaved-sync-buck": {
      const d = clamp(spec.voutV / spec.vinNomV, 0.02, 0.98);
      return 0.5 * ioutA * Math.sqrt(d * (1 - d)); // interleave cancellation
    }
    case "boost":
    case "totem-pole-pfc":
      return 0.2 * iinA; // continuous choke current: HF residue only
    default:
      return 0.6 * iinA; // bridge primaries: square-ish current vs DC
  }
}

// ---------------------------------------------------------------------------
// Power-density bookkeeping
// ---------------------------------------------------------------------------

function capVolumeMm3(p: CapacitorPart): number {
  switch (p.dielectric) {
    case "film":
      return 18_000; // ~40×20×22 mm box film
    case "electrolytic":
      return p.voltageV > 100 ? 17_000 : 6_000; // snap-in vs radial
    case "polymer":
      return 1_500;
    default:
      return p.capUf >= 4.7 ? 220 : 80; // 2220/1210-class MLCC
  }
}

function candidateVolumeL(
  mags: MagneticDesign[],
  thermal: ThermalReport,
  banks: CapBankEntry[],
): number {
  // Wound core ≈ 2× core volume (winding, bobbin, clearance).
  const magMm3 = mags.reduce((s, m) => s + 2 * m.core.veMm3, 0);
  const hs = thermal.heatsink;
  const sinkMm3 = hs
    ? hs.footprintMm[0] * hs.footprintMm[1] * hs.heightMm
    : thermal.cooling === "liquid" || thermal.cooling === "cold-plate"
      ? 150_000 // cold-plate allowance
      : 50_000;
  const capMm3 = banks.reduce((s, b) => s + b.qty * capVolumeMm3(b.part), 0);
  const boardMm3 = 40_000; // semiconductors, drivers, controller, connectors
  return (PACKAGING_FACTOR * (magMm3 + sinkMm3 + capMm3 + boardMm3)) / 1e6;
}

// ---------------------------------------------------------------------------
// Part picks (driver / controller)
// ---------------------------------------------------------------------------

function pickGateDriver(devices: SwitchDevice[], fsw: number): GateDriver {
  const hasGaN = devices.some((d) => d.tech === "GaN");
  const needCmti = hasGaN || fsw >= 200e3;
  const pool = GATE_DRIVERS.filter((g) => g.isolated && g.channels === 2);
  const strong = pool.filter((g) => g.cmtiVPerNs >= (needCmti ? 100 : 50));
  const list = (strong.length ? strong : pool.length ? pool : GATE_DRIVERS).slice();
  list.sort((a, b) => a.priceUsd1k - b.priceUsd1k);
  return list[0];
}

function pickController(fsw: number): ControllerPart {
  // Firmware target defaults to STM32G474 — pick from the same family, and
  // insist on high-resolution PWM once the period gets short.
  const g4 = CONTROLLERS.filter((c) => c.family === "STM32G4");
  const pool = (g4.length ? g4 : CONTROLLERS).slice();
  const fine = pool.filter((c) => c.pwmResolutionPs <= (fsw >= 400e3 ? 300 : 4000));
  const list = (fine.length ? fine : pool).sort((a, b) => a.priceUsd1k - b.priceUsd1k);
  return list[0];
}

// ---------------------------------------------------------------------------
// Candidate evaluation
// ---------------------------------------------------------------------------

interface Assignment {
  op: SwitchOperatingPoint;
  device: SwitchDevice;
  parallel: number;
}

/** Work shared by every device candidate at one (topology, fsw) point. */
interface SharedEval {
  ops: TopologyOperatingPoints;
  primaryIdx: number;
  primaryPool: SwitchDevice[];
  /** Auto-picked devices for the non-swept positions (index-aligned). */
  autoPicks: (Assignment | undefined)[];
  mags: MagneticDesign[];
  magCoreW: number;
  magCopperW: number;
  inBank: CapBankEntry;
  outBank: CapBankEntry;
  capW: number;
  ohW: number;
}

interface CandidateEval {
  topoScore: TopologyScore;
  fsw: number;
  shared: SharedEval;
  assignments: Assignment[];
  losses: LossBreakdown;
  thermal: ThermalReport;
  effPct: number;
  costUsd: number;
  densityWPerL: number;
  feasible: boolean;
  score: number; // filled by the winner selection pass
  pareto: boolean;
}

function buildShared(
  spec: DesignSpec,
  id: TopologyId,
  fsw: number,
  warnings: string[],
): SharedEval {
  const ops = operatingPoints(id, spec, fsw);
  // Primary sweep position: worst off-state voltage (tie → highest RMS).
  let primaryIdx = 0;
  for (let i = 1; i < ops.switchPoints.length; i++) {
    const a = ops.switchPoints[i];
    const b = ops.switchPoints[primaryIdx];
    if (a.vOffV > b.vOffV || (a.vOffV === b.vOffV && a.iRmsA > b.iRmsA)) primaryIdx = i;
  }
  const primaryPool = qualifiedDevices(ops.switchPoints[primaryIdx], warnings);

  // Non-swept positions: deterministic best pick (min loss at Tj = 100 °C
  // among the top-FoM qualifiers) — independent of the swept primary device.
  const autoPicks = ops.switchPoints.map((op, i) => {
    if (i === primaryIdx) return undefined;
    const pool = qualifiedDevices(op, warnings);
    let best: Assignment | undefined;
    let bestW = Infinity;
    for (const device of pool) {
      const parallel = pickParallelCount(device, op);
      const w = deviceLoss(device, op, parallel, 100).totalW;
      if (w < bestW) {
        bestW = w;
        best = { op, device, parallel };
      }
    }
    return best;
  });

  const mags = ops.magnetics.map((req) => designMagnetic(req, spec.ambientC));
  const magCoreW = mags.reduce((s, m) => s + m.coreLossW, 0);
  const magCopperW = mags.reduce((s, m) => s + m.copperLossW, 0);

  const outBank = selectCapBank(
    spec.voutV,
    ops.capRmsA,
    outputMinUf(id, spec, fsw, ops.capRmsA),
  );
  const iinRipple = inputCapRmsA(id, spec);
  // Hold the input bus to ~2 % pk-pk against the chopped input current.
  const minInUf = (1e6 * iinRipple) / (4 * fsw * Math.max(0.02 * spec.vinNomV, 0.1));
  const inBank = selectCapBank(spec.vinMaxV, iinRipple, minInUf);

  return {
    ops,
    primaryIdx,
    primaryPool,
    autoPicks,
    mags,
    magCoreW,
    magCopperW,
    inBank,
    outBank,
    capW: inBank.lossW + outBank.lossW,
    ohW: overheadW(spec),
  };
}

function roughCostUsd(spec: DesignSpec, c: Omit<CandidateEval, "costUsd" | "densityWPerL" | "effPct" | "feasible" | "score" | "pareto">): number {
  const sh = c.shared;
  const devUsd = c.assignments.reduce(
    (s, a) => s + a.device.priceUsd1k * a.op.positions * a.parallel,
    0,
  );
  const magUsd = sh.mags.reduce((s, m) => {
    const lenM = ((m.turnsPrimary + (m.turnsSecondary ?? 0)) * m.core.mltMm) / 1000;
    return s + m.core.priceUsd + 1.2 + 0.15 * lenM; // core + labor + copper
  }, 0);
  const capUsd =
    sh.inBank.qty * sh.inBank.part.priceUsd1k + sh.outBank.qty * sh.outBank.part.priceUsd1k;
  const sinkUsd =
    c.thermal.heatsink?.priceUsd ??
    (spec.cooling === "liquid" || spec.cooling === "cold-plate" ? 18 : 0);
  const positions = c.assignments.reduce((s, a) => s + a.op.positions, 0);
  const driverUsd = Math.ceil(positions / 2) * 2.0; // dual-channel driver per leg
  const controllerUsd = 4.5;
  const pcbMiscUsd = 6 + 0.004 * spec.poutW; // PCB, connectors, sensing, assembly
  const fanUsd = spec.cooling === "forced-air" ? 3.5 : 0;
  return devUsd + magUsd + capUsd + sinkUsd + driverUsd + controllerUsd + pcbMiscUsd + fanUsd;
}

function evaluateCandidate(
  spec: DesignSpec,
  topoScore: TopologyScore,
  fsw: number,
  primaryDevice: SwitchDevice,
  shared: SharedEval,
): CandidateEval {
  const assignments: Assignment[] = shared.ops.switchPoints.map((op, i) => {
    if (i === shared.primaryIdx) {
      return { op, device: primaryDevice, parallel: pickParallelCount(primaryDevice, op) };
    }
    return shared.autoPicks[i] ?? { op, device: primaryDevice, parallel: pickParallelCount(primaryDevice, op) };
  });

  const fixedW = shared.magCoreW + shared.magCopperW + shared.capW + shared.ohW;
  const evalLossesAtTj = (tjC: number): LossBreakdown => {
    const devices = assignments.map((a) => deviceLoss(a.device, a.op, a.parallel, tjC));
    const devW = devices.reduce((s, d) => s + d.totalW, 0);
    return {
      devices,
      magneticsCoreW: shared.magCoreW,
      magneticsCopperW: shared.magCopperW,
      capacitorW: shared.capW,
      overheadW: shared.ohW,
      totalW: devW + fixedW,
    };
  };

  const { losses, thermal } = iterateThermal(spec, evalLossesAtTj, HEATSINKS);
  const effPct = (100 * spec.poutW) / (spec.poutW + losses.totalW);
  const partial = { topoScore, fsw, shared, assignments, losses, thermal };
  const costUsd = roughCostUsd(spec, partial);
  const densityWPerL =
    spec.poutW / Math.max(candidateVolumeL(shared.mags, thermal, [shared.inBank, shared.outBank]), 1e-3);
  const feasible = thermal.ok && Number.isFinite(effPct) && effPct > 0;
  return { ...partial, effPct, costUsd, densityWPerL, feasible, score: 0, pareto: false };
}

/** Pareto flags: efficiency up, cost down, density up. */
function markPareto(cands: CandidateEval[]): void {
  for (const c of cands) {
    c.pareto = !cands.some(
      (o) =>
        o !== c &&
        o.effPct >= c.effPct &&
        o.costUsd <= c.costUsd &&
        o.densityWPerL >= c.densityWPerL &&
        (o.effPct > c.effPct || o.costUsd < c.costUsd || o.densityWPerL > c.densityWPerL),
    );
  }
}

/** Weighted 0..1 score across the candidate set (50/30/20). */
function scoreCandidates(cands: CandidateEval[]): void {
  const effs = cands.map((c) => c.effPct);
  const costs = cands.map((c) => c.costUsd);
  const dens = cands.map((c) => c.densityWPerL);
  const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs) || 1;
  const eMin = Math.min(...effs);
  const cMax = Math.max(...costs);
  const dMin = Math.min(...dens);
  for (const c of cands) {
    c.score =
      0.5 * ((c.effPct - eMin) / span(effs)) +
      0.3 * ((cMax - c.costUsd) / span(costs)) +
      0.2 * ((c.densityWPerL - dMin) / span(dens));
  }
}

// ---------------------------------------------------------------------------
// Efficiency curve
// ---------------------------------------------------------------------------

function efficiencyCurve(spec: DesignSpec, w: CandidateEval): EfficiencyPoint[] {
  const sh = w.shared;
  const id = w.topoScore.topology.id;
  const tjFullC = w.thermal.nodes.length
    ? Math.max(...w.thermal.nodes.map((n) => n.tjC))
    : spec.ambientC + 40;

  return LOAD_POINTS_PCT.map((pct) => {
    if (pct === 100) {
      return {
        loadPct: 100,
        efficiencyPct: roundSig(w.effPct, 4),
        lossW: roundSig(w.losses.totalW, 4),
      };
    }
    const frac = pct / 100;
    const specL: DesignSpec = { ...spec, poutW: spec.poutW * frac };
    const opsL = operatingPoints(id, specL, w.fsw);
    // Junction cools roughly with dissipation; first-order interpolation.
    const tjC = spec.ambientC + (tjFullC - spec.ambientC) * frac;

    // Devices: same silicon and parallel count, re-priced at the light-load
    // operating point (matched by role, falling back to index).
    let devW = 0;
    w.assignments.forEach((a, i) => {
      const opL = opsL.switchPoints.find((o) => o.role === a.op.role) ?? opsL.switchPoints[i];
      if (opL) devW += deviceLoss(a.device, opL, a.parallel, tjC).totalW;
    });

    // Magnetics: fixed hardware — copper ∝ I², core ∝ (V·s)^β (iGSE scaling).
    let magW = 0;
    sh.mags.forEach((m, i) => {
      const reqF = sh.ops.magnetics[i];
      const reqL = opsL.magnetics[i];
      if (!reqL || !reqF) {
        magW += m.coreLossW + m.copperLossW;
        return;
      }
      const iRatio = reqF.iRmsA > 0 ? reqL.iRmsA / reqF.iRmsA : 1;
      const vsRatio = reqF.voltSecondsVus > 0 ? reqL.voltSecondsVus / reqF.voltSecondsVus : 1;
      magW +=
        m.copperLossW * iRatio * iRatio +
        m.coreLossW * Math.pow(Math.max(vsRatio, 1e-6), m.material.steinmetzBeta);
    });

    const capRatio = sh.ops.capRmsA > 0 ? opsL.capRmsA / sh.ops.capRmsA : 1;
    const capW = sh.capW * capRatio * capRatio;

    const lossW = devW + magW + capW + sh.ohW;
    const poutL = spec.poutW * frac;
    return {
      loadPct: pct,
      efficiencyPct: roundSig((100 * poutL) / (poutL + lossW), 4),
      lossW: roundSig(lossW, 4),
    };
  });
}

// ---------------------------------------------------------------------------
// Composition root
// ---------------------------------------------------------------------------

/** Inductance the control/simulation engines care about, by role priority. */
function controlInductanceUh(mags: MagneticDesign[]): number {
  const order = [
    "output-inductor",
    "pfc-inductor",
    "resonant-inductor",
    "coupled-inductor",
    "transformer",
  ] as const;
  for (const role of order) {
    const m = mags.find((x) => x.role === role);
    if (m) return m.inductanceUh;
  }
  return mags[0]?.inductanceUh ?? 10;
}

export function designConverter(spec: DesignSpec): DesignResult {
  const warnings: string[] = [];

  // ---- 1. Topology shortlist ---------------------------------------------
  let effSpec = spec;
  let qualified = scoreTopologies(spec).filter((s) => !s.disqualified && s.score > 0);
  if (qualified.length === 0 && spec.conversion === "ac-dc" && spec.isolated) {
    // The only AC-DC front end (totem-pole PFC) is non-isolated. Standard
    // architecture: PFC front end + downstream isolated DC-DC. We design the
    // PFC stage and flag the isolation hand-off.
    effSpec = { ...spec, isolated: false };
    qualified = scoreTopologies(effSpec).filter((s) => !s.disqualified && s.score > 0);
    if (qualified.length > 0) {
      warnings.push(
        "Isolated AC-DC requested: the PFC front end itself is non-isolated " +
          "(totem-pole). This design covers the PFC stage; galvanic isolation " +
          "belongs to the downstream isolated DC-DC stage (e.g. LLC or DAB).",
      );
    }
  }
  if (qualified.length === 0) {
    const all = scoreTopologies(effSpec);
    qualified = all.slice(0, 1);
    warnings.push(
      `No topology fully qualifies for this spec ` +
        `(${all[0]?.disqualified ?? "no candidates"}); proceeding with ` +
        `${all[0]?.topology.name ?? "the closest fit"} as a best effort.`,
    );
  }
  const shortlist = qualified.slice(0, MAX_TOPOLOGIES);
  const baseGrid = fswGrid(effSpec);

  // ---- 2. Candidate sweep -------------------------------------------------
  const cands: CandidateEval[] = [];
  for (const ts of shortlist) {
    // Apply topology-specific frequency limits to avoid unrealistic high-freq designs
    const topoGrid = baseGrid.filter((f) => {
      const fswMax = FSW_MAX_FOR_POWER[ts.topology.id] ?? FSW_HI_HZ;
      return f <= fswMax;
    });
    const grid = topoGrid.length > 0 ? topoGrid : [Math.min(baseGrid[0]!, FSW_MAX_FOR_POWER[ts.topology.id] ?? FSW_HI_HZ)];

    for (const fsw of grid) {
      const shared = buildShared(effSpec, ts.topology.id, fsw, warnings);
      for (const dev of shared.primaryPool) {
        cands.push(evaluateCandidate(effSpec, ts, fsw, dev, shared));
      }
    }
  }
  markPareto(cands);
  scoreCandidates(cands);

  // ---- 3. Winner selection ------------------------------------------------
  let pool = cands.filter((c) => c.feasible);
  if (pool.length === 0) {
    warnings.push(
      "No candidate passes the thermal feasibility check; selecting the " +
        "least-bad design — expect derating or a cooling upgrade.",
    );
    pool = cands;
  }
  if (effSpec.targetEfficiencyPct !== undefined) {
    const meet = pool.filter((c) => c.effPct >= effSpec.targetEfficiencyPct!);
    if (meet.length > 0) pool = meet;
    else
      warnings.push(
        `No candidate reaches the ${effSpec.targetEfficiencyPct} % efficiency ` +
          `target; best available is ${roundSig(Math.max(...pool.map((c) => c.effPct)), 4)} %.`,
      );
  }
  if (effSpec.costCeilingUsd !== undefined) {
    const meet = pool.filter((c) => c.costUsd <= effSpec.costCeilingUsd!);
    if (meet.length > 0) pool = meet;
    else
      warnings.push(
        `No candidate meets the $${effSpec.costCeilingUsd} cost ceiling; ` +
          `cheapest is ~$${roundSig(Math.min(...pool.map((c) => c.costUsd)), 3)}.`,
      );
  }
  const winner = pool.reduce((best, c) => (c.score > best.score ? c : best), pool[0]);

  const candidates: DesignCandidateSummary[] = cands
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((c) => ({
      topologyId: c.topoScore.topology.id,
      deviceId: c.assignments[c.shared.primaryIdx].device.id,
      fswHz: roundSig(c.fsw, 4),
      efficiencyPct: roundSig(c.effPct, 4),
      bomCostUsd: roundSig(c.costUsd, 4),
      powerDensityWPerL: roundSig(c.densityWPerL, 4),
      feasible: c.feasible,
      pareto: c.pareto,
    }));

  // ---- 4. Compose the winner into a full DesignResult ---------------------
  const topo = winner.topoScore.topology;
  const fsw = winner.fsw;
  const sh = winner.shared;
  const specForBuild: DesignSpec = { ...effSpec, fswHz: fsw };

  const allDevices = winner.assignments.map((a) => a.device);
  const driver = pickGateDriver(allDevices, fsw);
  const controller = pickController(fsw);

  const schematic = buildSchematic(topo.id, specForBuild, {
    switches: winner.losses.devices,
    magnetics: sh.mags,
    driver,
    controller,
    caps: [
      { part: sh.inBank.part, qty: sh.inBank.qty },
      { part: sh.outBank.part, qty: sh.outBank.qty },
    ],
  });

  const extras: BomLine[] = [];
  if (winner.thermal.heatsink) {
    const hs = winner.thermal.heatsink;
    extras.push({
      ref: ["HS1"],
      partId: hs.id,
      mfr: hs.mfr,
      description: `Heatsink ${hs.footprintMm[0]}×${hs.footprintMm[1]}×${hs.heightMm} mm`,
      qty: 1,
      unitPriceUsd: hs.priceUsd,
      extPriceUsd: hs.priceUsd,
      suppliers: ["Digi-Key", "Mouser"],
    });
  }
  if (effSpec.cooling === "forced-air") {
    extras.push({
      ref: ["FAN1"],
      partId: "generic-axial-fan-40mm",
      mfr: "generic",
      description: "40 mm axial fan, 12 V, ~10 CFM",
      qty: 1,
      unitPriceUsd: 3.5,
      extPriceUsd: 3.5,
      suppliers: ["Digi-Key", "Mouser"],
    });
  }
  const bom = buildBom(schematic, extras);

  const lUh = controlInductanceUh(sh.mags);
  const cOutUf = Math.max(sh.outBank.totalUf, 0.1);

  let compensator: DesignResult["compensator"];
  try {
    compensator = designCompensator(topo.id, effSpec, fsw, lUh, cOutUf);
  } catch (e) {
    warnings.push(`Compensator design skipped: ${(e as Error).message}`);
  }

  let simulation: DesignResult["simulation"];
  try {
    simulation = simulate(topo.id, effSpec, fsw, lUh, cOutUf);
  } catch (e) {
    warnings.push(`Simulation skipped: ${(e as Error).message}`);
  }

  let firmware: DesignResult["firmware"];
  if (compensator) {
    try {
      firmware = generateFirmware("STM32G474", topo.id, effSpec, fsw, compensator);
    } catch (e) {
      warnings.push(`Firmware generation skipped: ${(e as Error).message}`);
    }
  }

  const layout = layoutGuidance(topo.id, specForBuild, fsw);
  const curve = efficiencyCurve(effSpec, winner);

  // ---- 5. Warnings --------------------------------------------------------
  if (!winner.thermal.ok) {
    warnings.push(
      `Thermal check fails: worst junction margin ${roundSig(winner.thermal.worstMarginC, 3)} °C.`,
    );
  } else if (winner.thermal.worstMarginC < 15) {
    warnings.push(
      `Thermal margin is thin: worst junction margin ` +
        `${roundSig(winner.thermal.worstMarginC, 3)} °C (< 15 °C design margin).`,
    );
  }
  for (const m of sh.mags) {
    if (m.windowUtilization > 0.45) {
      warnings.push(
        `${m.role} (${m.core.id}): window utilization ${roundSig(100 * m.windowUtilization, 3)} % ` +
          `is above the ~45 % practical winding limit.`,
      );
    }
    if (m.tempRiseC > 50) {
      warnings.push(
        `${m.role} (${m.core.id}): estimated ${roundSig(m.tempRiseC, 3)} °C hot-spot rise — ` +
          `consider a larger core or better airflow.`,
      );
    }
  }
  if (spec.targetEfficiencyPct !== undefined && winner.effPct < spec.targetEfficiencyPct) {
    warnings.push(
      `Winner efficiency ${roundSig(winner.effPct, 4)} % misses the ` +
        `${spec.targetEfficiencyPct} % target.`,
    );
  }
  if (spec.costCeilingUsd !== undefined && bom.totalUsd > spec.costCeilingUsd) {
    warnings.push(
      `Detailed BOM $${bom.totalUsd} exceeds the $${spec.costCeilingUsd} ceiling.`,
    );
  }
  for (const note of sh.ops.notes) {
    if (/warning/i.test(note)) warnings.push(note);
  }
  if (topo.id === "totem-pole-pfc" && (effSpec.rippleVoutPct ?? 1) < 5) {
    warnings.push(
      `A ${effSpec.rippleVoutPct ?? 1} % ripple spec on the PFC DC link is unrealistic: ` +
        "the link inherently carries twice-line-frequency energy ripple " +
        "(bulk bank sized for ~5 % pk-pk). Tight output ripple belongs to the " +
        "downstream DC-DC stage.",
    );
  }

  // ---- 6. Compliance last -------------------------------------------------
  const preCompliance = {
    spec: effSpec,
    topology: topo,
    topologyRationale: winner.topoScore.rationale,
    fswHz: fsw,
    devices: winner.losses.devices,
    losses: winner.losses,
    efficiencyPct: roundSig(winner.effPct, 4),
    efficiencyCurve: curve,
    magnetics: sh.mags,
    thermal: winner.thermal,
    ...(compensator ? { compensator } : {}),
    ...(simulation ? { simulation } : {}),
    schematic,
    bom: bom.lines,
    bomCostUsd: bom.totalUsd,
    layout,
    ...(firmware ? { firmware } : {}),
    warnings,
  };
  const compliance = checkCompliance(preCompliance);
  if (!compliance.passed) {
    const fails = compliance.findings.filter((f) => f.severity === "fail").length;
    warnings.push(`Compliance: ${fails} rule${fails === 1 ? "" : "s"} failed — see report.`);
  }

  return { ...preCompliance, compliance, candidates, warnings };
}

export function optimize(spec: DesignSpec): {
  candidates: DesignCandidateSummary[];
  best: DesignResult;
} {
  const best = designConverter(spec);
  return { candidates: best.candidates, best };
}
