/**
 * VoltForge magnetics design engine.
 *
 * designMagnetic(req, ambientC):
 *   1. area-product preselect over the CORES catalog
 *   2. turns: inductors from L·Ipk/(Bmax·Ae) (saturation, 20 % Bsat margin) and
 *      gap realizability; transformers from N1 ≥ V·s/(ΔB·Ae) with ΔB chosen for
 *      ~200 kW/m³ core loss (capped at 0.8·Bsat)
 *   3. air gap from the required AL (µ0·N²·Ae/L − le/µr)
 *   4. wire pick at J ≈ 4–6 A/mm², litz at/above 100 kHz, window fill ≤ 0.4
 *   5. core loss: Steinmetz fit with iGSE-style triangular-waveform factor
 *   6. copper loss: Dowell low-penetration AC-resistance factor (porosity
 *      corrected; litz uses effective strand layers m·√n) blended by the AC
 *      current fraction, Rdc at ~100 °C
 *   7. temp rise: Rth ≈ 36/√(Ve[cm³]) °C/W surface heuristic
 *
 * NEVER throws: every candidate (core × turn count) is scored with penalty
 * terms for B-field, window, gap, current density and temperature violations,
 * and the least-bad design is returned with warnings in `notes`, so the
 * optimizer can rank feasibility across the whole candidate space.
 */

import type {
  CoreMaterial,
  CoreShape,
  MagneticDesign,
  MagneticRequirement,
  WireSpec,
} from "@/lib/types";
import { clamp, roundSig } from "@/lib/util";
import { CORES, CORE_MATERIALS, WIRES } from "@/lib/data/magnetics";

const MU0 = 4e-7 * Math.PI; // H/m
const KU_MAX = 0.4; // max window utilization (copper/window)
const BSAT_MARGIN = 0.8; // use at most 80 % of Bsat
const J_TARGET_A_MM2 = 5; // aim 4–6 A/mm²
const J_HARD_A_MM2 = 8; // beyond this: penalized
const PV_TARGET_KW_M3 = 200; // transformer flux swing sized for this loss density
const LITZ_MIN_HZ = 100e3; // litz at/above 100 kHz
const IGSE_TRI = 1.15; // iGSE triangular-vs-sinusoid waveform factor
const CU_HOT = 1.3; // copper Rdc at ~95–100 °C vs 20 °C
const MAX_GAP_MM = 3; // fringing gets ugly beyond this

interface WindingEval {
  wire: WireSpec;
  lossW: number;
  jAmm2: number;
  copperMm2: number; // n · wire copper area
  overflow: boolean; // could not fit inside its window budget
}

interface Candidate {
  core: CoreShape;
  mat: CoreMaterial;
  n1: number;
  n2?: number;
  gapMm: number;
  bPeakT: number;
  bacT: number;
  inductanceUh: number;
  primary: WindingEval;
  secondary?: WindingEval;
  coreLossW: number;
  copperLossW: number;
  utilization: number;
  tempRiseC: number;
  score: number;
  warnings: string[];
}

function materialOf(core: CoreShape): CoreMaterial {
  return CORE_MATERIALS.find((m) => m.id === core.materialId) ?? CORE_MATERIALS[0];
}

/** Steinmetz Pv [kW/m³] → core loss in W (iGSE-style triangular factor). */
function coreLossW(mat: CoreMaterial, veMm3: number, fHz: number, bacT: number): number {
  if (bacT <= 0) return 0;
  const pvKwM3 =
    mat.steinmetzK * Math.pow(fHz, mat.steinmetzAlpha) * Math.pow(bacT, mat.steinmetzBeta);
  return IGSE_TRI * pvKwM3 * veMm3 * 1e-6; // kW/m³ · mm³ · 1e-9 m³/mm³ · 1e3 W/kW
}

const byArea = (a: WireSpec, b: WireSpec) => a.copperAreaMm2 - b.copperAreaMm2;

/**
 * Pick a wire for one winding: J close to 4–6 A/mm², total copper within the
 * window budget. Litz at/above 100 kHz, with fallback to the full table when
 * nothing fits (fine solid wire for low-current HF windings).
 */
function pickWire(
  n: number,
  iRmsA: number,
  fHz: number,
  budgetMm2: number
): { wire: WireSpec; overflow: boolean } {
  const litz = WIRES.filter((w) => w.type === "litz").sort(byArea);
  const solid = WIRES.filter((w) => w.type === "solid").sort(byArea);
  const all = [...WIRES].sort(byArea);
  const pools = fHz >= LITZ_MIN_HZ ? [litz, all] : [solid, all];
  for (const pool of pools) {
    const fits = pool.filter((w) => n * w.copperAreaMm2 <= budgetMm2);
    if (fits.length > 0) {
      let best = fits[0];
      let bestD = Infinity;
      for (const w of fits) {
        const j = iRmsA / w.copperAreaMm2;
        const d = Math.abs(Math.log(j / J_TARGET_A_MM2)); // ratio distance to J=5
        if (d < bestD) {
          bestD = d;
          best = w;
        }
      }
      return { wire: best, overflow: false };
    }
  }
  return { wire: all[0], overflow: true }; // nothing fits — smallest wire, flagged
}

/** Dowell-style AC copper loss for one winding (low-penetration expansion). */
function windingLoss(
  core: CoreShape,
  wire: WireSpec,
  n: number,
  iRmsA: number,
  fHz: number,
  acCurFrac: number
): number {
  const areaMm2 = wire.copperAreaMm2;
  // Winding breadth from window (≈2:1 window aspect ratio)
  const breadthMm = 1.45 * Math.sqrt(core.awMm2);
  const outerMm2 = wire.type === "litz" ? areaMm2 / 0.45 : areaMm2 * 1.15;
  const diaOMm = 2 * Math.sqrt(outerMm2 / Math.PI);
  const turnsPerLayer = Math.max(1, Math.floor(breadthMm / diaOMm));
  const layers = Math.ceil(n / turnsPerLayer);
  const deltaMm = 76 / Math.sqrt(fHz); // Cu skin depth at ~100 °C
  const dsMm =
    wire.type === "litz" && wire.strandDiaMm
      ? wire.strandDiaMm
      : 2 * Math.sqrt(areaMm2 / Math.PI);
  const xi = dsMm / deltaMm;
  const mEff =
    wire.type === "litz" && wire.strandCount
      ? layers * Math.sqrt(wire.strandCount) // effective strand layers (Sullivan)
      : layers;
  const porosity2 = wire.type === "litz" ? 0.36 : 0.55; // layer porosity η² correction
  const fr = clamp(1 + ((5 * mEff * mEff - 1) / 45) * Math.pow(xi, 4) * porosity2, 1, 25);
  // Only the AC fraction of the current sees Rac (DC bias sees Rdc)
  const frEff = 1 + (fr - 1) * acCurFrac * acCurFrac;
  const rdcOhm = n * (core.mltMm / 1000) * (wire.rdcMohmPerM / 1000) * CU_HOT;
  return frEff * rdcOhm * iRmsA * iRmsA;
}

interface Sanitized {
  isXfmr: boolean;
  lH: number; // target inductance, H (inductors; transformer magnetizing target if > 0)
  ipkA: number;
  irmsA: number;
  fHz: number;
  vus: number; // V·µs
  acFrac: number;
  ratio: number; // Np/Ns
  assumed: string[];
}

function sanitize(req: MagneticRequirement): Sanitized {
  const assumed: string[] = [];
  const isXfmr = req.role === "transformer";
  let vus = Math.max(0, req.voltSecondsVus);
  if (isXfmr && vus <= 0) {
    vus = 100;
    assumed.push("voltSecondsVus missing — assumed 100 V·µs");
  }
  let lH = Math.max(0, req.inductanceUh) * 1e-6;
  if (!isXfmr && lH < 1e-8) {
    lH = 1e-8;
    assumed.push("inductanceUh missing — assumed 0.01 µH");
  }
  return {
    isXfmr,
    lH,
    ipkA: Math.max(1e-3, req.iPeakA),
    irmsA: Math.max(1e-3, req.iRmsA),
    fHz: clamp(req.fswHz, 1e4, 5e6),
    vus,
    acFrac: clamp(req.acFluxFraction, 0.02, 1),
    ratio: req.turnsRatio && req.turnsRatio > 0 ? req.turnsRatio : 1,
    assumed,
  };
}

/** Required area product [mm⁴] for the preselect (Ku=0.4, J=5 A/mm²). */
function areaProductReqMm4(s: Sanitized): number {
  const jAm2 = J_TARGET_A_MM2 * 1e6;
  const apM4 = s.isXfmr
    ? (s.vus * 1e-6 * s.irmsA * 2) / (KU_MAX * jAm2 * 0.2) // both windings, ΔB≈0.2 T
    : (s.lH * s.ipkA * s.irmsA) / (KU_MAX * jAm2 * 0.3); // Bmax≈0.3 T
  return apM4 * 1e12;
}

function evaluate(
  core: CoreShape,
  mat: CoreMaterial,
  n1: number,
  s: Sanitized,
  ambientC: number
): Candidate {
  const warnings: string[] = [];
  const aeM2 = core.aeMm2 * 1e-6;
  const leM = core.leMm * 1e-3;
  const al0 = (MU0 * mat.muR * aeM2) / leM; // ungapped AL, H/turn²
  const bLim = BSAT_MARGIN * mat.bsatT;

  let n2: number | undefined;
  let gapM = 0;
  let bPeakT: number;
  let bacT: number;
  let inductanceUh: number;
  let lMissFrac = 0; // fraction of a magnetizing-L target left unmet

  if (s.isXfmr) {
    n2 = Math.max(1, Math.round(n1 / s.ratio));
    bacT = s.vus / (2 * n1 * core.aeMm2); // bipolar swing: ΔB = 2·Bac
    bPeakT = bacT;
    if (s.lH > 0) {
      const alNeed = s.lH / (n1 * n1);
      if (alNeed < al0) {
        gapM = (MU0 * n1 * n1 * aeM2) / s.lH - leM / mat.muR; // gapped magnetizing L
        inductanceUh = s.lH * 1e6;
        // gapped (flyback-style): DC magnetizing flux adds to the swing
        bPeakT = Math.max(bacT, (s.lH * s.ipkA) / (n1 * aeM2));
      } else {
        inductanceUh = al0 * n1 * n1 * 1e6;
        lMissFrac = Math.max(0, 1 - (al0 * n1 * n1) / s.lH);
        warnings.push(
          `magnetizing L limited to ${roundSig(inductanceUh, 3)} µH ungapped (target ${roundSig(
            s.lH * 1e6,
            3
          )} µH)`
        );
      }
    } else {
      inductanceUh = al0 * n1 * n1 * 1e6; // achieved (ungapped) magnetizing L
    }
  } else {
    bPeakT = (s.lH * s.ipkA) / (n1 * aeM2);
    bacT = s.acFrac * bPeakT;
    gapM = Math.max(0, (MU0 * n1 * n1 * aeM2) / s.lH - leM / mat.muR);
    inductanceUh = s.lH * 1e6;
  }
  const gapMm = gapM * 1000;

  // --- windings ---
  const acCurFrac = s.isXfmr ? 1 : clamp(1.2 * s.acFrac, 0.05, 1);
  const budget = KU_MAX * core.awMm2;
  let primary: WindingEval;
  let secondary: WindingEval | undefined;
  if (s.isXfmr && n2 !== undefined) {
    const isecA = s.irmsA * s.ratio; // ampere-turn balance
    const p = pickWire(n1, s.irmsA, s.fHz, budget / 2);
    const sec = pickWire(n2, isecA, s.fHz, budget / 2);
    primary = {
      wire: p.wire,
      lossW: windingLoss(core, p.wire, n1, s.irmsA, s.fHz, acCurFrac),
      jAmm2: s.irmsA / p.wire.copperAreaMm2,
      copperMm2: n1 * p.wire.copperAreaMm2,
      overflow: p.overflow,
    };
    secondary = {
      wire: sec.wire,
      lossW: windingLoss(core, sec.wire, n2, isecA, s.fHz, acCurFrac),
      jAmm2: isecA / sec.wire.copperAreaMm2,
      copperMm2: n2 * sec.wire.copperAreaMm2,
      overflow: sec.overflow,
    };
  } else {
    const p = pickWire(n1, s.irmsA, s.fHz, budget);
    primary = {
      wire: p.wire,
      lossW: windingLoss(core, p.wire, n1, s.irmsA, s.fHz, acCurFrac),
      jAmm2: s.irmsA / p.wire.copperAreaMm2,
      copperMm2: n1 * p.wire.copperAreaMm2,
      overflow: p.overflow,
    };
  }

  const copperMm2 = primary.copperMm2 + (secondary?.copperMm2 ?? 0);
  const utilization = copperMm2 / core.awMm2;
  const pCore = coreLossW(mat, core.veMm3, s.fHz, bacT);
  const pCu = primary.lossW + (secondary?.lossW ?? 0);
  const veCm3 = core.veMm3 / 1000;
  const rthCPerW = 36 / Math.sqrt(veCm3); // surface-cooling heuristic
  const tempRiseC = (pCore + pCu) * rthCPerW;

  // --- penalties / warnings ---
  const bOver = Math.max(0, bPeakT / bLim - 1);
  const kuOver = Math.max(0, utilization / KU_MAX - 1);
  const hotC = ambientC + tempRiseC;
  const tOver = Math.max(0, hotC - mat.maxTempC);
  const gapOver = Math.max(0, gapMm - MAX_GAP_MM);
  const jOver = Math.max(
    0,
    primary.jAmm2 - J_HARD_A_MM2,
    (secondary?.jAmm2 ?? 0) - J_HARD_A_MM2
  );
  if (bOver > 0)
    warnings.push(
      `Bpk ${roundSig(bPeakT, 3)} T exceeds 80 % Bsat limit ${roundSig(bLim, 3)} T`
    );
  if (kuOver > 0)
    warnings.push(`window utilization ${roundSig(utilization, 3)} > ${KU_MAX}`);
  if (primary.overflow || secondary?.overflow)
    warnings.push("winding does not fit the window even with the smallest wire");
  if (tOver > 0)
    warnings.push(
      `hot spot ${roundSig(hotC, 3)} °C exceeds material limit ${mat.maxTempC} °C`
    );
  if (gapOver > 0) warnings.push(`air gap ${roundSig(gapMm, 3)} mm > ${MAX_GAP_MM} mm (fringing)`);
  if (jOver > 0)
    warnings.push(`current density ${roundSig(J_HARD_A_MM2 + jOver, 3)} A/mm² > ${J_HARD_A_MM2}`);

  const score =
    pCore +
    pCu +
    0.03 * veCm3 +
    0.05 * core.priceUsd +
    500 * bOver +
    300 * kuOver +
    3 * tOver +
    20 * gapOver +
    4 * jOver +
    30 * lMissFrac;

  return {
    core,
    mat,
    n1,
    n2,
    gapMm,
    bPeakT,
    bacT,
    inductanceUh,
    primary,
    secondary,
    coreLossW: pCore,
    copperLossW: pCu,
    utilization,
    tempRiseC,
    score,
    warnings,
  };
}

/** Turn-count options for one core (base plus a few multiples to trade Bac vs copper). */
function turnOptions(core: CoreShape, mat: CoreMaterial, s: Sanitized): number[] {
  const aeM2 = core.aeMm2 * 1e-6;
  const leM = core.leMm * 1e-3;
  const bLim = BSAT_MARGIN * mat.bsatT;
  let nMin: number;
  let mults: number[];
  if (s.isXfmr) {
    // ΔB for ~PV_TARGET core-loss density, capped by saturation margin
    const bLoss = Math.pow(
      PV_TARGET_KW_M3 / (mat.steinmetzK * Math.pow(s.fHz, mat.steinmetzAlpha)),
      1 / mat.steinmetzBeta
    );
    const bac0 = Math.min(bLoss, bLim);
    nMin = Math.max(1, Math.ceil(s.vus / (2 * bac0 * core.aeMm2)));
    if (s.lH > 0) {
      // gapped (flyback-style) magnetizing target: must also carry Ipk
      // without saturating, B = L·Ipk/(N·Ae)
      const nSatGap = Math.ceil((s.lH * s.ipkA) / (bLim * aeM2));
      nMin = Math.max(nMin, Math.min(nSatGap, 20000));
    }
    mults = [1, 1.25, 1.6];
  } else {
    const al0 = (MU0 * mat.muR * aeM2) / leM;
    const nSat = Math.ceil((s.lH * s.ipkA) / (bLim * aeM2));
    const nUngap = Math.ceil(Math.sqrt(s.lH / al0)); // gap ≥ 0 needs N ≥ √(L/AL0)
    nMin = Math.max(1, nSat, nUngap);
    mults = [1, 1.3, 1.7, 2.2];
  }
  nMin = Math.min(nMin, 20000); // numeric safety for absurd requests
  const opts = mults.map((m) => Math.max(1, Math.round(nMin * m)));
  return [...new Set(opts)];
}

/**
 * Design one magnetic component for the given requirement. Always returns the
 * least-bad design (warnings land in `notes`) so the optimizer can rank
 * feasibility rather than handle exceptions.
 */
export function designMagnetic(req: MagneticRequirement, ambientC: number): MagneticDesign {
  const s = sanitize(req);
  const apReq = areaProductReqMm4(s);
  let candidates = CORES.filter((c) => c.aeMm2 * c.awMm2 >= 0.5 * apReq);
  if (candidates.length === 0) candidates = [...CORES]; // AP beyond catalog — score them all

  let best: Candidate | undefined;
  for (const core of candidates) {
    const mat = materialOf(core);
    for (const n1 of turnOptions(core, mat, s)) {
      const cand = evaluate(core, mat, n1, s, ambientC);
      if (!best || cand.score < best.score) best = cand;
    }
  }
  // CORES is non-empty, so best is always defined.
  const b = best!;

  const notes = [
    `core ${b.core.id} (${b.mat.id}); AP preselect, iGSE core loss, Dowell AC copper`,
    ...s.assumed,
    ...b.warnings,
  ].join("; ");

  return {
    role: req.role,
    core: b.core,
    material: b.mat,
    turnsPrimary: b.n1,
    ...(b.n2 !== undefined ? { turnsSecondary: b.n2 } : {}),
    airGapMm: roundSig(b.gapMm, 3),
    wirePrimary: b.primary.wire,
    ...(b.secondary ? { wireSecondary: b.secondary.wire } : {}),
    inductanceUh: roundSig(b.inductanceUh, 4),
    bPeakT: roundSig(b.bPeakT, 3),
    coreLossW: roundSig(b.coreLossW, 3),
    copperLossW: roundSig(b.copperLossW, 3),
    tempRiseC: roundSig(b.tempRiseC, 3),
    windowUtilization: roundSig(b.utilization, 3),
    notes,
  };
}
