import { describe, it, expect } from "vitest";
import type { SwitchDevice, SwitchOperatingPoint } from "@/lib/types";
import {
  deviceLoss,
  pickParallelCount,
  rdsOnAtTj,
  eossAtVoltageJ,
  reverseDropV,
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

// --- deviceLoss ------------------------------------------------------------

describe("deviceLoss", () => {
  it("ZVS zeroes Coss loss and removes the turn-on portion of switching", () => {
    const hard = deviceLoss(gan650, opHard, 1, 100);
    const soft = deviceLoss(gan650, opZvs, 1, 100);
    expect(soft.cossW).toBe(0);
    expect(hard.cossW).toBeGreaterThan(0);
    expect(soft.switchingW).toBeGreaterThan(0); // turn-off overlap remains
    expect(soft.switchingW).toBeLessThan(hard.switchingW);
    // conduction / gate / dead-time untouched by ZVS
    expect(soft.conductionW).toBeCloseTo(hard.conductionW, 12);
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
    const cold = deviceLoss(gan650, opHard, 1, 25);
    const hot = deviceLoss(gan650, opHard, 1, 125);
    // R(125)/R(25) = 1 + 0.01·100 = 2.0
    expect(hot.conductionW / cold.conductionW).toBeCloseTo(2.0, 6);
    expect(hot.conductionW).toBeCloseTo(10 * 10 * 0.05 * 2.0, 6); // I²R hand calc
  });

  it("two in parallel halves conduction loss, doubles gate loss, keeps switching", () => {
    const one = deviceLoss(gan650, opHard, 1, 100);
    const two = deviceLoss(gan650, opHard, 2, 100);
    expect(two.conductionW / one.conductionW).toBeCloseTo(0.5, 9);
    expect(two.gateW / one.gateW).toBeCloseTo(2.0, 9);
    expect(two.switchingW).toBeCloseTo(one.switchingW, 9);
  });

  it("gate loss matches Qg·Vgs·fsw exactly", () => {
    const d = deviceLoss(gan650, opHard, 1, 100);
    expect(d.gateW).toBeCloseTo(6.1e-9 * 6 * 100e3, 12); // 3.66 mW
  });

  it("Coss loss equals Eoss·fsw when switching at half rated Vds", () => {
    const op = { ...opHard, vOffV: 325 }; // = vdsMax/2, Eoss reference point
    const d = deviceLoss(gan650, op, 1, 100);
    expect(d.cossW).toBeCloseTo(7e-6 * 100e3, 9); // 0.7 W
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
    expect(reverseDropV(gan650)).toBeCloseTo(2.0, 9);
    expect(reverseDropV(si)).toBeCloseTo(0.9, 9);
    expect(ganD / siD).toBeCloseTo(2.0 / 0.9, 6);
    // hand check: Vsd·Iavg-of-edges·frac = 2·10·0.01 = 0.2 W
    expect(ganD).toBeCloseTo(2.0 * 10 * 0.01, 9);
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
