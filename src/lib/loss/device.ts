/**
 * VoltForge loss engine — semiconductor losses.
 *
 * Prices one switch position (SwitchOperatingPoint) with a given device and
 * parallel count at a given junction temperature.
 *
 * Convention: the per-mechanism fields of DeviceLoss (conductionW, switchingW,
 * cossW, gateW, deadTimeW) are totals for ONE switch position, i.e. summed
 * across the `parallel` devices sharing that position. `totalW` multiplies by
 * `op.positions` to cover every identical position in the topology.
 */

import type { SwitchDevice, SwitchOperatingPoint, DeviceLoss } from "@/lib/types";
import { clamp } from "@/lib/util";

// ---------------------------------------------------------------------------
// Internal device physics helpers (exported for tests / sibling reuse)
// ---------------------------------------------------------------------------

/** Rds(on) in ohms at junction temperature Tj: R25·(1 + k·(Tj − 25)). */
export function rdsOnAtTj(device: SwitchDevice, tjC: number): number {
  const r25 = device.rdsOnMohm25 * 1e-3;
  // Tempco model is a linear fit; never let R go below 60% of R25 for silly
  // cold inputs — datasheets bottom out around there at −40 °C.
  return r25 * Math.max(0.6, 1 + device.rdsOnTempco * (tjC - 25));
}

/**
 * Typical gate-loop drive current used to slew the switch node, A.
 * GaN gate loops are low-inductance with small Qg — drivers deliver ~1.5 A
 * effective; Si/SiC bricks (TO-247 etc.) run harder drives on much larger Qg.
 */
export function gateDriveCurrentA(device: SwitchDevice): number {
  return device.tech === "GaN" ? 1.5 : 2.0;
}

/**
 * Voltage rise/fall time estimate, seconds. The switching-relevant charge is
 * roughly the Miller plateau portion — ~half of total Qg is a standard
 * first-order estimate: t ≈ (0.5·Qg)/Ig.
 */
export function switchTransitionTimeS(device: SwitchDevice): number {
  const qSwC = 0.5 * device.qgNc * 1e-9;
  return qSwC / gateDriveCurrentA(device);
}

/**
 * Reverse-conduction (third-quadrant) voltage drop during dead time, V.
 * GaN has no body diode: Vsd ≈ Vth + channel drop ≈ 2 V (worse with negative
 * gate off-bias). SiC body diode Vf is high (~1.5 V used here as an effective
 * value once SR takes over quickly); Si superjunction body diode ≈ 0.9 V.
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
 * Eoss actually dissipated per hard turn-on at the operating off-voltage, J.
 * eossUj is specified at half rated Vds; Coss is strongly nonlinear so stored
 * energy scales ≈ V^1.6 rather than V² (empirical GaN/superjunction fit).
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

/**
 * Full loss model for one switch position.
 *
 * Mechanisms:
 *  - conduction: I²·R with Rds(on) tempco, current split across parallel dice
 *  - switching:  hard-switch overlap E = 0.5·V·I·t per edge (turn-on edge and
 *                Qrr dump skipped under ZVS)
 *  - coss:       Eoss·fsw per device when hard-switched, 0 under ZVS
 *  - gate:       Qg·Vdrive·fsw per device (paid even under ZVS)
 *  - dead time:  third-quadrant Vsd·I·deadTimeFrac (GaN pays ~2 V here)
 */
export function deviceLoss(
  device: SwitchDevice,
  op: SwitchOperatingPoint,
  parallel: number,
  tjC: number
): DeviceLoss {
  const n = Math.max(1, Math.round(parallel));
  const fsw = op.fswHz;

  // --- conduction: parallel splits current, so P ∝ 1/n --------------------
  const rOn = rdsOnAtTj(device, tjC);
  const iRmsPerDevice = op.iRmsA / n;
  const conductionW = n * iRmsPerDevice * iRmsPerDevice * rOn; // = iRms²·R/n

  // --- switching: V–I overlap at the edges --------------------------------
  const t = switchTransitionTimeS(device); // tr ≈ tf
  // Per position: each parallel device commutates i/n, energies sum back to
  // the full position current (first-order: t independent of n).
  const eOffJ = 0.5 * op.vOffV * Math.abs(op.iOffA) * t;
  let eOnJ = 0;
  if (!op.zvs) {
    eOnJ = 0.5 * op.vOffV * Math.abs(op.iOnA) * t;
    // Reverse recovery of the complementary device dumped at turn-on
    // (qrrNc = 0 for GaN, so this only bites Si/SiC hard-switched legs).
    eOnJ += device.qrrNc * 1e-9 * op.vOffV;
  }
  const switchingW = (eOnJ + eOffJ) * fsw;

  // --- Coss: each device dumps its own Eoss at hard turn-on ---------------
  const cossW = op.zvs ? 0 : n * eossAtVoltageJ(device, op.vOffV) * fsw;

  // --- gate drive ---------------------------------------------------------
  const gateW = n * device.qgNc * 1e-9 * device.vgsDriveV * fsw;

  // --- dead-time reverse conduction ---------------------------------------
  // The full commutated current freewheels through the position at ~Vsd
  // (constant-voltage-ish drop, so the split across parallel dice is moot).
  const iDeadA = 0.5 * (Math.abs(op.iOnA) + Math.abs(op.iOffA));
  const deadTimeW = reverseDropV(device) * iDeadA * clamp(op.deadTimeFrac, 0, 0.5);

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
 */
export function pickParallelCount(
  device: SwitchDevice,
  op: SwitchOperatingPoint
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
