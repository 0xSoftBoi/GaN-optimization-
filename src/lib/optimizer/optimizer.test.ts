import { describe, expect, it } from "vitest";
import type { DesignResult, DesignSpec } from "@/lib/types";
import { getSwitch } from "@/lib/data";
import { designConverter, optimize } from "./optimizer";

const BUCK_FAMILY = ["buck", "sync-buck", "interleaved-sync-buck"];

const buckSpec: DesignSpec = {
  name: "test 48-12 500W",
  conversion: "dc-dc",
  vinMinV: 43.2,
  vinNomV: 48,
  vinMaxV: 52.8,
  voutV: 12,
  poutW: 500,
  bidirectional: false,
  isolated: false,
  ambientC: 40,
  maxJunctionC: 125,
  cooling: "natural",
  rippleVoutPct: 1,
};

// designConverter is deterministic; evaluate each fixture once and share.
const lazy = <T>(f: () => T): (() => T) => {
  let v: T | undefined;
  return () => (v ??= f());
};
const buck = lazy(() => designConverter(buckSpec));
const buck2k = lazy(() => designConverter({ ...buckSpec, poutW: 2000, cooling: "forced-air" }));
const iso = lazy(() =>
  designConverter({
    ...buckSpec,
    name: "test 400-48 1kW isolated",
    vinMinV: 360,
    vinNomV: 400,
    vinMaxV: 440,
    voutV: 48,
    poutW: 1000,
    isolated: true,
    cooling: "forced-air",
  }),
);

describe("designConverter — winner sanity (48 V → 12 V buck)", () => {
  it("selects a non-isolated buck-family topology", () => {
    const r = buck();
    expect(BUCK_FAMILY).toContain(r.topology.id);
    expect(r.topology.isolated).toBe(false);
    expect(r.topologyRationale.length).toBeGreaterThan(0);
  });

  it("lands in a plausible efficiency window", () => {
    const r = buck();
    expect(r.efficiencyPct).toBeGreaterThan(90);
    expect(r.efficiencyPct).toBeLessThan(99.5);
  });

  it("solves thermally and picks a heatsink for natural convection", () => {
    const r = buck();
    expect(r.thermal.ok).toBe(true);
    expect(r.thermal.nodes.length).toBeGreaterThan(0);
    for (const n of r.thermal.nodes) expect(n.tjC).toBeLessThanOrEqual(n.limitC);
  });

  it("keeps ≥1.25× voltage margin on every winner switch", () => {
    const r = buck();
    for (const d of r.devices) {
      // Buck-family off-state voltage is the input maximum.
      expect(d.device.vdsMaxV).toBeGreaterThanOrEqual(1.25 * buckSpec.vinMaxV);
    }
  });

  it("produces a complete artifact set", () => {
    const r = buck();
    expect(r.schematic.svg).toContain("<svg");
    expect(r.schematic.spiceNetlist).toContain(".tran");
    expect(r.bom.length).toBeGreaterThan(3);
    expect(r.bomCostUsd).toBeGreaterThan(0);
    expect(r.layout.rules.length).toBeGreaterThan(0);
    expect(r.compliance.findings.length).toBeGreaterThan(0);
    expect(r.compensator).toBeDefined();
    expect(r.simulation).toBeDefined();
    expect(r.firmware?.target).toBe("STM32G474");
    expect(r.firmware?.files.length).toBeGreaterThanOrEqual(4);
  });

  it("BOM includes switches, magnetics, caps, driver and controller", () => {
    const r = buck();
    const text = r.bom.map((l) => `${l.partId} ${l.description}`).join(" ").toLowerCase();
    expect(r.bom.some((l) => l.ref.some((x) => x.startsWith("Q")))).toBe(true);
    expect(r.bom.some((l) => l.ref.some((x) => x.startsWith("L") || x.startsWith("T")))).toBe(true);
    expect(r.bom.some((l) => l.ref.some((x) => x.startsWith("C")))).toBe(true);
    expect(text).toMatch(/driver|controller/);
    // The BOM total is the detailed roll-up; it must be a sane figure.
    const sum = r.bom.reduce((s, l) => s + l.extPriceUsd, 0);
    expect(r.bomCostUsd).toBeCloseTo(sum, 1);
  });
});

describe("designConverter — candidate sweep", () => {
  it("explores a real candidate space with finite metrics", () => {
    const r = buck();
    expect(r.candidates.length).toBeGreaterThan(3);
    for (const c of r.candidates) {
      expect(Number.isFinite(c.efficiencyPct)).toBe(true);
      expect(c.efficiencyPct).toBeGreaterThan(0);
      expect(c.efficiencyPct).toBeLessThan(100);
      expect(c.bomCostUsd).toBeGreaterThan(0);
      expect(c.powerDensityWPerL).toBeGreaterThan(0);
      expect(c.fswHz).toBeGreaterThanOrEqual(100e3 * 0.99);
      expect(c.fswHz).toBeLessThanOrEqual(1e6 * 1.01);
    }
  });

  it("sweep devices respect the 1.25× voltage margin", () => {
    const r = buck();
    for (const c of r.candidates) {
      const d = getSwitch(c.deviceId);
      expect(d).toBeDefined();
      expect(d!.vdsMaxV).toBeGreaterThanOrEqual(1.25 * buckSpec.vinMaxV);
    }
  });

  it("marks a consistent Pareto front (eff ↑, cost ↓, density ↑)", () => {
    const r = buck();
    const dominates = (
      a: DesignResult["candidates"][number],
      b: DesignResult["candidates"][number],
    ) =>
      a.efficiencyPct >= b.efficiencyPct &&
      a.bomCostUsd <= b.bomCostUsd &&
      a.powerDensityWPerL >= b.powerDensityWPerL &&
      (a.efficiencyPct > b.efficiencyPct ||
        a.bomCostUsd < b.bomCostUsd ||
        a.powerDensityWPerL > b.powerDensityWPerL);
    expect(r.candidates.some((c) => c.pareto)).toBe(true);
    for (const c of r.candidates) {
      const dominated = r.candidates.some((o) => o !== c && dominates(o, c));
      expect(c.pareto).toBe(!dominated);
    }
  });

  it("winner appears in the candidate list as a feasible entry", () => {
    const r = buck();
    const hit = r.candidates.find(
      (c) => c.topologyId === r.topology.id && Math.abs(c.fswHz - r.fswHz) / r.fswHz < 0.01,
    );
    expect(hit).toBeDefined();
    expect(hit!.feasible).toBe(true);
  });
});

describe("designConverter — efficiency curve", () => {
  it("has the 5 standard load points with losses increasing in load", () => {
    const r = buck();
    expect(r.efficiencyCurve.map((p) => p.loadPct)).toEqual([10, 25, 50, 75, 100]);
    for (let i = 1; i < r.efficiencyCurve.length; i++) {
      expect(r.efficiencyCurve[i].lossW).toBeGreaterThan(r.efficiencyCurve[i - 1].lossW);
    }
  });

  it("peaks above 10 % load (fixed losses dominate at light load)", () => {
    const r = buck();
    const best = r.efficiencyCurve.reduce((a, b) => (b.efficiencyPct > a.efficiencyPct ? b : a));
    expect(best.loadPct).toBeGreaterThan(10);
    expect(r.efficiencyCurve[0].efficiencyPct).toBeLessThan(best.efficiencyPct);
  });

  it("full-load point matches the headline efficiency", () => {
    const r = buck();
    const p100 = r.efficiencyCurve.find((p) => p.loadPct === 100)!;
    expect(p100.efficiencyPct).toBeCloseTo(r.efficiencyPct, 2);
  });
});

describe("designConverter — trends and constraints", () => {
  it("more power costs more and dissipates more", () => {
    const a = buck();
    const b = buck2k();
    expect(b.losses.totalW).toBeGreaterThan(a.losses.totalW);
    expect(b.bomCostUsd).toBeGreaterThan(a.bomCostUsd);
  });

  it("honors a forced switching frequency by sweeping around it", () => {
    const r = designConverter({ ...buckSpec, fswHz: 300e3 });
    expect(r.fswHz).toBeGreaterThanOrEqual(300e3 / 1.5 - 1);
    expect(r.fswHz).toBeLessThanOrEqual(300e3 * 1.5 + 1);
    for (const c of r.candidates) {
      expect(c.fswHz).toBeGreaterThanOrEqual(300e3 / 1.5 - 1);
      expect(c.fswHz).toBeLessThanOrEqual(300e3 * 1.5 + 1);
    }
    // The exact requested frequency is one of the grid points.
    expect(r.candidates.some((c) => Math.abs(c.fswHz - 300e3) / 300e3 < 0.01)).toBe(true);
  });

  it("warns when cost ceiling and efficiency target are unreachable", () => {
    const r = designConverter({ ...buckSpec, costCeilingUsd: 1, targetEfficiencyPct: 99.9 });
    const text = r.warnings.join(" ");
    expect(text).toMatch(/ceiling|\$1/);
    expect(text).toMatch(/99\.9|target/);
  });

  it("an isolated spec yields an isolated winner with a transformer", () => {
    const r = iso();
    expect(r.topology.isolated).toBe(true);
    expect(r.magnetics.some((m) => m.role === "transformer")).toBe(true);
    expect(r.efficiencyPct).toBeGreaterThan(88);
    expect(r.efficiencyPct).toBeLessThan(99.9);
  });
});

describe("optimize()", () => {
  it("returns the winner plus the explored candidate set", () => {
    const { candidates, best } = optimize(buckSpec);
    expect(best.candidates).toBe(candidates);
    expect(candidates.length).toBeGreaterThan(3);
    expect(BUCK_FAMILY).toContain(best.topology.id);
  });
});
