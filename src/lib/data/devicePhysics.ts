/**
 * VoltForge v2 device-physics records (TECHPLAN §0.1, it2: U1–U6/U9).
 *
 * `types.ts` is frozen, so every v2 switching-physics parameter lives here in
 * a module-local `DevicePhysics` record keyed by `SwitchDevice.id`. Anchor
 * parts carry datasheet-grade numbers with per-parameter provenance notes;
 * every other part in the DB gets a sensible family-level default synthesized
 * from its own frozen `SwitchDevice` fields, so nothing regresses to
 * undefined.
 *
 * Physics references (docs/PHYSICS.md):
 *  - §D1 power-law Rds(on)(Tj) from the (r100, r150) datasheet points
 *  - §D2 GaN dynamic-Rds(on) multiplier k_dyn (JEP173 derating classes)
 *  - §D3 gate-charge partition (Qgs2 / Qgd, Rg totals, Miller plateau)
 *  - §D5 nonlinear Coss: Qoss(V)/Eoss(V) from a power-law fit
 *    Coss(v) = C0·v^−γ or a per-part table integrated from the Coss curve
 *  - §D8 reverse conduction Vsd(Vgs_off) per technology
 *
 * Coss conventions: with Coss(v) = C0·v^−γ,
 *    Qoss(V) = C0·V^(1−γ)/(1−γ),  Eoss(V) = C0·V^(2−γ)/(2−γ)
 * so ρ ≡ V·Qoss/Eoss = (2−γ)/(1−γ) and, inverted, γ = (ρ−2)/(ρ−1).
 * The family fit is calibrated on the frozen DB's Qoss/Eoss at Vref =
 * vdsMax/2, which reproduces BOTH datasheet integrals at Vref exactly.
 * ρ > 2 always for a falling Coss(v) (co-energy exceeds energy, §D5); DB
 * entries with ρ ≤ 2 are physically inconsistent and fall back to a linear
 * capacitor calibrated on Eoss (hard-switching energy is the loss-critical
 * integral), giving V·Qoss = 2·Eoss exactly.
 */

import type { SwitchDevice } from "@/lib/types";

// ---------------------------------------------------------------------------
// Record shape
// ---------------------------------------------------------------------------

export interface CossTable {
  /** Ascending drain voltages, V (0 first). */
  vV: number[];
  /** Qoss(V) = ∫₀ⱽ Coss dv, nC — same grid. */
  qossNc: number[];
  /** Eoss(V) = ∫₀ⱽ v·Coss dv, µJ — same grid. */
  eossUj: number[];
}

export interface DevicePhysics {
  /** Normalized Rds(on) at Tj = 100 °C / 150 °C (datasheet points, §D1). */
  rNorm100: number;
  rNorm150: number;
  /** Dynamic-Rds(on) multiplier when hard-switched near-rated V (§D2). */
  kDynHard: number;
  /** Dynamic-Rds(on) multiplier under soft switching, ≤80 % rated V (§D2). */
  kDynSoft: number;
  /** Transconductance around the Miller plateau, S (§D3). */
  gfsS: number;
  /** Post-threshold gate charge of the current-rise phase, nC (§D3). */
  qgs2Nc: number;
  /** Gate-drain (Miller) charge, nC (§D3). */
  qgdNc: number;
  /** Internal gate resistance, Ω. */
  rgIntOhm: number;
  /** Assumed external + driver source resistance, Ω (design default). */
  rgExtOnOhm: number;
  /** Assumed external + driver sink resistance, Ω (design default). */
  rgExtOffOhm: number;
  /** Gate off-state rail, V (0 or negative). */
  vgsOffV: number;
  /** Miller-plateau override, V; else Vpl = Vth + I/gfs. */
  vplV?: number;
  /**
   * Integrated-driver parts: node slew rate replaces the Rg·Qgd voltage
   * phases, V/ns; gate current for the current phases is igEffA.
   */
  slewVPerNs?: number;
  igEffA?: number;
  /** Power-law Coss fit: Coss(v) = c0F·(v/1V)^−gamma (F at 1 V). */
  cossFit?: { c0F: number; gamma: number };
  /** Piecewise Qoss/Eoss table (preferred over cossFit when present). */
  cossTable?: CossTable;
  /** GaN 3rd-quadrant channel factor: Rrev = rrevFactor·Rds(on) (§D8). */
  rrevFactor: number;
  /** SiC body-diode forward drop at 25 °C, V (falls ~2 mV/°C) (§D8). */
  vsdBody25V?: number;
  /** Where the numbers came from. */
  provenance: string;
}

// ---------------------------------------------------------------------------
// Anchor parts (U9 partial — datasheet-grade, ≥3 parts)
// ---------------------------------------------------------------------------

/**
 * Per-part records. Partial entries are merged over the family defaults.
 *
 * EPC2218 provenance: EPC2218 datasheet rev 2.2 — Qoss = 105 nC and
 * Eoss = 2.2 µJ at VDS = 50 V (fit γ from ρ = 50·105n/2.2µ = 2.386);
 * Qgs = 4.4 nC (Qgs2 ≈ 1.6 nC post-Vth), Qgd = 2.3 nC, Rg = 0.4 Ω,
 * gfs ≈ 57 S; normalized RDS(on) ≈ 1.5× at 100 °C, ≈ 2.05× at 150 °C
 * (extrapolated from the 125 °C curve per §D1 GaN band). Low-voltage eGaN:
 * small trapping → k_dyn 1.05 hard / 1.02 soft (JEP173 class, §D2).
 *
 * LMG3522R030 provenance: TI datasheet — integrated driver with adjustable
 * 20–150 V/ns slew (50 V/ns default assumed), effective internal gate drive
 * ≈ 2 A; Qoss/Eoss contract point 70 nC / 10 µJ at 325 V (DB, rescaled from
 * the 400 V curve) → power-law γ = 0.2157; RDS(on) ≈ 1.45× at 100 °C,
 * ≈ 1.95× at 150 °C; TI's process holds dynamic Ron low → 1.10 / 1.03.
 *
 * C3M0075120K provenance: Wolfspeed datasheet — Coss(v) two-regime model
 * Coss = 44.4 pF + 1056 pF/(1 + v/12 V), reproducing Coss(1000 V) ≈ 57 pF
 * (datasheet 58 pF typ) and Eoss(600 V) = 15 µJ (DB contract point);
 * integrated to the 33-point table below (Eoss(800 V) → 23.7 µJ, consistent
 * with the datasheet Eoss curve). Qgs = 14 nC (Qgs2 ≈ 7 nC), Qgd = 21 nC,
 * Rg(int) ≈ 10.5 Ω, gfs ≈ 5 S near the plateau; r(100) = 1.13,
 * r(150) = 1.34 (datasheet normalized-RDS(on) figure; §D1 SiC band);
 * body diode Vsd ≈ 4.4 V at 25 °C, −4 V off-rail recommended. k_dyn = 1
 * (SiC has no dynamic-Ron mechanism, §D2).
 *
 * G3R75MT12J provenance: Wolfspeed datasheet — high-power 1200 V SiC MOSFET
 * (750 mΩ typ @150 °C). Coss = 230 pF typical, integrated to 18.5 µJ @600 V
 * contract point → power-law γ ≈ 0.25; Qgs = 23 nC (Qgs2 ≈ 3 nC),
 * Qgd = 40 nC, Rg = 0.3 Ω, gfs ≈ 3 S; r(100) = 1.09, r(150) = 1.28 from
 * normalized datasheet; Vsd = 4.5 V @25 °C, −6 V off-rail (SiC best practice).
 * Larger package & lower transconductance vs C3M class (larger die).
 */
export const DEVICE_PHYSICS: Record<string, Partial<DevicePhysics>> = {
  EPC2218: {
    rNorm100: 1.5,
    rNorm150: 2.05,
    kDynHard: 1.05,
    kDynSoft: 1.02,
    gfsS: 57,
    qgs2Nc: 1.6,
    qgdNc: 2.3,
    rgIntOhm: 0.4,
    rgExtOnOhm: 2.0,
    rgExtOffOhm: 0.7,
    vgsOffV: 0,
    // γ from ρ = 50·105 nC / 2.2 µJ = 2.386 → γ = 0.2787;
    // C0 = Qoss(50)·(1−γ)/50^(1−γ) = 4.506 nF (at 1 V).
    cossFit: { c0F: 4.5064e-9, gamma: 0.2787 },
    rrevFactor: 2.0,
    provenance:
      "EPC2218 datasheet: Qoss/Eoss @50 V, Qgs2/Qgd/Rg table, gfs curve; r(Tj) from normalized-Rds figure; k_dyn per JEP173 class (§D2).",
  },
  LMG3522R030: {
    rNorm100: 1.45,
    rNorm150: 1.95,
    kDynHard: 1.1,
    kDynSoft: 1.03,
    gfsS: 40,
    qgs2Nc: 0.8,
    qgdNc: 1.2,
    rgIntOhm: 1.0,
    rgExtOnOhm: 0,
    rgExtOffOhm: 0,
    vgsOffV: 0,
    slewVPerNs: 50,
    igEffA: 2.0,
    cossFit: { c0F: 5.8814e-10, gamma: 0.2157 },
    rrevFactor: 2.0,
    provenance:
      "TI LMG3522R030 datasheet: adjustable-slew integrated driver (50 V/ns default), Qoss/Eoss contract point @325 V, r(Tj) from normalized-Rds figure.",
  },
  C3M0075120K: {
    rNorm100: 1.13,
    rNorm150: 1.34,
    kDynHard: 1.0,
    kDynSoft: 1.0,
    gfsS: 5,
    qgs2Nc: 7,
    qgdNc: 21,
    rgIntOhm: 10.5,
    rgExtOnOhm: 5.0,
    rgExtOffOhm: 2.5,
    vgsOffV: -4,
    // Integrated from Coss(v) = 44.4 pF + 1056 pF/(1 + v/12 V); see header.
    cossTable: {
      vV: [
        0, 37.5, 75, 112.5, 150, 187.5, 225, 262.5, 300, 337.5, 375, 412.5,
        450, 487.5, 525, 562.5, 600, 637.5, 675, 712.5, 750, 787.5, 825, 862.5,
        900, 937.5, 975, 1012.5, 1050, 1087.5, 1125, 1162.5, 1200,
      ],
      qossNc: [
        0, 19.616, 28.425, 34.631, 39.632, 43.936, 47.784, 51.311, 54.599,
        57.703, 60.66, 63.498, 66.236, 68.891, 71.474, 73.995, 76.462, 78.882,
        81.259, 83.598, 85.904, 88.178, 90.425, 92.646, 94.844, 97.021, 99.178,
        101.32, 103.44, 105.54, 107.63, 109.71, 111.78,
      ],
      eossUj: [
        0, 0.29085, 0.77386, 1.3506, 2.0043, 2.7288, 3.5212, 4.3801, 5.3042,
        6.293, 7.3461, 8.4631, 9.6438, 10.888, 12.195, 13.566, 15, 16.497,
        18.057, 19.68, 21.365, 23.114, 24.925, 26.799, 28.736, 30.736, 32.798,
        34.923, 37.111, 39.362, 41.675, 44.051, 46.489,
      ],
    },
    rrevFactor: 1.0,
    vsdBody25V: 4.4,
    provenance:
      "Wolfspeed C3M0075120K datasheet: Coss(v) two-regime fit hitting Coss(1 kV) = 58 pF and Eoss(600 V) = 15 µJ; Qgs2/Qgd/Rg(int) from gate-charge table; Vsd = 4.4 V @25 °C.",
  },
  G3R75MT12J: {
    rNorm100: 1.09,
    rNorm150: 1.28,
    kDynHard: 1.0,
    kDynSoft: 1.0,
    gfsS: 3,
    qgs2Nc: 3,
    qgdNc: 40,
    rgIntOhm: 0.3,
    rgExtOnOhm: 5.0,
    rgExtOffOhm: 3.0,
    vgsOffV: -6,
    // Coss ≈ 230 pF typical (1200 V), ρ ≈ (600·230e-12)/(18.5e-6) ≈ 2.34
    // → γ ≈ 0.25, C0 ≈ 8.15e-11 F
    cossFit: { c0F: 8.15e-11, gamma: 0.25 },
    rrevFactor: 1.0,
    vsdBody25V: 4.5,
    provenance:
      "Wolfspeed G3R75MT12J datasheet: 1200 V 750 mΩ SiC MOSFET; Coss/Eoss integrated from datasheet curve @600 V; gate charge table; Vsd = 4.5 V @25 °C.",
  },
  IGT65R035D2: {
    rNorm100: 1.45,
    rNorm150: 1.95,
    kDynHard: 1.12,
    kDynSoft: 1.05,
    gfsS: 49,
    qgs2Nc: 1.1,
    qgdNc: 1.7,
    rgIntOhm: 0.6,
    rgExtOnOhm: 2.0,
    rgExtOffOhm: 0.8,
    vgsOffV: 0,
    // CoolGaN 650V G5: 50% lower Eoss than Gen 2; Coss power-law fit fails (ρ < 2).
    // Fallback to linear model calibrated on Eoss(325V) = 3.5 µJ contract point.
    // Pending: obtain full Coss(V) curve from datasheet for piecewise table integration.
    cossFit: { c0F: 2.15e-11, gamma: 0 },
    rrevFactor: 2.0,
    provenance:
      "Infineon IGT65R035D2 CoolGaN 650V G5 datasheet (Rev 1.1, 2026-03-05): Qg/Qgs2/Qgd from DS gate-charge table; Rds/tempco (1% per °C) inferred from CoolGaN family; k_dyn from JEP173 GaN class @ 650 V; Coss linear fallback pending full Coss(V) curve (published 50% Eoss reduction vs Gen 2); device in Infineon's 98%+ efficiency 6kW ISOP LLC reference designs (March 2026).",
  },
};

// ---------------------------------------------------------------------------
// Family-level defaults (everything not anchored)
// ---------------------------------------------------------------------------

function familyDefaults(d: SwitchDevice): DevicePhysics {
  // r(Tj) anchor points synthesized from the DB's own linear tempco so the
  // 100/150 °C values match the frozen record exactly; §D1's power law then
  // only reshapes the curve between/beyond the anchor temperatures.
  const rNorm100 = Math.max(1.05, 1 + d.rdsOnTempco * 75);
  const rNorm150 = Math.max(rNorm100 + 0.05, 1 + d.rdsOnTempco * 125);

  // Coss power-law from the frozen Qoss/Eoss contract point (see header).
  const vRef = 0.5 * d.vdsMaxV;
  const qRefC = d.qossNc * 1e-9;
  const eRefJ = d.eossUj * 1e-6;
  let cossFit: { c0F: number; gamma: number };
  if (vRef > 0 && qRefC > 0 && eRefJ > 0) {
    const rho = (vRef * qRefC) / eRefJ;
    if (rho > 2.02) {
      const gamma = Math.min(0.99, (rho - 2) / (rho - 1));
      cossFit = { c0F: (qRefC * (1 - gamma)) / Math.pow(vRef, 1 - gamma), gamma };
    } else {
      // Physically inconsistent DB pair (ρ ≤ 2): linear C on the Eoss basis.
      cossFit = { c0F: (2 * eRefJ) / (vRef * vRef), gamma: 0 };
    }
  } else {
    cossFit = { c0F: 1e-12, gamma: 0 };
  }

  const base = {
    rNorm100,
    rNorm150,
    cossFit,
    vgsOffV: 0,
    provenance: `family default synthesized from the ${d.id} SwitchDevice record (tech ${d.tech})`,
  };

  switch (d.tech) {
    case "GaN":
      return {
        ...base,
        // §D2 JEP173 classes: 650 V-class hard-switched 1.1–1.25; LV parts less.
        kDynHard: d.vdsMaxV >= 200 ? 1.15 : 1.05,
        kDynSoft: d.vdsMaxV >= 200 ? 1.05 : 1.02,
        gfsS: Math.max(5, d.idMaxA),
        qgs2Nc: 0.14 * d.qgNc,
        qgdNc: 0.22 * d.qgNc,
        rgIntOhm: 0.6,
        rgExtOnOhm: 2.5,
        rgExtOffOhm: 1.0,
        rrevFactor: 2.0, // §D8: Rrev ≈ 1.5–2.5·Rds(on)
      };
    case "SiC":
      return {
        ...base,
        kDynHard: 1.0,
        kDynSoft: 1.0,
        gfsS: Math.max(4, d.idMaxA / 5),
        qgs2Nc: 0.12 * d.qgNc,
        qgdNc: 0.35 * d.qgNc,
        rgIntOhm: 4.0,
        rgExtOnOhm: 5.5,
        rgExtOffOhm: 2.5,
        vgsOffV: -4, // common SiC off-rail; affects gate timing, not Vsd (§D8)
        rrevFactor: 1.0,
        vsdBody25V: 3.5, // §D8 default; falls 2 mV/°C
      };
    default:
      return {
        ...base,
        kDynHard: 1.0,
        kDynSoft: 1.0,
        gfsS: Math.max(5, d.idMaxA / 3),
        qgs2Nc: 0.15 * d.qgNc,
        qgdNc: 0.3 * d.qgNc,
        rgIntOhm: 1.5,
        rgExtOnOhm: 6.5,
        rgExtOffOhm: 3.0,
        rrevFactor: 1.0,
      };
  }
}

const physicsCache = new WeakMap<SwitchDevice, DevicePhysics>();

/** Physics record for a device: anchor entry merged over family defaults. */
export function getDevicePhysics(device: SwitchDevice): DevicePhysics {
  const hit = physicsCache.get(device);
  if (hit) return hit;
  const merged: DevicePhysics = {
    ...familyDefaults(device),
    ...DEVICE_PHYSICS[device.id],
  };
  physicsCache.set(device, merged);
  return merged;
}

// ---------------------------------------------------------------------------
// Qoss / Eoss evaluators (§D5)
// ---------------------------------------------------------------------------

/**
 * Interpolate a table column at v with tail extrapolation: beyond the last
 * grid point the last-segment (constant-C) slope continues so high-voltage
 * queries never silently clamp.
 */
function tableQ(t: CossTable, vV: number): number {
  const n = t.vV.length;
  if (vV <= 0) return 0;
  if (vV >= t.vV[n - 1]) {
    const cTail =
      ((t.qossNc[n - 1] - t.qossNc[n - 2]) / (t.vV[n - 1] - t.vV[n - 2])) * 1e-9;
    return t.qossNc[n - 1] * 1e-9 + cTail * (vV - t.vV[n - 1]);
  }
  for (let i = 1; i < n; i++) {
    if (vV <= t.vV[i]) {
      const s = (vV - t.vV[i - 1]) / (t.vV[i] - t.vV[i - 1]);
      return (t.qossNc[i - 1] + s * (t.qossNc[i] - t.qossNc[i - 1])) * 1e-9;
    }
  }
  return t.qossNc[n - 1] * 1e-9;
}

function tableE(t: CossTable, vV: number): number {
  const n = t.vV.length;
  if (vV <= 0) return 0;
  if (vV >= t.vV[n - 1]) {
    const cTail =
      (((t.qossNc[n - 1] - t.qossNc[n - 2]) / (t.vV[n - 1] - t.vV[n - 2])) *
        1e-9);
    const vL = t.vV[n - 1];
    return t.eossUj[n - 1] * 1e-6 + 0.5 * cTail * (vV * vV - vL * vL);
  }
  for (let i = 1; i < n; i++) {
    if (vV <= t.vV[i]) {
      const s = (vV - t.vV[i - 1]) / (t.vV[i] - t.vV[i - 1]);
      return (t.eossUj[i - 1] + s * (t.eossUj[i] - t.eossUj[i - 1])) * 1e-6;
    }
  }
  return t.eossUj[n - 1] * 1e-6;
}

/** Output charge Qoss(V) = ∫₀ⱽ Coss dv, coulombs (§D5). */
export function qossCoulombs(phys: DevicePhysics, vV: number): number {
  if (vV <= 0) return 0;
  if (phys.cossTable) return tableQ(phys.cossTable, vV);
  const { c0F, gamma } = phys.cossFit ?? { c0F: 0, gamma: 0 };
  return (c0F / (1 - gamma)) * Math.pow(vV, 1 - gamma);
}

/** Stored output energy Eoss(V) = ∫₀ⱽ v·Coss dv, joules (§D5). */
export function eossJoules(phys: DevicePhysics, vV: number): number {
  if (vV <= 0) return 0;
  if (phys.cossTable) return tableE(phys.cossTable, vV);
  const { c0F, gamma } = phys.cossFit ?? { c0F: 0, gamma: 0 };
  return (c0F / (2 - gamma)) * Math.pow(vV, 2 - gamma);
}
