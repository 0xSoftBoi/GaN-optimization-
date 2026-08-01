import { describe, expect, it } from "vitest";
import { SWITCH_DEVICES, getSwitch } from "./devices";
import {
  DEVICE_PHYSICS,
  getDevicePhysics,
  qossCoulombs,
  eossJoules,
} from "./devicePhysics";

describe("DEVICE_PHYSICS registry", () => {
  it("carries the three it2 anchor parts with provenance", () => {
    for (const id of ["EPC2218", "LMG3522R030", "C3M0075120K"]) {
      const rec = DEVICE_PHYSICS[id];
      expect(rec).toBeDefined();
      expect(rec!.provenance).toMatch(/datasheet/i);
      expect(getSwitch(id)).toBeDefined(); // anchors key real DB parts
    }
  });

  it("anchor entries merge over family defaults without losing fields", () => {
    const p = getDevicePhysics(getSwitch("EPC2218")!);
    // anchor-specified values win…
    expect(p.rNorm150).toBe(2.05);
    expect(p.qgdNc).toBe(2.3);
    // …and every required field resolves (nothing regresses to undefined)
    expect(p.gfsS).toBeGreaterThan(0);
    expect(p.rgIntOhm).toBeGreaterThan(0);
    expect(p.rrevFactor).toBeGreaterThan(0);
    expect(p.kDynHard).toBeGreaterThanOrEqual(p.kDynSoft);
  });

  it("every DB part resolves to a complete physics record", () => {
    for (const d of SWITCH_DEVICES) {
      const p = getDevicePhysics(d);
      expect(p.rNorm100).toBeGreaterThan(1);
      expect(p.rNorm150).toBeGreaterThan(p.rNorm100);
      expect(p.qgs2Nc).toBeGreaterThan(0);
      expect(p.qgdNc).toBeGreaterThan(0);
      expect(p.cossFit ?? p.cossTable).toBeTruthy();
      expect(p.provenance.length).toBeGreaterThan(0);
    }
  });

  it("memoizes per device object", () => {
    const d = getSwitch("EPC2218")!;
    expect(getDevicePhysics(d)).toBe(getDevicePhysics(d));
  });
});

describe("Qoss/Eoss evaluators", () => {
  it("C3M table interpolates its grid points exactly and extends beyond them", () => {
    const p = getDevicePhysics(getSwitch("C3M0075120K")!);
    // grid points (37.5 V spacing): exact
    expect(qossCoulombs(p, 600)).toBeCloseTo(76.462e-9, 15);
    expect(eossJoules(p, 600)).toBeCloseTo(15e-6, 12);
    // between grid points: bracketed by neighbors
    const q = qossCoulombs(p, 610);
    expect(q).toBeGreaterThan(76.462e-9);
    expect(q).toBeLessThan(78.882e-9);
    // beyond the table: constant-C tail keeps growing, no silent clamp
    expect(qossCoulombs(p, 1300)).toBeGreaterThan(qossCoulombs(p, 1200));
    expect(eossJoules(p, 1300)).toBeGreaterThan(eossJoules(p, 1200));
  });

  it("power-law fit hits the calibration point of each non-anchor part", () => {
    const d = getSwitch("GS66508T")!; // family-default GaN part
    const p = getDevicePhysics(d);
    const vRef = 0.5 * d.vdsMaxV;
    // ρ = 325·49n/5.5µ = 2.895 > 2 → power-law branch reproduces BOTH the
    // frozen Qoss and Eoss at Vref (γ from the ratio, C0 from the charge).
    expect(qossCoulombs(p, vRef)).toBeCloseTo(d.qossNc * 1e-9, 15);
    expect(eossJoules(p, vRef)).toBeCloseTo(d.eossUj * 1e-6, 12);
  });
});
