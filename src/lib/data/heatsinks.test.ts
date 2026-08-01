import { describe, expect, it } from "vitest";
import { HEATSINKS, getHeatsink } from "./heatsinks";

describe("HEATSINKS", () => {
  it("has at least 8 parts with unique ids", () => {
    expect(HEATSINKS.length).toBeGreaterThanOrEqual(8);
    const ids = HEATSINKS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has plausible geometry and pricing", () => {
    for (const h of HEATSINKS) {
      expect(h.heightMm, h.id).toBeGreaterThanOrEqual(5);
      expect(h.heightMm, h.id).toBeLessThanOrEqual(100);
      expect(h.footprintMm[0], h.id).toBeGreaterThan(0);
      expect(h.footprintMm[1], h.id).toBeGreaterThan(0);
      expect(h.priceUsd, h.id).toBeGreaterThan(0.1);
      expect(h.priceUsd, h.id).toBeLessThan(60);
    }
  });

  it("natural-convection Rth spans clip-on (~25) to big extrusion (<2 °C/W)", () => {
    const naturals = HEATSINKS.map((h) => h.rthSaCPerWNatural);
    for (const r of naturals) {
      expect(r).toBeGreaterThan(0.3);
      expect(r).toBeLessThan(30);
    }
    expect(Math.max(...naturals)).toBeGreaterThan(15); // small clip-on present
    expect(Math.min(...naturals)).toBeLessThan(2); // 150 mm extrusion present
  });

  it("forced-air Rth is always lower than natural", () => {
    for (const h of HEATSINKS) {
      if (h.rthSaCPerWForced !== undefined) {
        expect(h.rthSaCPerWForced, h.id).toBeGreaterThan(0.1);
        expect(h.rthSaCPerWForced, h.id).toBeLessThan(h.rthSaCPerWNatural);
        // 400 LFM typically buys 1.5-6x improvement
        const gain = h.rthSaCPerWNatural / h.rthSaCPerWForced;
        expect(gain, h.id).toBeGreaterThan(1.3);
        expect(gain, h.id).toBeLessThan(8);
      }
    }
  });

  it("more surface area buys lower natural Rth (largest vs smallest)", () => {
    const area = (h: (typeof HEATSINKS)[number]) => h.footprintMm[0] * h.footprintMm[1];
    const largest = HEATSINKS.reduce((a, b) => (area(a) >= area(b) ? a : b));
    const smallest = HEATSINKS.reduce((a, b) => (area(a) <= area(b) ? a : b));
    expect(largest.rthSaCPerWNatural).toBeLessThan(smallest.rthSaCPerWNatural);
  });

  it("price generally rises as natural Rth falls (best vs worst)", () => {
    const best = HEATSINKS.reduce((a, b) =>
      a.rthSaCPerWNatural <= b.rthSaCPerWNatural ? a : b,
    );
    const worst = HEATSINKS.reduce((a, b) =>
      a.rthSaCPerWNatural >= b.rthSaCPerWNatural ? a : b,
    );
    expect(best.priceUsd).toBeGreaterThan(worst.priceUsd);
  });

  it("getHeatsink finds by id and returns undefined otherwise", () => {
    expect(getHeatsink("OS515-150")?.mfr).toContain("Boyd");
    expect(getHeatsink("NOPE")).toBeUndefined();
  });
});
