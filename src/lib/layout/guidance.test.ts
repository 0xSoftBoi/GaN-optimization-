import { describe, expect, it } from "vitest";
import type { DesignSpec } from "@/lib/types";
import { clearanceMm, creepageMm, gateLoopLimitMm2, layoutGuidance, powerLoopLimitMm2 } from "./guidance";

const spec = (over: Partial<DesignSpec> = {}): DesignSpec => ({
  name: "test",
  conversion: "dc-dc",
  vinMinV: 40,
  vinNomV: 48,
  vinMaxV: 60,
  voutV: 12,
  poutW: 300,
  bidirectional: false,
  isolated: false,
  ambientC: 40,
  cooling: "forced-air",
  ...over,
});

describe("loop-area limits", () => {
  it("tighten monotonically with fsw", () => {
    expect(powerLoopLimitMm2(1e6, false)).toBeLessThan(powerLoopLimitMm2(2e5, false));
    expect(gateLoopLimitMm2(1e6)).toBeLessThan(gateLoopLimitMm2(2e5));
  });

  it("hard-switched GaN above 500 kHz: power loop < 20 mm², gate loop < 10 mm²", () => {
    expect(powerLoopLimitMm2(6e5, false)).toBeLessThan(20);
    expect(gateLoopLimitMm2(6e5)).toBeLessThan(10);
  });

  it("soft switching relaxes the power loop but not below hard-switched", () => {
    expect(powerLoopLimitMm2(3e5, true)).toBeGreaterThan(powerLoopLimitMm2(3e5, false));
  });

  it("is clamped to practical bounds", () => {
    expect(powerLoopLimitMm2(1e3, false)).toBeLessThanOrEqual(50);
    expect(powerLoopLimitMm2(1e8, false)).toBeGreaterThanOrEqual(5);
  });
});

describe("creepage / clearance", () => {
  it("grow monotonically with working voltage", () => {
    expect(creepageMm(800)).toBeGreaterThan(creepageMm(48));
    expect(clearanceMm(800)).toBeGreaterThan(clearanceMm(48));
    expect(creepageMm(400)).toBeGreaterThan(clearanceMm(400)); // creepage ≥ clearance
  });

  it("reinforced insulation doubles basic creepage (min 5.5 mm)", () => {
    expect(creepageMm(400, true)).toBeGreaterThanOrEqual(2 * creepageMm(400) - 1e-9);
    expect(creepageMm(50, true)).toBeGreaterThanOrEqual(5.5);
  });
});

describe("layoutGuidance", () => {
  it("uses a 6-layer stackup above 1 kW and 4 layers below", () => {
    expect(layoutGuidance("dab", spec({ poutW: 3000, isolated: true }), 250e3).stackup).toHaveLength(6);
    expect(layoutGuidance("sync-buck", spec({ poutW: 300 }), 500e3).stackup).toHaveLength(4);
  });

  it("critical loops tighten with fsw", () => {
    const slow = layoutGuidance("sync-buck", spec(), 2e5);
    const fast = layoutGuidance("sync-buck", spec(), 1e6);
    const pl = (g: typeof slow) => g.criticalLoops.find((l) => l.name.includes("power commutation"))!.maxAreaMm2;
    const gl = (g: typeof slow) => g.criticalLoops.find((l) => l.name.includes("HS gate"))!.maxAreaMm2;
    expect(pl(fast)).toBeLessThan(pl(slow));
    expect(gl(fast)).toBeLessThan(gl(slow));
    for (const loop of fast.criticalLoops) {
      expect(loop.maxAreaMm2).toBeGreaterThan(0);
      expect(loop.note.length).toBeGreaterThan(0);
    }
  });

  it("soft-switched topology gets a relaxed power loop and a tank-loop entry", () => {
    const hard = layoutGuidance("sync-buck", spec(), 3e5);
    const soft = layoutGuidance("llc-half-bridge", spec({ isolated: true }), 3e5);
    const pl = (g: typeof hard) => g.criticalLoops.find((l) => l.name.includes("power commutation"))!.maxAreaMm2;
    expect(pl(soft)).toBeGreaterThan(pl(hard));
    expect(soft.criticalLoops.some((l) => l.name.includes("resonant tank"))).toBe(true);
  });

  it("rules include creepage (IEC), kelvin-source, and thermal-via callouts", () => {
    const g = layoutGuidance("dab", spec({ vinMaxV: 800, voutV: 48, poutW: 5000, isolated: true }), 200e3);
    const all = g.rules.join("\n");
    expect(all).toContain("IEC");
    expect(all.toLowerCase()).toContain("kelvin");
    expect(all.toLowerCase()).toContain("thermal via");
    expect(all).toContain("Reinforced isolation");
  });

  it("higher working voltage yields larger creepage in the rules", () => {
    const lo = layoutGuidance("sync-buck", spec({ vinMaxV: 60 }), 5e5);
    const hi = layoutGuidance("sync-buck", spec({ vinMaxV: 800, voutV: 400 }), 5e5);
    const num = (g: typeof lo) => parseFloat(/Creepage ≥ ([\d.]+) mm/.exec(g.rules.join("\n"))![1]);
    expect(num(hi)).toBeGreaterThan(num(lo));
  });

  it("placement floorplan SVG is dark/cyan with labeled blocks and arrows", () => {
    const g = layoutGuidance("totem-pole-pfc", spec({ conversion: "ac-dc", gridVacRms: 230, voutV: 400, poutW: 3000 }), 120e3);
    expect(g.placementSvg).toContain("<svg");
    expect(g.placementSvg).toContain("#0a0e14");
    expect(g.placementSvg).toContain("#22d3ee");
    expect(g.placementSvg).toContain("Magnetics");
    expect(g.placementSvg).toContain("Controller");
    expect(g.placementSvg).toContain("marker-end");
    // isolated designs draw the isolation barrier; non-isolated must not
    expect(g.placementSvg).not.toContain("isolation barrier");
    const iso = layoutGuidance("psfb", spec({ isolated: true, vinMaxV: 400 }), 150e3);
    expect(iso.placementSvg).toContain("isolation barrier");
  });
});
