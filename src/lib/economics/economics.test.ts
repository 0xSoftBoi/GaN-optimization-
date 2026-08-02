import { describe, expect, it } from "vitest";
import type { DesignResult, EfficiencyPoint } from "@/lib/types";
import {
  defaultAssumptions,
  energyEconomics,
  type EconomicsAssumptions,
} from "./index";

/**
 * energyEconomics only reads efficiencyCurve, bomCostUsd and spec.poutW —
 * a minimal stub keeps these unit tests fast and independent of the
 * optimizer (integration coverage lives in the API route test).
 */
function stubResult(opts: {
  poutW: number;
  bomCostUsd: number;
  curve: EfficiencyPoint[];
}): DesignResult {
  return {
    spec: { poutW: opts.poutW },
    bomCostUsd: opts.bomCostUsd,
    efficiencyCurve: opts.curve,
  } as unknown as DesignResult;
}

function flatCurve(effPct: number): EfficiencyPoint[] {
  return [10, 25, 50, 75, 100].map((loadPct) => ({
    loadPct,
    efficiencyPct: effPct,
    lossW: 0,
  }));
}

const SPEC_STUB = { poutW: 1000 } as unknown as Parameters<typeof defaultAssumptions>[0];

function baseAssumptions(over: Partial<EconomicsAssumptions> = {}): EconomicsAssumptions {
  return { ...defaultAssumptions(SPEC_STUB), ...over };
}

describe("defaultAssumptions", () => {
  it("returns the documented editable defaults", () => {
    const a = defaultAssumptions(SPEC_STUB);
    expect(a.pricePerMwhUsd).toBe(70);
    expect(a.hoursPerYear).toBe(8760);
    expect(a.baselineEfficiencyPct).toBe(96.5);
    expect(a.fleetUnits).toBe(1);
    expect(a.horizonYears).toBeGreaterThan(0);
    expect(a.carbonKgPerMwh).toBe(350);
  });

  it("load profile weights sum to 1 and concentrate in the 60-90% band", () => {
    const a = defaultAssumptions(SPEC_STUB);
    const total = a.loadProfile.reduce((s, p) => s + p.weight, 0);
    expect(total).toBeCloseTo(1, 10);
    const band = a.loadProfile
      .filter((p) => p.loadPct >= 60 && p.loadPct <= 90)
      .reduce((s, p) => s + p.weight, 0);
    expect(band).toBeGreaterThanOrEqual(0.6);
    for (const p of a.loadProfile) {
      expect(p.loadPct).toBeGreaterThanOrEqual(0);
      expect(p.loadPct).toBeLessThanOrEqual(100);
      expect(p.weight).toBeGreaterThan(0);
    }
  });
});

describe("energyEconomics — known-number checks", () => {
  // 1 kW unit, flat 98% curve vs 96.5% baseline, full load, 8760 h, 70 $/MWh:
  //   E_out = 8.76 MWh; E_in = 8.76/0.98; E_in_base = 8.76/0.965
  const result = stubResult({ poutW: 1000, bomCostUsd: 120, curve: flatCurve(98) });
  const a = baseAssumptions({ loadProfile: [{ loadPct: 100, weight: 1 }] });
  const eco = energyEconomics(result, a);

  it("weighted efficiencies", () => {
    expect(eco.weightedEfficiencyPct).toBeCloseTo(98, 10);
    expect(eco.baselineWeightedPct).toBeCloseTo(96.5, 10);
  });

  it("annual output energy = pout × hours", () => {
    expect(eco.annualMwhPerUnit).toBeCloseTo(8.76, 10);
  });

  it("energy and dollar savings vs baseline processing the same output energy", () => {
    const expectedSavedMwh = 8.76 / 0.965 - 8.76 / 0.98;
    expect(eco.annualMwhSavedPerUnit).toBeCloseTo(expectedSavedMwh, 9);
    expect(eco.annualUsdSavedPerUnit).toBeCloseTo(expectedSavedMwh * 70, 8);
  });

  it("loss at profile = P_in − P_out", () => {
    expect(eco.lossAtProfileW).toBeCloseTo(1000 / 0.98 - 1000, 8);
  });

  it("payback repays the unit BOM cost", () => {
    const usd = eco.annualUsdSavedPerUnit;
    expect(eco.paybackMonths).toBeCloseTo((120 / usd) * 12, 8);
    expect(eco.unitBomCostUsd).toBe(120);
  });

  it("CO2 = saved MWh × intensity / 1000", () => {
    expect(eco.co2SavedTonnesPerYear).toBeCloseTo((eco.annualMwhSavedPerUnit * 350) / 1000, 10);
  });

  it("fleet and horizon scale linearly", () => {
    const eco10 = energyEconomics(result, { ...a, fleetUnits: 10, horizonYears: 3 });
    expect(eco10.fleetAnnualUsdSaved).toBeCloseTo(10 * eco.annualUsdSavedPerUnit, 8);
    expect(eco10.fleetHorizonUsdSaved).toBeCloseTo(30 * eco.annualUsdSavedPerUnit, 8);
    expect(eco10.co2SavedTonnesPerYear).toBeCloseTo(10 * eco.co2SavedTonnesPerYear, 8);
    // Per-unit numbers are fleet-independent.
    expect(eco10.annualUsdSavedPerUnit).toBeCloseTo(eco.annualUsdSavedPerUnit, 10);
  });
});

describe("energyEconomics — interpolation and weighting", () => {
  it("interpolates the efficiency curve between points", () => {
    const curve: EfficiencyPoint[] = [
      { loadPct: 20, efficiencyPct: 90, lossW: 0 },
      { loadPct: 100, efficiencyPct: 98, lossW: 0 },
    ];
    const eco = energyEconomics(
      stubResult({ poutW: 500, bomCostUsd: 50, curve }),
      baseAssumptions({ loadProfile: [{ loadPct: 60, weight: 1 }] }),
    );
    expect(eco.weightedEfficiencyPct).toBeCloseTo(94, 10); // halfway 20→100
  });

  it("normalizes profile weights (2:2 behaves like 0.5:0.5)", () => {
    const result = stubResult({ poutW: 800, bomCostUsd: 90, curve: flatCurve(97) });
    const profA = baseAssumptions({
      loadProfile: [
        { loadPct: 50, weight: 2 },
        { loadPct: 100, weight: 2 },
      ],
    });
    const profB = baseAssumptions({
      loadProfile: [
        { loadPct: 50, weight: 0.5 },
        { loadPct: 100, weight: 0.5 },
      ],
    });
    expect(energyEconomics(result, profA)).toEqual(energyEconomics(result, profB));
  });

  it("clamps profile points outside the curve range to the end values", () => {
    const eco = energyEconomics(
      stubResult({ poutW: 100, bomCostUsd: 10, curve: flatCurve(97) }),
      baseAssumptions({ loadProfile: [{ loadPct: 5, weight: 1 }] }), // below curve's 10%
    );
    expect(eco.weightedEfficiencyPct).toBeCloseTo(97, 10);
  });
});

describe("energyEconomics — edge cases", () => {
  const goodResult = stubResult({ poutW: 1000, bomCostUsd: 100, curve: flatCurve(98) });

  it("design worse than baseline: negative savings, payback null, negative CO2", () => {
    const eco = energyEconomics(
      stubResult({ poutW: 1000, bomCostUsd: 100, curve: flatCurve(90) }),
      baseAssumptions(),
    );
    expect(eco.annualMwhSavedPerUnit).toBeLessThan(0);
    expect(eco.annualUsdSavedPerUnit).toBeLessThan(0);
    expect(eco.fleetHorizonUsdSaved).toBeLessThan(0);
    expect(eco.co2SavedTonnesPerYear).toBeLessThan(0);
    expect(eco.paybackMonths).toBeNull();
  });

  it("design equal to baseline: zero savings, payback null", () => {
    const eco = energyEconomics(
      stubResult({ poutW: 1000, bomCostUsd: 100, curve: flatCurve(96.5) }),
      baseAssumptions(),
    );
    expect(eco.annualMwhSavedPerUnit).toBeCloseTo(0, 10);
    expect(eco.paybackMonths).toBeNull();
  });

  it("zero price: zero dollars, payback null, energy/CO2 unaffected", () => {
    const eco = energyEconomics(goodResult, baseAssumptions({ pricePerMwhUsd: 0 }));
    expect(eco.annualUsdSavedPerUnit).toBe(0);
    expect(eco.fleetAnnualUsdSaved).toBe(0);
    expect(eco.paybackMonths).toBeNull();
    expect(eco.annualMwhSavedPerUnit).toBeGreaterThan(0);
    expect(eco.co2SavedTonnesPerYear).toBeGreaterThan(0);
  });

  it("empty load profile throws", () => {
    expect(() => energyEconomics(goodResult, baseAssumptions({ loadProfile: [] }))).toThrow(
      /loadProfile/,
    );
  });

  it("all-zero profile weights throw", () => {
    expect(() =>
      energyEconomics(
        goodResult,
        baseAssumptions({ loadProfile: [{ loadPct: 50, weight: 0 }] }),
      ),
    ).toThrow(/weights/);
  });

  it("negative weight throws", () => {
    expect(() =>
      energyEconomics(
        goodResult,
        baseAssumptions({
          loadProfile: [
            { loadPct: 50, weight: 1 },
            { loadPct: 80, weight: -0.5 },
          ],
        }),
      ),
    ).toThrow(/weight/);
  });

  it("invalid scalar assumptions throw with the field named", () => {
    expect(() => energyEconomics(goodResult, baseAssumptions({ hoursPerYear: 0 }))).toThrow(
      /hoursPerYear/,
    );
    expect(() =>
      energyEconomics(goodResult, baseAssumptions({ baselineEfficiencyPct: 0 })),
    ).toThrow(/baselineEfficiencyPct/);
    expect(() =>
      energyEconomics(goodResult, baseAssumptions({ baselineEfficiencyPct: 101 })),
    ).toThrow(/baselineEfficiencyPct/);
    expect(() => energyEconomics(goodResult, baseAssumptions({ pricePerMwhUsd: -1 }))).toThrow(
      /pricePerMwhUsd/,
    );
    expect(() => energyEconomics(goodResult, baseAssumptions({ fleetUnits: 0 }))).toThrow(
      /fleetUnits/,
    );
    expect(() => energyEconomics(goodResult, baseAssumptions({ horizonYears: 0 }))).toThrow(
      /horizonYears/,
    );
    expect(() => energyEconomics(goodResult, baseAssumptions({ carbonKgPerMwh: -5 }))).toThrow(
      /carbonKgPerMwh/,
    );
    expect(() => energyEconomics(goodResult, baseAssumptions({ hoursPerYear: NaN }))).toThrow(
      /hoursPerYear/,
    );
  });

  it("empty efficiency curve throws", () => {
    expect(() =>
      energyEconomics(stubResult({ poutW: 1000, bomCostUsd: 100, curve: [] }), baseAssumptions()),
    ).toThrow(/efficiencyCurve/);
  });
});

describe("energyEconomics — price sensitivity", () => {
  const result = stubResult({ poutW: 2000, bomCostUsd: 200, curve: flatCurve(98) });

  it("has 5 points, centered on the assumed price, linear in price", () => {
    const eco = energyEconomics(result, baseAssumptions({ pricePerMwhUsd: 100, fleetUnits: 4 }));
    expect(eco.sensitivity).toHaveLength(5);
    expect(eco.sensitivity.map((s) => s.pricePerMwhUsd)).toEqual([50, 75, 100, 125, 150]);
    expect(eco.sensitivity[2].fleetAnnualUsdSaved).toBeCloseTo(eco.fleetAnnualUsdSaved, 8);
    // Linearity: point at 2× half-price equals the center.
    expect(eco.sensitivity[0].fleetAnnualUsdSaved * 2).toBeCloseTo(eco.fleetAnnualUsdSaved, 8);
    // Monotonic in price when savings are positive.
    for (let i = 1; i < eco.sensitivity.length; i++) {
      expect(eco.sensitivity[i].fleetAnnualUsdSaved).toBeGreaterThan(
        eco.sensitivity[i - 1].fleetAnnualUsdSaved,
      );
    }
  });

  it("higher assumed price -> higher savings (monotonicity across runs)", () => {
    const lo = energyEconomics(result, baseAssumptions({ pricePerMwhUsd: 40 }));
    const hi = energyEconomics(result, baseAssumptions({ pricePerMwhUsd: 140 }));
    expect(hi.fleetAnnualUsdSaved).toBeGreaterThan(lo.fleetAnnualUsdSaved);
    // Energy quantities are price-independent.
    expect(hi.annualMwhSavedPerUnit).toBeCloseTo(lo.annualMwhSavedPerUnit, 10);
  });
});
