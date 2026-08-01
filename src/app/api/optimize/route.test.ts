import { describe, expect, it } from "vitest";
import type { DesignCandidateSummary, TopologyId } from "@/lib/types";
import { BUCK_SPEC, postJson, postRaw } from "../_lib/test-fixtures";
import { POST } from "./route";

interface OptimizeResponse {
  candidates: DesignCandidateSummary[];
  bestSummary: {
    topologyId: TopologyId;
    efficiencyPct: number;
    bomCostUsd: number;
    fswHz: number;
    deviceId: string;
  };
}

describe("POST /api/optimize — validation", () => {
  it("400 on malformed JSON", async () => {
    expect((await POST(postRaw("nope"))).status).toBe(400);
  });

  it("400 on a bad spec", async () => {
    const res = await POST(postJson({ spec: { ...BUCK_SPEC, conversion: "ac-ac" } }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/optimize — happy path", () => {
  it("returns the candidate space plus a compact best summary (no DesignResult)", async () => {
    const res = await POST(postJson({ spec: BUCK_SPEC }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as OptimizeResponse;

    // Exactly the light payload — the heavy DesignResult must be omitted.
    expect(Object.keys(body).sort()).toEqual(["bestSummary", "candidates"]);

    expect(body.candidates.length).toBeGreaterThan(0);
    for (const c of body.candidates) {
      expect(typeof c.topologyId).toBe("string");
      expect(typeof c.deviceId).toBe("string");
      expect(c.fswHz).toBeGreaterThan(0);
      expect(c.bomCostUsd).toBeGreaterThan(0);
      expect(c.efficiencyPct).toBeGreaterThan(0);
      expect(c.efficiencyPct).toBeLessThan(100);
      expect(typeof c.feasible).toBe("boolean");
      expect(typeof c.pareto).toBe("boolean");
    }

    // At least one Pareto-front member among the feasible candidates.
    expect(body.candidates.some((c) => c.pareto)).toBe(true);

    const best = body.bestSummary;
    expect(best.deviceId.length).toBeGreaterThan(0);
    expect(best.fswHz).toBeGreaterThan(20e3);
    expect(best.fswHz).toBeLessThan(5e6);
    expect(best.efficiencyPct).toBeGreaterThan(80);
    expect(best.efficiencyPct).toBeLessThan(99.9);
    expect(best.bomCostUsd).toBeGreaterThan(0);

    // The winner must be drawn from the explored candidate topologies.
    expect(body.candidates.map((c) => c.topologyId)).toContain(best.topologyId);

    // The best efficiency should not exceed the best feasible candidate's.
    const feasible = body.candidates.filter((c) => c.feasible);
    if (feasible.length > 0) {
      const maxEff = Math.max(...feasible.map((c) => c.efficiencyPct));
      expect(best.efficiencyPct).toBeLessThanOrEqual(maxEff + 1e-6);
    }
  });
});
