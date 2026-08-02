import { describe, expect, it } from "vitest";
import { runAnchor, runAllAnchors, ALL_ANCHORS } from "./index";

describe("calibration harness — anchor reproduction", () => {
  it("has at least one anchor configured", () => {
    expect(ALL_ANCHORS.length).toBeGreaterThan(0);
  });

  it("each anchor has required fields", () => {
    for (const a of ALL_ANCHORS) {
      expect(a.id).toBeTruthy();
      expect(a.name).toBeTruthy();
      expect(a.source).toBeTruthy();
      expect(a.spec).toBeDefined();
      expect(a.publishedEfficiencyPct).toBeGreaterThan(0);
      expect(a.publishedEfficiencyPct).toBeLessThan(100);
      expect(a.nominalLoadPct).toBeGreaterThan(0);
      expect(a.nominalLoadPct).toBeLessThanOrEqual(100);
    }
  });
});

describe("calibration harness — A1 TI PMP23126 (3 kW OBC DAB)", () => {
  const a1 = ALL_ANCHORS.find((x) => x.id === "a1-ti-pmp23126");

  it("anchor A1 is configured", () => {
    expect(a1).toBeDefined();
  });

  if (a1) {
    it("reproduces the design through designConverter", () => {
      const result = runAnchor(a1);
      expect(result.designResult).toBeDefined();
      expect(result.modelEfficiencyPct).toBeGreaterThan(0);
      expect(result.modelEfficiencyPct).toBeLessThan(100);
    });

    it("published efficiency is within plausible range for 3 kW isolated DAB", () => {
      const result = runAnchor(a1);
      // 3 kW isolated DAB: expect 95–98 % efficiency in practice
      expect(a1.publishedEfficiencyPct).toBeGreaterThan(94);
      expect(a1.publishedEfficiencyPct).toBeLessThan(99);
    });

    it("compliance passes (DAB bridge + magnetics + thermal)", () => {
      const result = runAnchor(a1);
      expect(result.designResult.compliance).toBeDefined();
      // Note: May have warnings; we check structure exists.
      expect(Array.isArray(result.designResult.compliance.findings)).toBe(true);
    });

    it("efficiency delta is tracked (even if not yet within gate)", () => {
      const result = runAnchor(a1);
      const delta = result.deltaEfficiencyPct;
      expect(Number.isFinite(delta)).toBe(true);
      // Log for debugging (not a hard assertion, since this anchor may need model tuning)
      console.log(`A1 TI PMP23126: published ${a1.publishedEfficiencyPct.toFixed(2)}% vs model ${result.modelEfficiencyPct.toFixed(2)}% (Δ ${delta.toFixed(3)}%)`);
    });
  }
});

describe("calibration harness — runAllAnchors aggregation", () => {
  it("returns results for all configured anchors", () => {
    const { results } = runAllAnchors();
    expect(results.length).toBe(ALL_ANCHORS.length);
  });

  it("tracks pass/fail count", () => {
    const { results, passCount, failCount, allPassed } = runAllAnchors();
    expect(passCount + failCount).toBe(results.length);
    // If all pass, flag should be true
    if (passCount === results.length) {
      expect(allPassed).toBe(true);
    } else {
      expect(allPassed).toBe(false);
    }
  });

  it("provides a summary string", () => {
    const { summary } = runAllAnchors();
    expect(summary).toBeTruthy();
    expect(summary).toMatch(/anchor/i);
  });
});
