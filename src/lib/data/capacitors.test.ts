import { describe, expect, it } from "vitest";
import { CAPACITORS, getCapacitor } from "./capacitors";

const ALLOWED_SUPPLIERS = new Set(["Digi-Key", "Mouser", "Arrow", "Avnet"]);

describe("CAPACITORS", () => {
  it("has at least 12 parts with unique ids", () => {
    expect(CAPACITORS.length).toBeGreaterThanOrEqual(12);
    const ids = CAPACITORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all five dielectric families", () => {
    const ds = new Set(CAPACITORS.map((c) => c.dielectric));
    for (const d of ["C0G", "X7R", "film", "electrolytic", "polymer"]) {
      expect(ds.has(d as never), d).toBe(true);
    }
  });

  it("has positive, plausible ratings", () => {
    for (const c of CAPACITORS) {
      expect(c.capUf, c.id).toBeGreaterThan(0);
      expect(c.voltageV, c.id).toBeGreaterThanOrEqual(16);
      expect(c.voltageV, c.id).toBeLessThanOrEqual(1000);
      expect(c.esrMohm, c.id).toBeGreaterThan(0);
      expect(c.esrMohm, c.id).toBeLessThan(2000);
      expect(c.iRmsA, c.id).toBeGreaterThan(0);
      expect(c.iRmsA, c.id).toBeLessThan(50);
      expect(c.priceUsd1k, c.id).toBeGreaterThan(0.05);
      expect(c.priceUsd1k, c.id).toBeLessThan(20);
      expect(c.suppliers.length, c.id).toBeGreaterThan(0);
      for (const s of c.suppliers) expect(ALLOWED_SUPPLIERS.has(s), `${c.id}: ${s}`).toBe(true);
    }
  });

  it("ESR ordering by family: MLCC/film << polymer < electrolytic", () => {
    const maxEsr = (d: string) =>
      Math.max(...CAPACITORS.filter((c) => c.dielectric === d).map((c) => c.esrMohm));
    const minEsr = (d: string) =>
      Math.min(...CAPACITORS.filter((c) => c.dielectric === d).map((c) => c.esrMohm));
    expect(maxEsr("C0G")).toBeLessThan(minEsr("electrolytic"));
    expect(maxEsr("X7R")).toBeLessThan(minEsr("electrolytic"));
    expect(maxEsr("film")).toBeLessThan(minEsr("electrolytic"));
    expect(minEsr("polymer")).toBeLessThan(minEsr("electrolytic"));
  });

  it("MLCC ESR is in the single-digit mΩ range", () => {
    for (const c of CAPACITORS.filter((x) => x.dielectric === "C0G" || x.dielectric === "X7R")) {
      expect(c.esrMohm, c.id).toBeLessThanOrEqual(10);
    }
  });

  it("ripple rating is thermally consistent with ESR (I²·ESR < ~2.5 W)", () => {
    for (const c of CAPACITORS) {
      const pW = c.iRmsA ** 2 * (c.esrMohm / 1000);
      expect(pW, c.id).toBeLessThan(2.5);
    }
  });

  it("film caps carry the big ripple currents", () => {
    const film = CAPACITORS.filter((c) => c.dielectric === "film");
    expect(Math.max(...film.map((c) => c.iRmsA))).toBeGreaterThanOrEqual(10);
  });

  it("getCapacitor finds by id and returns undefined otherwise", () => {
    expect(getCapacitor("GRM32ER72A106KA35")?.mfr).toBe("Murata");
    expect(getCapacitor("NOPE")).toBeUndefined();
  });
});
