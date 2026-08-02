import { describe, expect, it } from "vitest";
import type { EconomicsAssumptions, EnergyEconomics } from "@/lib/economics";
import { BUCK_SPEC, postJson, postRaw } from "../_lib/test-fixtures";
import { POST } from "./route";

interface EconomicsResponse {
  design: {
    topologyId: string;
    fswHz: number;
    poutW: number;
    efficiencyPct: number;
    bomCostUsd: number;
  };
  assumptions: EconomicsAssumptions;
  economics: EnergyEconomics;
}

describe("POST /api/economics — input validation", () => {
  it("400 on a non-JSON body", async () => {
    const res = await POST(postRaw("not json"));
    expect(res.status).toBe(400);
  });

  it("400 when body.spec is missing", async () => {
    const res = await POST(postJson({ assumptions: { pricePerMwhUsd: 90 } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.join(" ")).toMatch(/spec/);
  });

  it("400 on an invalid spec, naming fields", async () => {
    const res = await POST(postJson({ spec: { conversion: "dc-dc" } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.join(" ")).toMatch(/poutW/);
  });

  it("400 on non-object assumptions", async () => {
    const res = await POST(postJson({ spec: BUCK_SPEC, assumptions: "cheap" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/assumptions/i);
  });

  it("400 on bad assumption values, naming fields", async () => {
    const res = await POST(
      postJson({
        spec: BUCK_SPEC,
        assumptions: { pricePerMwhUsd: -5, hoursPerYear: 99999, baselineEfficiencyPct: 0 },
      }),
    );
    expect(res.status).toBe(400);
    const all = (await res.json()).details.join(" ");
    expect(all).toMatch(/pricePerMwhUsd/);
    expect(all).toMatch(/hoursPerYear/);
    expect(all).toMatch(/baselineEfficiencyPct/);
  });

  it("400 on an empty load profile", async () => {
    const res = await POST(postJson({ spec: BUCK_SPEC, assumptions: { loadProfile: [] } }));
    expect(res.status).toBe(400);
    expect((await res.json()).details.join(" ")).toMatch(/loadProfile/);
  });

  it("400 on malformed load-profile entries", async () => {
    const res = await POST(
      postJson({
        spec: BUCK_SPEC,
        assumptions: { loadProfile: [{ loadPct: 150, weight: 1 }] },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).details.join(" ")).toMatch(/loadPct/);
  });
});

describe("POST /api/economics — happy path", () => {
  it("returns design summary, resolved default assumptions and economics", async () => {
    const res = await POST(postJson({ spec: BUCK_SPEC }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const r = (await res.json()) as EconomicsResponse;

    // Design summary mirrors the optimizer result.
    expect(typeof r.design.topologyId).toBe("string");
    expect(r.design.poutW).toBe(BUCK_SPEC.poutW);
    expect(r.design.efficiencyPct).toBeGreaterThan(80);
    expect(r.design.bomCostUsd).toBeGreaterThan(1);

    // Defaults echoed back so the UI can present every editable input.
    expect(r.assumptions.pricePerMwhUsd).toBe(70);
    expect(r.assumptions.hoursPerYear).toBe(8760);
    expect(r.assumptions.baselineEfficiencyPct).toBe(96.5);
    expect(r.assumptions.fleetUnits).toBe(1);
    expect(r.assumptions.carbonKgPerMwh).toBe(350);
    expect(r.assumptions.loadProfile.length).toBeGreaterThan(2);

    // Economics plausibility for a 240 W unit running 8760 h.
    const e = r.economics;
    expect(e.weightedEfficiencyPct).toBeGreaterThan(80);
    expect(e.weightedEfficiencyPct).toBeLessThan(100);
    expect(e.baselineWeightedPct).toBe(96.5);
    expect(e.annualMwhPerUnit).toBeGreaterThan(0);
    expect(e.annualMwhPerUnit).toBeLessThan((BUCK_SPEC.poutW * 8760) / 1e6 + 1e-9);
    expect(e.unitBomCostUsd).toBe(r.design.bomCostUsd);
    expect(e.lossAtProfileW).toBeGreaterThan(0);
    expect(e.sensitivity).toHaveLength(5);
    expect(e.sensitivity[2].pricePerMwhUsd).toBe(70);
    if (e.paybackMonths !== null) expect(e.paybackMonths).toBeGreaterThan(0);
    // Savings sign must agree with efficiency vs baseline.
    expect(e.annualMwhSavedPerUnit > 0).toBe(e.weightedEfficiencyPct > e.baselineWeightedPct);
  });

  it("merges partial assumption overrides over defaults, linearly scaling savings", async () => {
    const base = (await (await POST(postJson({ spec: BUCK_SPEC }))).json()) as EconomicsResponse;
    const doubled = (await (
      await POST(postJson({ spec: BUCK_SPEC, assumptions: { pricePerMwhUsd: 140, fleetUnits: 100 } }))
    ).json()) as EconomicsResponse;

    expect(doubled.assumptions.pricePerMwhUsd).toBe(140);
    expect(doubled.assumptions.fleetUnits).toBe(100);
    // Untouched fields keep defaults.
    expect(doubled.assumptions.hoursPerYear).toBe(8760);
    // Energy is price-independent; dollars scale 2× price × 100 units.
    expect(doubled.economics.annualMwhSavedPerUnit).toBeCloseTo(
      base.economics.annualMwhSavedPerUnit,
      9,
    );
    expect(doubled.economics.fleetAnnualUsdSaved).toBeCloseTo(
      200 * base.economics.fleetAnnualUsdSaved,
      6,
    );
  });

  it("a lenient baseline flips savings positive vs a 100% baseline (never beatable)", async () => {
    const harsh = (await (
      await POST(postJson({ spec: BUCK_SPEC, assumptions: { baselineEfficiencyPct: 100 } }))
    ).json()) as EconomicsResponse;
    const lenient = (await (
      await POST(postJson({ spec: BUCK_SPEC, assumptions: { baselineEfficiencyPct: 80 } }))
    ).json()) as EconomicsResponse;

    expect(harsh.economics.annualMwhSavedPerUnit).toBeLessThan(0);
    expect(harsh.economics.paybackMonths).toBeNull();
    expect(lenient.economics.annualMwhSavedPerUnit).toBeGreaterThan(0);
    expect(lenient.economics.paybackMonths).not.toBeNull();
  });

  it("custom load profile is used and echoed", async () => {
    const res = await POST(
      postJson({
        spec: BUCK_SPEC,
        assumptions: { loadProfile: [{ loadPct: 100, weight: 1 }] },
      }),
    );
    expect(res.status).toBe(200);
    const r = (await res.json()) as EconomicsResponse;
    expect(r.assumptions.loadProfile).toEqual([{ loadPct: 100, weight: 1 }]);
    // At 100% load, delivered energy is exactly pout × hours.
    expect(r.economics.annualMwhPerUnit).toBeCloseTo((BUCK_SPEC.poutW * 8760) / 1e6, 9);
  });
});
