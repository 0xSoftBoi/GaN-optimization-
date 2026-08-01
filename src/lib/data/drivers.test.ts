import { describe, expect, it } from "vitest";
import { GATE_DRIVERS, getDriver } from "./drivers";

const ALLOWED_SUPPLIERS = new Set(["Digi-Key", "Mouser", "Arrow", "Avnet"]);

describe("GATE_DRIVERS", () => {
  it("has at least 8 parts with unique ids", () => {
    expect(GATE_DRIVERS.length).toBeGreaterThanOrEqual(8);
    const ids = GATE_DRIVERS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the named reference drivers", () => {
    for (const id of ["UCC21520", "UCC27611", "Si8271GB-IS", "1EDN7550B", "ADuM4121", "STGAP2S"]) {
      expect(getDriver(id), id).toBeDefined();
    }
  });

  it("has plausible drive parameters", () => {
    for (const d of GATE_DRIVERS) {
      expect([1, 2]).toContain(d.channels);
      expect(d.peakSourceA, d.id).toBeGreaterThan(0.5);
      expect(d.peakSourceA, d.id).toBeLessThan(20);
      expect(d.peakSinkA, d.id).toBeGreaterThanOrEqual(d.peakSourceA); // pull-down at least as strong
      expect(d.propDelayNs, d.id).toBeGreaterThan(5);
      expect(d.propDelayNs, d.id).toBeLessThan(200);
      expect(d.priceUsd1k, d.id).toBeGreaterThan(0.3);
      expect(d.priceUsd1k, d.id).toBeLessThan(20);
      expect(d.suppliers.length, d.id).toBeGreaterThan(0);
      for (const s of d.suppliers) expect(ALLOWED_SUPPLIERS.has(s), `${d.id}: ${s}`).toBe(true);
    }
  });

  it("isolated drivers publish GaN/SiC-grade CMTI (>= 50 V/ns)", () => {
    const iso = GATE_DRIVERS.filter((d) => d.isolated);
    expect(iso.length).toBeGreaterThanOrEqual(4);
    for (const d of iso) expect(d.cmtiVPerNs, d.id).toBeGreaterThanOrEqual(50);
  });

  it("offers both isolated and non-isolated options, single and dual channel", () => {
    expect(GATE_DRIVERS.some((d) => !d.isolated)).toBe(true);
    expect(GATE_DRIVERS.some((d) => d.channels === 1)).toBe(true);
    expect(GATE_DRIVERS.some((d) => d.channels === 2)).toBe(true);
  });

  it("getDriver returns undefined for unknown ids", () => {
    expect(getDriver("XYZ999")).toBeUndefined();
  });
});
