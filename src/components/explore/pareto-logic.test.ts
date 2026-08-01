import { describe, expect, it } from "vitest";
import type { DesignCandidateSummary } from "@/lib/types";
import {
  DEFAULT_SPEC,
  candidateKey,
  formStateFromSpec,
  groupCandidates,
  linScale,
  niceTicks,
  paddedExtent,
  radiusForDensity,
  specFromForm,
} from "./pareto-logic";

function cand(over: Partial<DesignCandidateSummary>): DesignCandidateSummary {
  return {
    topologyId: "dab",
    deviceId: "GAN650",
    fswHz: 250e3,
    efficiencyPct: 96.5,
    bomCostUsd: 120,
    powerDensityWPerL: 2500,
    feasible: true,
    pareto: false,
    ...over,
  };
}

describe("DEFAULT_SPEC (the 5 kW example)", () => {
  it("matches the flagship prompt: 5 kW bidirectional 800V bus → 48V, forced air, 40 °C", () => {
    expect(DEFAULT_SPEC.poutW).toBe(5000);
    expect(DEFAULT_SPEC.vinNomV).toBe(800);
    expect(DEFAULT_SPEC.voutV).toBe(48);
    expect(DEFAULT_SPEC.bidirectional).toBe(true);
    expect(DEFAULT_SPEC.isolated).toBe(true);
    expect(DEFAULT_SPEC.cooling).toBe("forced-air");
    expect(DEFAULT_SPEC.ambientC).toBe(40);
    expect(DEFAULT_SPEC.vinMinV).toBeLessThanOrEqual(DEFAULT_SPEC.vinNomV);
    expect(DEFAULT_SPEC.vinNomV).toBeLessThanOrEqual(DEFAULT_SPEC.vinMaxV);
  });
});

describe("spec form round-trip", () => {
  it("formStateFromSpec → specFromForm reproduces the spec", () => {
    const state = formStateFromSpec(DEFAULT_SPEC);
    const r = specFromForm(state);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec).toEqual(DEFAULT_SPEC);
  });

  it("converts fsw kHz → Hz and keeps optionals absent when blank", () => {
    const state = formStateFromSpec(DEFAULT_SPEC);
    const r1 = specFromForm({ ...state, fswKhz: "250" });
    expect(r1.ok && r1.spec.fswHz).toBe(250e3);
    const r2 = specFromForm({ ...state, fswKhz: "" });
    expect(r2.ok && !("fswHz" in (r2.ok ? r2.spec : {}))).toBe(true);
  });

  it("rejects a non-monotonic Vin range with a readable error", () => {
    const state = formStateFromSpec(DEFAULT_SPEC);
    const r = specFromForm({ ...state, vinMinV: "900", vinNomV: "800" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/min ≤ nom ≤ max/);
  });

  it("rejects non-numeric and non-positive required fields", () => {
    const state = formStateFromSpec(DEFAULT_SPEC);
    expect(specFromForm({ ...state, poutW: "abc" }).ok).toBe(false);
    expect(specFromForm({ ...state, voutV: "-48" }).ok).toBe(false);
    expect(specFromForm({ ...state, poutW: "" }).ok).toBe(false);
  });
});

describe("niceTicks", () => {
  it("produces 4–6 sorted round-number ticks inside the domain", () => {
    const domains: [number, number][] = [
      [0, 100],
      [93.2, 98.7], // efficiency-like
      [42, 618], // cost-like
      [0.001, 0.009],
      [1.2e6, 8.9e6],
      [-40, 125],
    ];
    for (const [lo, hi] of domains) {
      const ticks = niceTicks(lo, hi);
      expect(ticks.length).toBeGreaterThanOrEqual(4);
      expect(ticks.length).toBeLessThanOrEqual(6);
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
      }
      expect(ticks[0]).toBeGreaterThanOrEqual(lo - 1e-9 * Math.abs(lo));
      expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(hi + 1e-9 * Math.abs(hi));
    }
  });

  it("handles a degenerate domain", () => {
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});

describe("paddedExtent / linScale", () => {
  it("pads the extent symmetrically and never collapses", () => {
    const [lo, hi] = paddedExtent([10, 20]);
    expect(lo).toBeLessThan(10);
    expect(hi).toBeGreaterThan(20);
    const [a, b] = paddedExtent([7, 7]);
    expect(b).toBeGreaterThan(a);
  });

  it("linScale maps domain endpoints to range endpoints (inverted ranges too)", () => {
    const sx = linScale(0, 10, 0, 500);
    expect(sx(0)).toBe(0);
    expect(sx(10)).toBe(500);
    expect(sx(5)).toBe(250);
    const sy = linScale(90, 100, 300, 0); // SVG y grows downward
    expect(sy(90)).toBe(300);
    expect(sy(100)).toBe(0);
  });
});

describe("groupCandidates", () => {
  it("splits into front/dominated/infeasible and sorts the front by cost", () => {
    const cands = [
      cand({ deviceId: "a", pareto: true, bomCostUsd: 300 }),
      cand({ deviceId: "b", pareto: true, bomCostUsd: 100 }),
      cand({ deviceId: "c", pareto: false }),
      cand({ deviceId: "d", feasible: false, pareto: false }),
    ];
    const g = groupCandidates(cands);
    expect(g.front.map((c) => c.deviceId)).toEqual(["b", "a"]);
    expect(g.dominated.map((c) => c.deviceId)).toEqual(["c"]);
    expect(g.infeasible.map((c) => c.deviceId)).toEqual(["d"]);
    expect(g.front.length + g.dominated.length + g.infeasible.length).toBe(cands.length);
  });
});

describe("radiusForDensity", () => {
  it("grows monotonically with density and stays within [3.5, 9] px", () => {
    const rLo = radiusForDensity(1000, 1000, 5000);
    const rMid = radiusForDensity(3000, 1000, 5000);
    const rHi = radiusForDensity(5000, 1000, 5000);
    expect(rLo).toBeCloseTo(3.5);
    expect(rHi).toBeCloseTo(9);
    expect(rMid).toBeGreaterThan(rLo);
    expect(rMid).toBeLessThan(rHi);
    // Out-of-range densities clamp instead of exploding.
    expect(radiusForDensity(50000, 1000, 5000)).toBeCloseTo(9);
    expect(radiusForDensity(-10, 1000, 5000)).toBeCloseTo(3.5);
  });

  it("falls back to a mid radius when the density span is degenerate", () => {
    const r = radiusForDensity(2000, 2000, 2000);
    expect(r).toBeGreaterThan(3.5);
    expect(r).toBeLessThan(9);
  });
});

describe("candidateKey", () => {
  it("distinguishes topology, device, and fsw", () => {
    const a = cand({});
    expect(candidateKey(a)).toBe(candidateKey(cand({})));
    expect(candidateKey(cand({ deviceId: "x" }))).not.toBe(candidateKey(a));
    expect(candidateKey(cand({ fswHz: 300e3 }))).not.toBe(candidateKey(a));
    expect(candidateKey(cand({ topologyId: "llc-full-bridge" }))).not.toBe(candidateKey(a));
  });
});
