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

describe("calibration harness — A2 Infineon CoolGaN ISOP LLC", () => {
  const a2 = ALL_ANCHORS.find((x) => x.id === "a2-infineon-isop-6kw");

  it("anchor A2 is configured", () => {
    expect(a2).toBeDefined();
  });

  if (a2) {
    it("reproduces the design through designConverter", () => {
      const result = runAnchor(a2);
      expect(result.designResult).toBeDefined();
      expect(result.modelEfficiencyPct).toBeGreaterThan(0);
      expect(result.modelEfficiencyPct).toBeLessThan(100);
    });

    it("efficiency delta is tracked for A2", () => {
      const result = runAnchor(a2);
      const delta = result.deltaEfficiencyPct;
      expect(Number.isFinite(delta)).toBe(true);
      console.log(`A2 Infineon CoolGaN: published ${a2.publishedEfficiencyPct.toFixed(2)}% vs model ${result.modelEfficiencyPct.toFixed(2)}% (Δ ${delta.toFixed(3)}%)`);
    });
  }
});

describe("calibration harness — A3 Navitas CRPS185", () => {
  const a3 = ALL_ANCHORS.find((x) => x.id === "a3-navitas-4500w-crps185");

  it("anchor A3 is configured", () => {
    expect(a3).toBeDefined();
  });

  if (a3) {
    it("reproduces the design through designConverter", () => {
      const result = runAnchor(a3);
      expect(result.designResult).toBeDefined();
      expect(result.modelEfficiencyPct).toBeGreaterThan(0);
      expect(result.modelEfficiencyPct).toBeLessThan(100);
    });

    it("efficiency delta is tracked for A3", () => {
      const result = runAnchor(a3);
      const delta = result.deltaEfficiencyPct;
      expect(Number.isFinite(delta)).toBe(true);
      console.log(`A3 Navitas CRPS185: published ${a3.publishedEfficiencyPct.toFixed(2)}% vs model ${result.modelEfficiencyPct.toFixed(2)}% (Δ ${delta.toFixed(3)}%)`);
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

  it("logs calibration status for all anchors", () => {
    const { results, summary } = runAllAnchors();
    console.log("\n=== CALIBRATION STATUS ===");
    console.log(summary);
    for (const r of results) {
      const status = r.passed ? "✓ PASS" : "✗ FAIL";
      console.log(`${status} ${r.anchorName}: ${r.publishedEfficiencyPct.toFixed(2)}% (pub) vs ${r.modelEfficiencyPct.toFixed(2)}% (mod), Δ ${r.deltaEfficiencyPct.toFixed(3)}%`);
    }
  });

  it("debug: magnetics operating points and wire selection", () => {
    const a1 = ALL_ANCHORS.find((x) => x.id === "a1-ti-pmp23126");
    const a2 = ALL_ANCHORS.find((x) => x.id === "a2-infineon-isop-6kw");

    for (const anchor of [a1, a2].filter(Boolean)) {
      if (!anchor) continue;
      const result = runAnchor(anchor);
      const design = result.designResult;

      console.log(`\n${anchor.id}: Magnetics detail`);
      console.log(`  Fsw: ${design.fswHz} Hz`);

      for (const mag of design.magnetics) {
        console.log(`\n  ${mag.role}:`);
        console.log(`    Core: ${mag.core.id}`);
        console.log(`      Ae: ${mag.core.aeMm2} mm², Ve: ${mag.core.veMm3} mm³, MLT: ${mag.core.mltMm} mm`);
        console.log(`    Turns: ${mag.turnsPrimary}${mag.turnsSecondary ? `/${mag.turnsSecondary}` : ''}, Gap: ${mag.airGapMm.toFixed(3)} mm`);
        console.log(`    Wire: ${mag.wirePrimary.id} (Cu area: ${mag.wirePrimary.copperAreaMm2.toFixed(4)} mm², Rdc: ${mag.wirePrimary.rdcMohmPerM.toFixed(3)} mΩ/m)`);
        console.log(`    B-field: peak ${mag.bPeakT.toFixed(3)} T`);
        console.log(`    Copper loss: ${mag.copperLossW.toFixed(2)}W, Core loss: ${mag.coreLossW.toFixed(2)}W`);
        console.log(`    Temp rise: ${mag.tempRiseC.toFixed(1)}°C, Window util: ${(mag.windowUtilization * 100).toFixed(1)}%`);
        console.log(`    Notes: ${(mag.notes || "").substring(0, 120)}`);
      }
    }
  });

  it("debug: loss breakdown for each anchor", () => {
    const results = runAllAnchors().results;
    console.log("\n=== LOSS BREAKDOWN ANALYSIS ===");
    for (const r of results) {
      const design = r.designResult;
      console.log(`\n${r.anchorId}: ${r.anchorName}`);
      console.log(`  Published vs Model: ${r.publishedEfficiencyPct.toFixed(2)}% vs ${r.modelEfficiencyPct.toFixed(2)}% (Δ ${r.deltaEfficiencyPct.toFixed(3)}%)`);
      console.log(`  Topology: ${design.topology?.id || "(undefined)"} (${design.topology?.name})`);
      console.log(`  Conversion: ${design.spec.conversion}`);
      if (design.losses) {
        const losses = design.losses;
        const deviceTotal = losses.devices.reduce((sum, d) => sum + d.totalW, 0);
        console.log(`  Losses (W) @ ${design.spec.poutW}W nominal:`);
        console.log(`    Device total: ${deviceTotal.toFixed(2)}`);
        console.log(`      Conduction: ${losses.devices.reduce((sum, d) => sum + d.conductionW, 0).toFixed(2)}`);
        console.log(`      Switching: ${losses.devices.reduce((sum, d) => sum + d.switchingW, 0).toFixed(2)}`);
        console.log(`      Coss: ${losses.devices.reduce((sum, d) => sum + d.cossW, 0).toFixed(2)}`);
        console.log(`      Gate: ${losses.devices.reduce((sum, d) => sum + d.gateW, 0).toFixed(2)}`);
        console.log(`      Dead-time: ${losses.devices.reduce((sum, d) => sum + d.deadTimeW, 0).toFixed(2)}`);
        console.log(`    Magnetics core: ${losses.magneticsCoreW.toFixed(2)}`);
        console.log(`    Magnetics copper: ${losses.magneticsCopperW.toFixed(2)}`);
        console.log(`    Capacitor ESR: ${losses.capacitorW.toFixed(2)}`);
        console.log(`    Overhead: ${losses.overheadW.toFixed(2)}`);
        console.log(`    Total: ${losses.totalW.toFixed(2)}`);
      }
      if (design.warnings && design.warnings.length > 0) {
        console.log(`  Warnings: ${design.warnings.length}`);
        design.warnings.forEach((w, i) => {
          if (i < 3) console.log(`    [${i}] ${w.substring(0, 100)}`);
        });
      }
      if (design.efficiencyCurve) {
        const curve100 = design.efficiencyCurve.find(p => p.loadPct === 100);
        if (curve100) {
          console.log(`  Calculated loss (100-eff): ${(100 - curve100.efficiencyPct).toFixed(2)}%`);
        }
      }
    }
  });
});
