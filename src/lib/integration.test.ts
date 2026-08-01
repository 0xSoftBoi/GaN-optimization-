/**
 * VoltForge end-to-end integration: natural-language prompt → parsed spec →
 * full converter design. Exercises every engine module through the optimizer
 * composition root.
 */
import { describe, expect, it } from "vitest";
import { parsePrompt } from "@/lib/copilot";
import { designConverter } from "@/lib/optimizer";
import type { DesignResult } from "@/lib/types";

const lazy = <T>(f: () => T): (() => T) => {
  let v: T | undefined;
  return () => (v ??= f());
};

/** Structural checks every complete design must satisfy. */
function expectCompleteDesign(r: DesignResult): void {
  expect(r.bom.length).toBeGreaterThan(0);
  expect(r.bomCostUsd).toBeGreaterThan(0);
  expect(r.schematic.svg).toContain("svg");
  expect(r.schematic.spiceNetlist).toContain(".tran");
  expect(r.schematic.components.length).toBeGreaterThan(0);
  expect(r.compliance.findings.length).toBeGreaterThan(0);
  expect(r.layout.rules.length).toBeGreaterThan(0);
  expect(r.efficiencyCurve).toHaveLength(5);
  expect(r.candidates.length).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// 1. 5 kW bidirectional 800 V → 48 V (the DAB flagship path)
// ---------------------------------------------------------------------------

const dab = lazy(() =>
  designConverter(
    parsePrompt(
      "Design a 5kW bidirectional converter, 800V bus to 48V rack, forced air, 40C ambient",
    ).spec,
  ),
);

describe("e2e: 5 kW bidirectional 800 V → 48 V", () => {
  it("parses to an isolated bidirectional dc-dc spec", () => {
    const p = parsePrompt(
      "Design a 5kW bidirectional converter, 800V bus to 48V rack, forced air, 40C ambient",
    );
    expect(p.spec.poutW).toBe(5000);
    expect(p.spec.vinNomV).toBe(800);
    expect(p.spec.voutV).toBe(48);
    expect(p.spec.bidirectional).toBe(true);
    expect(p.spec.cooling).toBe("forced-air");
    expect(p.spec.ambientC).toBe(40);
  });

  it("selects the DAB (isolated + bidirectional-capable)", () => {
    const r = dab();
    expect(r.topology.id).toBe("dab");
    expect(r.topology.isolated).toBe(true);
    expect(r.topology.bidirectional).toBe(true);
  });

  it("hits a datasheet-plausible efficiency", () => {
    const r = dab();
    expect(r.efficiencyPct).toBeGreaterThan(90);
    expect(r.efficiencyPct).toBeLessThan(99.9);
  });

  it("produces a priced BOM and a passing thermal solution", () => {
    const r = dab();
    expect(r.bom.length).toBeGreaterThan(0);
    expect(r.bomCostUsd).toBeGreaterThan(0);
    expect(r.thermal.ok).toBe(true);
  });

  it("emits schematic SVG and a SPICE netlist with a .tran card", () => {
    const r = dab();
    expect(r.schematic.svg).toContain("svg");
    expect(r.schematic.spiceNetlist).toContain(".tran");
  });

  it("ships firmware with at least 4 source files", () => {
    const r = dab();
    expect(r.firmware).toBeDefined();
    expect(r.firmware!.files.length).toBeGreaterThanOrEqual(4);
    expect(r.firmware!.files.some((f) => f.path.endsWith(".c"))).toBe(true);
  });

  it("runs compliance and explores a real candidate space", () => {
    const r = dab();
    expect(r.compliance.findings.length).toBeGreaterThan(0);
    expect(r.candidates.length).toBeGreaterThan(3);
  });

  it("efficiency curve has 5 points and does not peak at 10 % load", () => {
    const r = dab();
    expect(r.efficiencyCurve.map((p) => p.loadPct)).toEqual([10, 25, 50, 75, 100]);
    const best = r.efficiencyCurve.reduce((a, b) =>
      b.efficiencyPct > a.efficiencyPct ? b : a,
    );
    expect(best.loadPct).not.toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 2. 600 W 48 V → 12 V sync buck, natural convection
// ---------------------------------------------------------------------------

describe("e2e: 600 W 48 V → 12 V sync buck", () => {
  const buck = lazy(() =>
    designConverter(parsePrompt("48V to 12V 600W sync buck, natural convection").spec),
  );

  it("selects a non-isolated buck-family winner", () => {
    const r = buck();
    expect(["buck", "sync-buck", "interleaved-sync-buck"]).toContain(r.topology.id);
    expect(r.topology.isolated).toBe(false);
    expect(r.spec.cooling).toBe("natural");
  });

  it("completes the full design chain plausibly", () => {
    const r = buck();
    expectCompleteDesign(r);
    expect(r.efficiencyPct).toBeGreaterThan(93);
    expect(r.efficiencyPct).toBeLessThan(99.5);
    expect(r.thermal.ok).toBe(true);
    expect(r.magnetics.some((m) => m.role === "output-inductor")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. 3 kW totem-pole PFC from 230 Vac (the ac-dc path)
// ---------------------------------------------------------------------------

describe("e2e: 3 kW totem-pole PFC from 230 Vac", () => {
  const pfc = lazy(() => designConverter(parsePrompt("3kW totem-pole PFC from 230Vac").spec));

  it("routes an ac-dc spec to the totem-pole PFC", () => {
    const r = pfc();
    expect(r.spec.conversion).toBe("ac-dc");
    expect(r.spec.gridVacRms).toBe(230);
    expect(r.topology.id).toBe("totem-pole-pfc");
  });

  it("boosts to a DC link that clears the line peak", () => {
    const r = pfc();
    expect(r.spec.voutV).toBeGreaterThan(230 * Math.SQRT2);
    expect(r.magnetics.some((m) => m.role === "pfc-inductor")).toBe(true);
  });

  it("completes the full design chain plausibly", () => {
    const r = pfc();
    expectCompleteDesign(r);
    expect(r.efficiencyPct).toBeGreaterThan(94);
    expect(r.efficiencyPct).toBeLessThan(99.9);
    expect(r.thermal.ok).toBe(true);
  });

  it("explains the PFC/isolation architecture hand-off in warnings", () => {
    const r = pfc();
    // parsePrompt defaults mains designs to isolated; the PFC front end is
    // inherently non-isolated, so the optimizer documents the two-stage split.
    expect(r.warnings.join(" ")).toMatch(/isolat/i);
  });
});
