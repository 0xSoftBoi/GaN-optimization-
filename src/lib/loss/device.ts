/**
 * VoltForge loss engine — semiconductor losses (v2, TECHPLAN it2: U1–U6).
 *
 * Prices one switch position (SwitchOperatingPoint) with a given device and
 * parallel count at a given junction temperature.
 *
 * Convention: the per-mechanism fields of DeviceLoss (conductionW, switchingW,
 * cossW, gateW, deadTimeW) are totals for ONE switch position, i.e. summed
 * across the `parallel` devices sharing that position. `totalW` multiplies by
 * `op.positions` to cover every identical position in the topology.
 *
 * v2 physics (docs/PHYSICS.md section codes):
 *  - §D1/§D2 conduction: power-law r(Tj) through the (r100, r150) datasheet
 *    points + GaN dynamic-Rds(on) multiplier k_dyn (ZVS-fraction blended)
 *  - §D3 switching times from the Qgs2/Qgd gate-charge partition with the
 *    real drive resistances and rails (replaces t = 0.5·Qg/1.5 A)
 *  - §D4 hard-switching overlap + Qrr; §D7 GaN Coss-limited Eoff cap
 *  - §D5 capacitive turn-on cost E_cap = Eoss_A + V·Qoss_B − Eoss_B
 *    (= V·Qoss for a matched pair; ~2× the old n·Eoss bookkeeping)
 *  - §D9 charge-criterion ZVS with a continuous zvsFraction and a
 *    partial-ZVS residual E_res = E_cap(ΔV_rem) from the same tables
 *  - §D8 dead-time loss Vsd(Vgs_off, I, Tj) pricing only the dead time left
 *    after the ZVS slew Q_node/|I|
 */

import type { SwitchDevice, SwitchOperatingPoint, DeviceLoss } from "@/lib/types";
import { clamp } from "@/lib/util";
import {
  getDevicePhysics,
  qossCoulombs,
  eossJoules,
  type DevicePhysics,
} from "@/lib/data/devicePhysics";

// ---------------------------------------------------------------------------
// Conduction: r(Tj) and dynamic Ron (§D1, §D2)
// ---------------------------------------------------------------------------

/**
 * Static Rds(on) in ohms at junction temperature Tj (§D1).
 *
 * Piecewise power law in absolute temperature through the datasheet-normalized
 * points r(25) = 1, r(100), r(150): log r is interpolated linearly in log T_K
 * between anchors and extrapolated with the adjacent slope beyond them, so
 * both datasheet points are reproduced exactly and r(Tj) is monotone.
 * Cold-end clamp r ≥ 0.75 per §D1. Dynamic Ron (k_dyn) is NOT included here —
 * see dynamicRonFactor().
 */
export function rdsOnAtTj(device: SwitchDevice, tjC: number): number {
  const r25 = device.rdsOnMohm25 * 1e-3;
  const p = getDevicePhysics(device);
  const tK = [298, 373, 423];
  const lnR = [0, Math.log(p.rNorm100), Math.log(p.rNorm150)];
  const x = Math.log(Math.max(tjC + 273, 100));
  let y: number;
  if (x <= Math.log(tK[1])) {
    const s = (lnR[1] - lnR[0]) / (Math.log(tK[1]) - Math.log(tK[0]));
    y = lnR[0] + s * (x - Math.log(tK[0])); // also extrapolates below 25 °C
  } else {
    const s = (lnR[2] - lnR[1]) / (Math.log(tK[2]) - Math.log(tK[1]));
    y = lnR[1] + s * (x - Math.log(tK[1])); // also extrapolates above 150 °C
  }
  return r25 * Math.max(0.75, Math.exp(y));
}

/**
 * GaN dynamic-Rds(on) multiplier k_dyn (§D2), blended continuously between
 * the soft-switched and hard-switched JEP173 classes by the resolved ZVS
 * fraction. 1.0 for Si/SiC.
 */
export function dynamicRonFactor(device: SwitchDevice, zvsFraction: number): number {
  const p = getDevicePhysics(device);
  const f = clamp(zvsFraction, 0, 1);
  return p.kDynSoft + (p.kDynHard - p.kDynSoft) * (1 - f);
}

// ---------------------------------------------------------------------------
// Gate-charge-partition switching times (§D3)
// ---------------------------------------------------------------------------

export interface GateTimings {
  /** Current rise (turn-on), s. */
  tCrS: number;
  /** Voltage fall (turn-on Miller phase), s. */
  tVfS: number;
  /** Voltage rise (turn-off Miller phase), s. */
  tVrS: number;
  /** Current fall (turn-off), s. */
  tCfS: number;
  /** Miller plateau voltage used, V. */
  vPlV: number;
}

const T_MIN_S = 0.05e-9; // switching times never resolve below 50 ps

/**
 * Four-phase switching times from the gate-charge partition (§D3):
 *   t_cr = Qgs2·Rg_on/(Vdrv − (Vth+Vpl)/2)   t_vf = Qgd·Rg_on/(Vdrv − Vpl)
 *   t_vr = Qgd·Rg_off/(Vpl − Vlo)            t_cf = Qgs2·Rg_off/((Vth+Vpl)/2 − Vlo)
 * with Vpl = Vth + I/gfs and Rg = internal + external + driver share.
 * Integrated-driver parts (slewVPerNs set) use the programmed node slew for
 * the voltage phases and Q/Ig for the current phases; vOffV feeds the slew
 * model (defaults to half rated Vds when omitted).
 */
export function gateTimings(
  device: SwitchDevice,
  iLoadA: number,
  vOffV?: number,
): GateTimings {
  const p = getDevicePhysics(device);
  const vDrv = device.vgsDriveV;
  const vLo = Math.min(0, p.vgsOffV);
  const vTh = device.vthV;
  const vPl = clamp(
    p.vplV ?? vTh + Math.abs(iLoadA) / Math.max(p.gfsS, 0.1),
    vTh + 0.05,
    Math.max(vTh + 0.05, 0.95 * vDrv),
  );
  const qgs2C = p.qgs2Nc * 1e-9;
  const qgdC = p.qgdNc * 1e-9;

  if (p.slewVPerNs && p.slewVPerNs > 0) {
    const v = vOffV ?? 0.5 * device.vdsMaxV;
    const tV = Math.max(T_MIN_S, (v / p.slewVPerNs) * 1e-9);
    const ig = Math.max(p.igEffA ?? 1.5, 0.1);
    const tI = Math.max(T_MIN_S, qgs2C / ig);
    return { tCrS: tI, tVfS: tV, tVrS: tV, tCfS: tI, vPlV: vPl };
  }

  const rgOn = p.rgIntOhm + p.rgExtOnOhm;
  const rgOff = p.rgIntOhm + p.rgExtOffOhm;
  const tCrS = Math.max(T_MIN_S, (qgs2C * rgOn) / Math.max(vDrv - (vTh + vPl) / 2, 0.2));
  const tVfS = Math.max(T_MIN_S, (qgdC * rgOn) / Math.max(vDrv - vPl, 0.2));
  const tVrS = Math.max(T_MIN_S, (qgdC * rgOff) / Math.max(vPl - vLo, 0.2));
  const tCfS = Math.max(T_MIN_S, (qgs2C * rgOff) / Math.max((vTh + vPl) / 2 - vLo, 0.2));
  return { tCrS, tVfS, tVrS, tCfS, vPlV: vPl };
}

// ---------------------------------------------------------------------------
// Capacitive energies and the ZVS charge criterion (§D5, §D9)
// ---------------------------------------------------------------------------

/**
 * Half-bridge node charge to complete a swing of `dvV` starting from the
 * fully-commutated state, coulombs (§D9): incoming device charges 0→dv,
 * opposite discharges V→V−dv. Matched pair, n devices per position.
 */
function nodeSwingChargeC(
  p: DevicePhysics,
  n: number,
  vOffV: number,
  dvV: number,
  cParF: number,
): number {
  const dv = clamp(dvV, 0, vOffV);
  return (
    n *
      (qossCoulombs(p, dv) +
        (qossCoulombs(p, vOffV) - qossCoulombs(p, vOffV - dv))) +
    cParF * dv
  );
}

/** Full-swing node charge Q_node = 2n·Qoss(V) + Cpar·V, coulombs (§D9). */
export function qNodeCoulombs(
  device: SwitchDevice,
  vOffV: number,
  parallel = 1,
  cParF = 0,
): number {
  const p = getDevicePhysics(device);
  return nodeSwingChargeC(p, Math.max(1, Math.round(parallel)), vOffV, vOffV, cParF);
}

/**
 * Capacitive energy dissipated when a half-bridge node is hard-commutated
 * across `dvV` (§D5): E = Eoss_A(dv) + dv·Qoss_B(dv) − Eoss_B(dv) + Cpar·dv²
 * = dv·Qoss(dv) + Cpar·dv² for a matched pair. Per parallel pair; the caller
 * multiplies by n.
 */
function eCapPairJ(p: DevicePhysics, dvV: number): number {
  if (dvV <= 0) return 0;
  // Eoss_A + (dv·Qoss_B − Eoss_B) with A = B (matched): the Eoss terms cancel.
  return dvV * qossCoulombs(p, dvV);
}

/** Matched-pair hard-switch capacitive loss per cycle, joules (§D5, U4). */
export function eCapHardJ(
  device: SwitchDevice,
  vOffV: number,
  parallel = 1,
  cParF = 0,
): number {
  const p = getDevicePhysics(device);
  const n = Math.max(1, Math.round(parallel));
  return n * eCapPairJ(p, vOffV) + cParF * vOffV * vOffV;
}

export interface ZvsResult {
  /** Fraction of the node swing completed by the inductive slew, 0..1. */
  fraction: number;
  /** Node voltage reached before the incoming device turns on, V. */
  vReachedV: number;
  /** Full-swing node charge Q_node, C. */
  qNodeC: number;
  /** Charge margin Q_avail − Q_node, C (≥ 0 means full ZVS). */
  marginC: number;
  /** Residual hard-switched capacitive energy per cycle, J (§D9). */
  eResJ: number;
}

/**
 * Charge-criterion ZVS resolution (§D9, U5). The commutating current I0
 * delivers Q_avail = |I0|·t_dt into the node; if that is short of Q_node the
 * node-charge relation is inverted for V_reached and the remaining swing
 * ΔV_rem = V − V_reached is priced with the §D5 structure from the same
 * tables: E_res = E_cap(ΔV_rem). Continuous in I0 and t_dt: E_res → E_cap(V)
 * as Q_avail → 0 and E_res → 0 exactly at the full-ZVS boundary.
 */
export function zvsResolve(
  device: SwitchDevice,
  vOffV: number,
  i0A: number,
  tDeadS: number,
  parallel = 1,
  cParF = 0,
): ZvsResult {
  const p = getDevicePhysics(device);
  const n = Math.max(1, Math.round(parallel));
  const qNode = nodeSwingChargeC(p, n, vOffV, vOffV, cParF);
  const qAvail = Math.abs(i0A) * Math.max(tDeadS, 0);
  if (qNode <= 0 || vOffV <= 0) {
    return { fraction: 1, vReachedV: vOffV, qNodeC: 0, marginC: qAvail, eResJ: 0 };
  }
  if (qAvail >= qNode) {
    return {
      fraction: 1,
      vReachedV: vOffV,
      qNodeC: qNode,
      marginC: qAvail - qNode,
      eResJ: 0,
    };
  }
  // Invert the monotone node-charge relation by bisection for V_reached.
  let lo = 0;
  let hi = vOffV;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (nodeSwingChargeC(p, n, vOffV, mid, cParF) < qAvail) lo = mid;
    else hi = mid;
  }
  const vReached = 0.5 * (lo + hi);
  const dvRem = vOffV - vReached;
  const eRes = n * eCapPairJ(p, dvRem) + cParF * dvRem * dvRem;
  return {
    fraction: vReached / vOffV,
    vReachedV: vReached,
    qNodeC: qNode,
    marginC: qAvail - qNode,
    eResJ: eRes,
  };
}

// ---------------------------------------------------------------------------
// Reverse conduction (§D8)
// ---------------------------------------------------------------------------

/**
 * Reverse-conduction voltage drop during dead time at a given per-position
 * current and Tj (§D8):
 *   GaN: Vsd = Vth + |Vgs_off| + (I/n)·Rrev,  Rrev = rrevFactor·Rds(on)(Tj)
 *   SiC: body diode Vsd(25 °C) − 2 mV/°C (default 3.5 V, per-part override)
 *   Si:  ~0.9 V superjunction body diode
 */
export function vsdV(
  device: SwitchDevice,
  iA: number,
  tjC: number,
  parallel = 1,
): number {
  const p = getDevicePhysics(device);
  const n = Math.max(1, Math.round(parallel));
  switch (device.tech) {
    case "GaN":
      return (
        device.vthV +
        Math.abs(p.vgsOffV) +
        (Math.abs(iA) / n) * p.rrevFactor * rdsOnAtTj(device, tjC)
      );
    case "SiC":
      return Math.max(1.0, (p.vsdBody25V ?? 3.5) - 0.002 * (tjC - 25));
    default:
      return 0.9;
  }
}

// ---------------------------------------------------------------------------
// Legacy v1 helpers (kept exported for compatibility; superseded internally)
// ---------------------------------------------------------------------------

/**
 * v1 gate-loop drive-current estimate, A. Superseded by gateTimings() (§D3);
 * kept for callers of the legacy transition-time helper.
 */
export function gateDriveCurrentA(device: SwitchDevice): number {
  return device.tech === "GaN" ? 1.5 : 2.0;
}

/**
 * v1 transition-time estimate t ≈ (0.5·Qg)/Ig, seconds. Superseded by the
 * §D3 gate-charge partition in gateTimings(); kept exported for callers.
 */
export function switchTransitionTimeS(device: SwitchDevice): number {
  const qSwC = 0.5 * device.qgNc * 1e-9;
  return qSwC / gateDriveCurrentA(device);
}

/**
 * v1 fixed reverse-drop estimate, V (GaN 2.0 / SiC 1.5 / Si 0.9). Superseded
 * by vsdV() (§D8) which carries the |Vgs_off| adder and the I·Rrev term.
 */
export function reverseDropV(device: SwitchDevice): number {
  switch (device.tech) {
    case "GaN":
      return 2.0;
    case "SiC":
      return 1.5;
    default:
      return 0.9;
  }
}

/**
 * v1 Eoss scaling helper: eossUj·(V/Vref)^1.6, joules. Superseded by the
 * per-part Qoss/Eoss records (eossJoules / eCapHardJ, §D5); kept exported.
 */
export function eossAtVoltageJ(device: SwitchDevice, vOffV: number): number {
  const vRef = 0.5 * device.vdsMaxV;
  if (vRef <= 0) return 0;
  const scale = Math.pow(clamp(vOffV / vRef, 0, 2.5), 1.6);
  return device.eossUj * 1e-6 * scale;
}

/**
 * Sane continuous package dissipation, W. Top-cooled GaN SMD (PQFN/DFN,
 * GaNPX, LGA) ≈ 8 W with a decent thermal via farm / top-side heatsink;
 * through-hole power packages (TO-247/TO-220/D2PAK on sink) ≈ 25 W.
 */
export function packageDissipationLimitW(device: SwitchDevice): number {
  const pkg = device.pkg.toUpperCase();
  const isBigPkg =
    /TO-?2\d\d/.test(pkg) || /D2?PAK/.test(pkg) || /TO-?26\d/.test(pkg);
  return isBigPkg ? 25 : 8;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Optional v2 knobs; defaults preserve the 4-argument call signature. */
export interface DeviceLossOptions {
  /** Extra switch-node parasitic capacitance, F (layout), default 0. */
  cParF?: number;
  /** Per-edge dead time override, s (else derived from op.deadTimeFrac). */
  deadTimeS?: number;
}

/**
 * Full v2 loss model for one switch position (§D10 consolidated set, minus
 * the it2-excluded hysteresis/gate-swing items):
 *  - conduction: I²·R at power-law r(Tj) (§D1) × k_dyn blend (§D2)
 *  - switching:  Eon overlap (scaled by the un-slewed voltage remainder) +
 *                Qrr dump + Eoff, GaN Eoff capped by I²·t_cf²/(24·C_node) (§D7)
 *  - coss:       fsw·E_res — the §D5/§D9 capacitive residual. Fully hard
 *                (zvsFraction 0) this is n·V·Qoss(V); at full ZVS it is 0;
 *                partial ZVS prices E_cap(ΔV_rem) from the same tables
 *  - gate:       Qg·Vdrive·fsw per device (paid even under ZVS)
 *  - dead time:  Vsd(I, Tj)·I·(t_dt − Q_node/|I|)⁺ per edge (§D8)
 *
 * ZVS mapping: `op.zvs === false` → hard (fraction 0). `op.zvs === true` →
 * the topology asserts an inductive transition; the charge criterion (§D9)
 * resolves the continuous fraction from the per-edge current already carried
 * by the op (iOnA, falling back to iOffA) and the per-edge dead time from
 * deadTimeFrac. When the op carries no usable current/dead-time data the
 * boolean is trusted (fraction 1), preserving topology-level intent.
 */
export function deviceLoss(
  device: SwitchDevice,
  op: SwitchOperatingPoint,
  parallel: number,
  tjC: number,
  options?: DeviceLossOptions,
): DeviceLoss {
  const n = Math.max(1, Math.round(parallel));
  const fsw = op.fswHz;
  const v = op.vOffV;
  const cPar = options?.cParF ?? 0;
  const p = getDevicePhysics(device);

  // Per-edge dead time: deadTimeFrac counts BOTH edges of the period.
  const tDt =
    options?.deadTimeS ??
    (fsw > 0 ? clamp(op.deadTimeFrac, 0, 0.5) / (2 * fsw) : 0);

  // --- ZVS resolution (§D9) ----------------------------------------------
  const iSlewA = Math.abs(op.iOnA) > 0 ? Math.abs(op.iOnA) : Math.abs(op.iOffA);
  let zvs: ZvsResult;
  if (!op.zvs) {
    zvs = {
      fraction: 0,
      vReachedV: 0,
      qNodeC: qNodeCoulombs(device, v, n, cPar),
      marginC: 0,
      eResJ: eCapHardJ(device, v, n, cPar),
    };
  } else if (iSlewA <= 0 || tDt <= 0) {
    // Topology asserts ZVS but the op carries no commutation data — trust it.
    zvs = {
      fraction: 1,
      vReachedV: v,
      qNodeC: qNodeCoulombs(device, v, n, cPar),
      marginC: 0,
      eResJ: 0,
    };
  } else {
    zvs = zvsResolve(device, v, iSlewA, tDt, n, cPar);
  }
  const dvRemV = v * (1 - zvs.fraction) > 0 ? v - zvs.vReachedV : 0;

  // --- conduction (§D1, §D2): parallel splits current, P ∝ 1/n ------------
  const rOn = rdsOnAtTj(device, tjC) * dynamicRonFactor(device, zvs.fraction);
  const conductionW = (op.iRmsA * op.iRmsA * rOn) / n;

  // --- switching (§D3, §D4, §D7) ------------------------------------------
  const iOn = Math.abs(op.iOnA);
  const iOff = Math.abs(op.iOffA);
  const tOn = gateTimings(device, iOn, v);
  const tOff = gateTimings(device, iOff, v);

  // Turn-off: overlap capped for GaN by the Coss-limited residual (§D7).
  const eOffOverlapJ = 0.5 * v * iOff * (tOff.tVrS + tOff.tCfS);
  let eOffJ = eOffOverlapJ;
  if (device.tech === "GaN" && v > 0) {
    const cNodeF = zvs.qNodeC / v; // charge-equivalent node capacitance
    if (cNodeF > 0) {
      eOffJ = Math.min(
        eOffOverlapJ,
        (iOff * iOff * tOff.tCfS * tOff.tCfS) / (24 * cNodeF),
      );
    }
  }

  // Turn-on: V–I overlap only across the un-slewed remainder of the swing
  // (§D9: small overlap term once ΔV_rem exceeds ~20 % of the bus), plus the
  // complementary devices' reverse recovery, scaled by the hard remainder.
  const hardRem = v > 0 ? dvRemV / v : 0;
  let eOnJ = 0;
  if (dvRemV > 0.2 * v) {
    eOnJ += 0.5 * dvRemV * iOn * (tOn.tCrS + tOn.tVfS);
  }
  eOnJ += n * device.qrrNc * 1e-9 * v * hardRem;
  const switchingW = (eOnJ + eOffJ) * fsw;

  // --- capacitive residual (§D5, §D9) -------------------------------------
  const cossW = zvs.eResJ * fsw;

  // --- gate drive ----------------------------------------------------------
  const gateW = n * device.qgNc * 1e-9 * device.vgsDriveV * fsw;

  // --- dead-time reverse conduction (§D8) ----------------------------------
  // Per edge: Vsd·|I_edge|·(t_dt − Q_node/|I_edge|)⁺ — only the dead time
  // left after the inductive slew is priced; zero when the slew consumes it.
  let deadTimeW = 0;
  if (tDt > 0) {
    for (const iEdge of [iOn, iOff]) {
      if (iEdge <= 0) continue;
      const tRev = Math.max(0, tDt - zvs.qNodeC / iEdge);
      deadTimeW += fsw * vsdV(device, iEdge, tjC, n) * iEdge * tRev;
    }
  }

  const perPositionW = conductionW + switchingW + cossW + gateW + deadTimeW;

  return {
    role: op.role,
    device,
    positions: op.positions,
    parallelPerPosition: n,
    conductionW,
    switchingW,
    cossW,
    gateW,
    deadTimeW,
    totalW: perPositionW * op.positions,
    tjC,
  };
}

/**
 * Smallest parallel count n ∈ 1..4 such that at Tj = 100 °C:
 *  - conduction loss per device ≤ 60% of a sane package dissipation limit
 *  - RMS current per device ≤ 70% of the 25 °C continuous rating
 * Returns 4 (clamped) if even 4 in parallel cannot satisfy the limits — the
 * optimizer treats that device as marginal and lets thermal iterate reject it.
 * (Static r(100) only; k_dyn is a loss-model refinement, not a sizing gate.)
 */
export function pickParallelCount(
  device: SwitchDevice,
  op: SwitchOperatingPoint,
): number {
  const rOn100 = rdsOnAtTj(device, 100);
  const pMaxW = 0.6 * packageDissipationLimitW(device);
  const iMaxA = 0.7 * device.idMaxA;
  for (let n = 1; n <= 4; n++) {
    const iPer = op.iRmsA / n;
    const pCondPerDevice = iPer * iPer * rOn100;
    if (pCondPerDevice <= pMaxW && iPer <= iMaxA) return n;
  }
  return 4;
}
