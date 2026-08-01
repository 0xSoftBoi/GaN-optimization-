import { describe, it, expect } from "vitest";
import type { SwitchDevice, SwitchOperatingPoint } from "@/lib/types";
import {
  deviceLoss,
  pickParallelCount,
  rdsOnAtTj,
  eossAtVoltageJ,
  reverseDropV,
  zvsResolve,
  qNodeCoulombs,
} from "./device";

// --- inline fixtures (no data-module import per module rules) --------------

const gan650: SwitchDevice = {
  id: "TEST-GAN-650",
  mfr: "TestCo",
  tech: "GaN",
  vdsMaxV: 650,
  idMaxA: 30,
  rdsOnMohm25: 50,
  rdsOnTempco: 0.01,
  qgNc: 6.1,
  qossNc: 57,
  eossUj: 7, // at 325 V
  qrrNc: 0,
  vgsDriveV: 6,
  vthV: 1.7,
  rthJCcPerW: 0.5,
  pkg: "GaNPX",
  priceUsd1k: 6.5,
  suppliers: ["digikey"],
};

const sic1200: SwitchDevice = {
  id: "TEST-SIC-1200",
  mfr: "TestCo",
  tech: "SiC",
  vdsMaxV: 1200,
  idMaxA: 30,
  rdsOnMohm25: 75,
  rdsOnTempco: 0.005,
  qgNc: 51,
  qossNc: 220,
  eossUj: 26,
  qrrNc: 150,
  vgsDriveV: 15,
  vthV: 2.7,
  rthJCcPerW: 1.1,
  pkg: "TO-247-4",
  priceUsd1k: 5.8,
  suppliers: ["mouser"],
};

const opHard: SwitchOperatingPoint = {
  role: "primary-hs",
  positions: 1,
  vOffV: 400,
  iRmsA: 10,
  iAvgA: 8,
  iOnA: 8,
  iOffA: 12,
  fswHz: 100e3,
  dutyEff: 0.5,
  zvs: false,
  deadTimeFrac: 0.01,
};

const opZvs: SwitchOperatingPoint = { ...opHard, zvs: true };

// --- shared v2 hand-model for the gan650 fixture (docs/PHYSICS.md) ---------
// Family-default Coss power-law fit (§D5): calibrated on the contract point
// Qoss = 57 nC / Eoss = 7 µJ at Vref = 325 V:
//   ρ = V·Qoss/Eoss = 325·57e-9/7e-6 = 2.6464 → γ = (ρ−2)/(ρ−1) = 0.39263
//   Qoss(V) = 57 nC·(V/325)^(1−γ)
const RHO_GAN = (325 * 57e-9) / 7e-6;
const GAMMA_GAN = (RHO_GAN - 2) / (RHO_GAN - 1);
const qossGanC = (v: number) => 57e-9 * Math.pow(v / 325, 1 - GAMMA_GAN);
// Family-default r(Tj) anchors synthesized from the DB linear tempco (§D1):
// r(100) = 1 + 0.01·75 = 1.75, r(150) = 1 + 0.01·125 = 2.25 — exact at the
// anchor temperatures; power-law (log-log) interpolation between them.
// GaN 650 V-class dynamic-Ron defaults (§D2): k_dyn = 1.15 hard, 1.05 soft.
const KDYN_HARD = 1.15;
const KDYN_SOFT = 1.05;

// --- deviceLoss ------------------------------------------------------------

describe("deviceLoss", () => {
  it("ZVS zeroes Coss loss and removes the turn-on portion of switching", () => {
    const hard = deviceLoss(gan650, opHard, 1, 100);
    const soft = deviceLoss(gan650, opZvs, 1, 100);
    // Charge criterion (§D9): Q_avail = |iOn|·t_dt = 8 A·50 ns = 400 nC well
    // above Q_node = 2·Qoss(400) ≈ 129 nC → full ZVS, capacitive loss 0.
    expect(soft.cossW).toBe(0);
    expect(hard.cossW).toBeGreaterThan(0);
    expect(soft.switchingW).toBeGreaterThan(0); // Coss-limited turn-off remains
    expect(soft.switchingW).toBeLessThan(hard.switchingW);
    // EXPECTATION SHIFT (it2, §D2): conduction is no longer identical under
    // ZVS — GaN dynamic Rds(on) relaxes from the hard-switched JEP173 class
    // (k_dyn 1.15) to the soft class (1.05). Gate and dead-time stay equal.
    expect(soft.conductionW).toBeLessThan(hard.conductionW);
    expect(soft.conductionW / hard.conductionW).toBeCloseTo(KDYN_SOFT / KDYN_HARD, 9);
    expect(soft.gateW).toBeCloseTo(hard.gateW, 12);
    expect(soft.deadTimeW).toBeCloseTo(hard.deadTimeW, 12);
    expect(soft.totalW).toBeLessThan(hard.totalW);
  });

  it("total loss rises monotonically with fsw when hard-switched", () => {
    let prev = -Infinity;
    for (const f of [50e3, 100e3, 250e3, 500e3, 1e6]) {
      const p = deviceLoss(gan650, { ...opHard, fswHz: f }, 1, 100).totalW;
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it("tempco raises conduction loss with Tj by the datasheet ratio", () => {
    // EXPECTATION SHIFT (it2, §D1): the linear fit R25·(1 + k·ΔT) became a
    // power law through the r(100)/r(150) anchors. At the anchor temperature
    // 150 °C the family default reproduces the DB tempco exactly:
    // r(150) = 1 + 0.01·125 = 2.25 (v1's 125 °C midpoint check moved here
    // because between anchors the power law reshapes the curve).
    const cold = deviceLoss(gan650, opHard, 1, 25);
    const hot = deviceLoss(gan650, opHard, 1, 150);
    expect(hot.conductionW / cold.conductionW).toBeCloseTo(2.25, 6);
    // I²·R25·r(150)·k_dyn,hard hand calc (§D1/§D2): 100·0.05·2.25·1.15
    expect(hot.conductionW).toBeCloseTo(10 * 10 * 0.05 * 2.25 * KDYN_HARD, 6);
    // monotone in Tj across the whole range (§D1 acceptance)
    let prev = -Infinity;
    for (const tj of [25, 50, 75, 100, 125, 150, 175]) {
      const w = deviceLoss(gan650, opHard, 1, tj).conductionW;
      expect(w).toBeGreaterThan(prev);
      prev = w;
    }
  });

  it("two in parallel halves conduction loss, doubles gate loss, keeps switching", () => {
    const one = deviceLoss(gan650, opHard, 1, 100);
    const two = deviceLoss(gan650, opHard, 2, 100);
    expect(two.conductionW / one.conductionW).toBeCloseTo(0.5, 9);
    expect(two.gateW / one.gateW).toBeCloseTo(2.0, 9);
    // EXPECTATION SHIFT (it2, §D7): overlap switching is n-invariant to first
    // order, but the GaN Coss-limited Eoff residual I²·t_cf²/(24·C_node)
    // shrinks as C_node doubles with n — switching loss falls slightly.
    expect(two.switchingW).toBeLessThanOrEqual(one.switchingW);
    expect(two.switchingW / one.switchingW).toBeGreaterThan(0.99);
  });

  it("gate loss matches Qg·Vgs·fsw exactly", () => {
    const d = deviceLoss(gan650, opHard, 1, 100);
    expect(d.gateW).toBeCloseTo(6.1e-9 * 6 * 100e3, 12); // 3.66 mW
  });

  it("Coss loss equals V·Qoss(V)·fsw when hard-switching at half rated Vds", () => {
    // EXPECTATION SHIFT (it2, §D5): hard-switch capacitive cost for a matched
    // half-bridge pair is E_cap = Eoss_A + V·Qoss_B − Eoss_B = V·Qoss(V) —
    // not v1's n·Eoss. At the contract point Qoss(325 V) = 57 nC exactly, so
    // hand calc: 325 V·57 nC·100 kHz = 1.8525 W (ρ = 2.646× the old 0.7 W).
    const op = { ...opHard, vOffV: 325 };
    const d = deviceLoss(gan650, op, 1, 100);
    expect(d.cossW).toBeCloseTo(325 * 57e-9 * 100e3, 9);
    expect(d.cossW / (7e-6 * 100e3)).toBeCloseTo(RHO_GAN, 6);
  });

  it("Qrr adds hard-switching loss for SiC but not GaN", () => {
    const sicNoQrr: SwitchDevice = { ...sic1200, qrrNc: 0 };
    const withQrr = deviceLoss(sic1200, opHard, 1, 100).switchingW;
    const without = deviceLoss(sicNoQrr, opHard, 1, 100).switchingW;
    expect(withQrr - without).toBeCloseTo(150e-9 * 400 * 100e3, 6); // 6 W
  });

  it("GaN pays more dead-time loss than Si body diode at the same point", () => {
    const si: SwitchDevice = { ...sic1200, tech: "Si", qrrNc: 4000 };
    const ganD = deviceLoss(gan650, opHard, 1, 100).deadTimeW;
    const siD = deviceLoss(si, opHard, 1, 100).deadTimeW;
    // Legacy v1 constants are still exported unchanged…
    expect(reverseDropV(gan650)).toBeCloseTo(2.0, 9);
    expect(reverseDropV(si)).toBeCloseTo(0.9, 9);
    // …but the engine now uses §D8 (EXPECTATION SHIFT, it2):
    //   GaN: Vsd = Vth + |Vgs_off| + I·Rrev(Tj), Rrev = 2·Rds(on)
    //   per edge: Pdt = fsw·Vsd(I)·I·max(0, t_dt − Q_node/I)
    // Hand model: t_dt = deadTimeFrac/(2·fsw) = 0.01/(2·100 kHz) = 50 ns,
    // Q_node = 2·Qoss(400 V) from the §D5 fit, Rds(100 °C) = 50 mΩ·1.75.
    const tDt = 0.01 / (2 * 100e3);
    const qNode = 2 * qossGanC(400);
    const vsdGan = (i: number) => 1.7 + 0 + i * 2.0 * (0.05 * 1.75);
    const hand =
      100e3 *
      (vsdGan(8) * 8 * Math.max(0, tDt - qNode / 8) +
        vsdGan(12) * 12 * Math.max(0, tDt - qNode / 12));
    expect(ganD).toBeCloseTo(hand, 6);
    // GaN's Vth + channel drop far exceeds the Si SJ body diode's ~0.9 V, and
    // Si's much larger Qoss eats more of the dead time as slew credit.
    expect(ganD).toBeGreaterThan(siD);
    expect(siD).toBeGreaterThan(0);
  });

  it("dead-time loss is linear in t_dt and zero once the ZVS slew consumes it (§D8)", () => {
    // Q_node/I slews: 16.2 ns at 8 A, 10.8 ns at 12 A → an 8 ns per-edge dead
    // time is fully consumed by the slew on both edges.
    const short = { ...opHard, deadTimeFrac: 2 * 8e-9 * opHard.fswHz };
    expect(deviceLoss(gan650, short, 1, 100).deadTimeW).toBe(0);
    // Above the slew threshold Pdt grows linearly in t_dt: equal increments
    // of deadTimeFrac add equal watts.
    const at = (frac: number) =>
      deviceLoss(gan650, { ...opHard, deadTimeFrac: frac }, 1, 100).deadTimeW;
    const d1 = at(0.02) - at(0.015);
    const d2 = at(0.015) - at(0.01);
    expect(d1).toBeGreaterThan(0);
    expect(d1 / d2).toBeCloseTo(1, 9);
  });

  it("zvsFraction is continuous across the full-ZVS boundary (§D9)", () => {
    // Sweep the commutating current through the charge-criterion threshold
    // I* = Q_node/t_dt and require fraction/E_res continuity, monotonicity,
    // and an exact zero residual at/above the boundary.
    const v = 400;
    const tDt = 50e-9;
    const qNode = qNodeCoulombs(gan650, v, 1);
    expect(qNode).toBeCloseTo(2 * qossGanC(v), 15);
    const iStar = qNode / tDt;
    let prevFrac = 0;
    let prevERes = Infinity;
    const steps = 80;
    for (let k = 0; k <= steps; k++) {
      const i0 = (1.5 * iStar * k) / steps + 1e-6;
      const z = zvsResolve(gan650, v, i0, tDt, 1);
      expect(z.fraction).toBeGreaterThanOrEqual(prevFrac - 1e-9);
      expect(z.eResJ).toBeLessThanOrEqual(prevERes + 1e-15);
      if (i0 >= iStar) {
        expect(z.fraction).toBe(1);
        expect(z.eResJ).toBe(0);
      }
      prevFrac = z.fraction;
      prevERes = z.eResJ;
    }
    // No jump at the boundary: E_res just below I* is already tiny compared
    // with the fully hard-switched cost E_cap(V) = V·Qoss(V).
    const justBelow = zvsResolve(gan650, v, 0.999 * iStar, tDt, 1);
    const hardCost = v * qossGanC(v);
    expect(justBelow.eResJ).toBeLessThan(0.01 * hardCost);
    // And E_res → E_cap(V) as the available charge → 0 (§D9).
    const none = zvsResolve(gan650, v, 1e-9, tDt, 1);
    expect(none.eResJ).toBeCloseTo(hardCost, 7);
  });

  it("total loss rises monotonically with Tj (hard-switched GaN)", () => {
    let prev = -Infinity;
    for (const tj of [25, 50, 75, 100, 125, 150, 175]) {
      const w = deviceLoss(gan650, opHard, 1, tj).totalW;
      expect(w).toBeGreaterThan(prev);
      prev = w;
    }
  });

  it("totalW scales with positions and sums the mechanisms", () => {
    const one = deviceLoss(gan650, opHard, 2, 100);
    const four = deviceLoss(gan650, { ...opHard, positions: 4 }, 2, 100);
    const perPos =
      one.conductionW + one.switchingW + one.cossW + one.gateW + one.deadTimeW;
    expect(one.totalW).toBeCloseTo(perPos, 9);
    expect(four.totalW).toBeCloseTo(4 * perPos, 9);
    expect(four.tjC).toBe(100);
    expect(four.parallelPerPosition).toBe(2);
  });

  it("losses land in a plausible band for a 400 V / 10 Arms GaN half-bridge leg", () => {
    const d = deviceLoss(gan650, opHard, 1, 100);
    // conduction 10²·87.5 mΩ = 8.75 W; switching/coss sub-W at 100 kHz
    expect(d.conductionW).toBeGreaterThan(5);
    expect(d.conductionW).toBeLessThan(15);
    expect(d.switchingW).toBeGreaterThan(0.05);
    expect(d.switchingW).toBeLessThan(5);
    expect(d.totalW).toBeGreaterThan(d.conductionW);
    expect(d.totalW).toBeLessThan(25);
  });
});

// --- rdsOnAtTj / eossAtVoltageJ -------------------------------------------

describe("device physics helpers", () => {
  it("rdsOnAtTj follows the linear tempco fit", () => {
    expect(rdsOnAtTj(gan650, 25)).toBeCloseTo(0.05, 9);
    expect(rdsOnAtTj(gan650, 100)).toBeCloseTo(0.05 * 1.75, 9);
    expect(rdsOnAtTj(sic1200, 150)).toBeCloseTo(0.075 * (1 + 0.005 * 125), 9);
  });

  it("Eoss grows superlinearly with off-voltage and hits the datasheet point", () => {
    expect(eossAtVoltageJ(gan650, 325)).toBeCloseTo(7e-6, 12);
    const low = eossAtVoltageJ(gan650, 200);
    const high = eossAtVoltageJ(gan650, 400);
    expect(low).toBeLessThan(7e-6);
    expect(high).toBeGreaterThan(7e-6);
    expect(high / low).toBeGreaterThan(400 / 200); // steeper than linear
  });
});

// --- pickParallelCount -----------------------------------------------------

describe("pickParallelCount", () => {
  it("returns 1 when a single device is comfortably inside limits", () => {
    expect(pickParallelCount(gan650, { ...opHard, iRmsA: 5 })).toBe(1);
  });

  it("parallels up when conduction at Tj=100 °C exceeds ~60% of package limit", () => {
    // 10 Arms · 87.5 mΩ = 8.75 W > 0.6·8 W for one GaNPX die → needs 2
    expect(pickParallelCount(gan650, opHard)).toBe(2);
  });

  it("respects the 70% Id headroom rule even for very low Rds(on)", () => {
    const lowR: SwitchDevice = { ...gan650, rdsOnMohm25: 5, idMaxA: 10 };
    // conduction fine at n=1, but 10 Arms > 0.7·10 A → 2
    expect(pickParallelCount(lowR, opHard)).toBe(2);
  });

  it("TO-247 handles far more current per device than a GaN SMD", () => {
    const op40 = { ...opHard, iRmsA: 18 };
    const nSic = pickParallelCount(sic1200, op40); // 18²·103 mΩ = 33.4 W > 15 W → 2
    const nGan = pickParallelCount(gan650, op40); // 18²·87.5 mΩ = 28.4 W vs 4.8 W cap → 3
    expect(nSic).toBeLessThanOrEqual(nGan);
    expect(nSic).toBe(2);
  });

  it("is monotonic non-decreasing in iRms and clamps at 4", () => {
    let prev = 0;
    for (const i of [2, 5, 10, 15, 20, 30, 60, 120]) {
      const n = pickParallelCount(gan650, { ...opHard, iRmsA: i });
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(4);
      prev = n;
    }
    expect(pickParallelCount(gan650, { ...opHard, iRmsA: 120 })).toBe(4);
  });
});
