import { describe, expect, it } from "vitest";
import type { BomLine, Schematic } from "@/lib/types";
import { buildBom } from "./build";
import { buildSchematic } from "@/lib/schematic/build";
import { GAN100, mkDl, mkMag, mkParts, SPEC_BUCK } from "@/lib/schematic/testFixtures";

const sch = buildSchematic("sync-buck", SPEC_BUCK, mkParts([mkDl(GAN100, "hb", 2, 2)], [mkMag("output-inductor", 3.3, 8)]));

describe("buildBom", () => {
  it("groups identical partIds and rolls up qty and extended price", () => {
    const { lines } = buildBom(sch);
    const q = lines.find((l) => l.partId === GAN100.id);
    expect(q).toBeDefined();
    expect(q!.qty).toBe(4); // 2 positions x 2 parallel
    expect(q!.ref).toHaveLength(4);
    expect(q!.unitPriceUsd).toBeCloseTo(GAN100.priceUsd1k, 2);
    expect(q!.extPriceUsd).toBeCloseTo(4 * GAN100.priceUsd1k, 2);
    expect(q!.mfr).toBe("EPC");
    expect(q!.suppliers).toContain("Digi-Key");
  });

  it("groups the capacitor banks by part number", () => {
    const { lines } = buildBom(sch);
    const ceramic = lines.find((l) => l.partId === "C3216X7R2A105K");
    const bulk = lines.find((l) => l.partId === "EEH-ZC1H101P");
    expect(ceramic?.qty).toBe(4);
    expect(bulk?.qty).toBe(3);
  });

  it("total equals the sum of line extended prices and lines cover all components", () => {
    const { lines, totalUsd } = buildBom(sch);
    expect(totalUsd).toBeCloseTo(
      lines.reduce((s, l) => s + l.extPriceUsd, 0),
      6,
    );
    expect(lines.reduce((s, l) => s + l.qty, 0)).toBe(sch.components.length);
    for (const l of lines) {
      expect(l.extPriceUsd).toBeCloseTo(l.qty * l.unitPriceUsd, 2);
      expect(l.unitPriceUsd).toBeGreaterThan(0);
    }
  });

  it("sorts lines in ref order (switches first)", () => {
    const { lines } = buildBom(sch);
    expect(lines[0].ref[0].startsWith("Q")).toBe(true);
  });

  it("appends extra lines and merges extras with matching partIds", () => {
    const extras: BomLine[] = [
      {
        ref: ["RT1"],
        partId: "NTC-10K",
        mfr: "Murata",
        description: "inrush NTC",
        qty: 1,
        unitPriceUsd: 0.4,
        extPriceUsd: 0.4,
        suppliers: ["Digi-Key"],
      },
      {
        ref: ["Q9", "Q10"],
        partId: GAN100.id,
        mfr: GAN100.mfr,
        description: "spare positions",
        qty: 2,
        unitPriceUsd: GAN100.priceUsd1k,
        extPriceUsd: 2 * GAN100.priceUsd1k,
        suppliers: [],
      },
    ];
    const base = buildBom(sch);
    const { lines, totalUsd } = buildBom(sch, extras);
    expect(lines.find((l) => l.partId === "NTC-10K")).toBeDefined();
    const q = lines.find((l) => l.partId === GAN100.id)!;
    expect(q.qty).toBe(6);
    expect(q.extPriceUsd).toBeCloseTo(6 * GAN100.priceUsd1k, 2);
    expect(totalUsd).toBeCloseTo(base.totalUsd + 0.4 + 2 * GAN100.priceUsd1k, 2);
  });

  it("prices bare NetlistComponents (no meta) from the per-kind fallback table", () => {
    const bare: Schematic = {
      nets: ["A", "B"],
      components: [
        { ref: "C9", kind: "capacitor", value: "1 µF", pins: { "1": "A", "2": "B" } },
        { ref: "C10", kind: "capacitor", value: "1 µF", pins: { "1": "A", "2": "B" } },
      ],
      svg: "",
      spiceNetlist: "",
    };
    const { lines, totalUsd } = buildBom(bare);
    expect(lines).toHaveLength(1); // grouped by kind+value
    expect(lines[0].qty).toBe(2);
    expect(lines[0].unitPriceUsd).toBeGreaterThan(0);
    expect(totalUsd).toBeCloseTo(lines[0].extPriceUsd, 6);
  });
});
