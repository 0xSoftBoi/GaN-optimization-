import { describe, expect, it } from "vitest";
import { CORES, CORE_MATERIALS, WIRES, findCoreMaterial } from "./magnetics";

const pv = (m: (typeof CORE_MATERIALS)[number], fHz: number, bT: number) =>
  m.steinmetzK * Math.pow(fHz, m.steinmetzAlpha) * Math.pow(bT, m.steinmetzBeta);

describe("CORE_MATERIALS", () => {
  it("contains at least 6 materials including the named grades", () => {
    expect(CORE_MATERIALS.length).toBeGreaterThanOrEqual(6);
    for (const id of ["N87", "N97", "N49", "3C95", "3F36", "ML91S"]) {
      expect(findCoreMaterial(id), id).toBeDefined();
    }
  });

  it("has Steinmetz/physical parameters in ferrite-typical ranges", () => {
    for (const m of CORE_MATERIALS) {
      expect(m.steinmetzAlpha, m.id).toBeGreaterThanOrEqual(1.3);
      expect(m.steinmetzAlpha, m.id).toBeLessThanOrEqual(1.7);
      expect(m.steinmetzBeta, m.id).toBeGreaterThanOrEqual(2.4);
      expect(m.steinmetzBeta, m.id).toBeLessThanOrEqual(3.0);
      expect(m.bsatT, m.id).toBeGreaterThan(0.3);
      expect(m.bsatT, m.id).toBeLessThan(0.6);
      expect(m.muR, m.id).toBeGreaterThan(1000);
      expect(m.muR, m.id).toBeLessThan(4000);
      expect(m.maxTempC, m.id).toBeGreaterThanOrEqual(100);
    }
  });

  it("predicts plausible loss density at 100 kHz / 100 mT (roughly 3–150 kW/m³)", () => {
    for (const m of CORE_MATERIALS) {
      const p = pv(m, 100e3, 0.1);
      expect(p, m.id).toBeGreaterThan(3);
      expect(p, m.id).toBeLessThan(150);
    }
  });

  it("loss density increases monotonically with f and B", () => {
    for (const m of CORE_MATERIALS) {
      expect(pv(m, 300e3, 0.1)).toBeGreaterThan(pv(m, 100e3, 0.1));
      expect(pv(m, 100e3, 0.2)).toBeGreaterThan(pv(m, 100e3, 0.1));
    }
  });
});

describe("CORES", () => {
  it("has at least 14 cores spanning PQ20 to PQ50 and E25 to E65 plus toroids", () => {
    expect(CORES.length).toBeGreaterThanOrEqual(14);
    const ids = CORES.map((c) => c.id).join(" ");
    for (const frag of ["PQ20", "PQ50", "E25", "E65"]) {
      expect(ids).toContain(frag);
    }
    // a few toroids (TN/TX/R shapes)
    const toroids = CORES.filter((c) => /^(TN|TX|R)\d/.test(c.id));
    expect(toroids.length).toBeGreaterThanOrEqual(2);
  });

  it("has self-consistent geometry (Ve ≈ Ae·le) and positive fields", () => {
    for (const c of CORES) {
      const veCalc = c.aeMm2 * c.leMm;
      expect(c.veMm3, c.id).toBeGreaterThan(veCalc * 0.85);
      expect(c.veMm3, c.id).toBeLessThan(veCalc * 1.15);
      expect(c.awMm2, c.id).toBeGreaterThan(0);
      expect(c.mltMm, c.id).toBeGreaterThan(0);
      expect(c.priceUsd, c.id).toBeGreaterThan(0);
    }
  });

  it("references only known materials", () => {
    for (const c of CORES) {
      expect(findCoreMaterial(c.materialId), `${c.id} -> ${c.materialId}`).toBeDefined();
    }
  });

  it("prices scale up with size (largest core costs more than smallest)", () => {
    const sorted = [...CORES].sort((a, b) => a.veMm3 - b.veMm3);
    expect(sorted[sorted.length - 1].priceUsd).toBeGreaterThan(sorted[0].priceUsd);
  });
});

describe("WIRES", () => {
  it("has solid AWG10–AWG30 plus at least 5 litz builds", () => {
    const solid = WIRES.filter((w) => w.type === "solid");
    const litz = WIRES.filter((w) => w.type === "litz");
    expect(solid.length).toBeGreaterThanOrEqual(10);
    expect(litz.length).toBeGreaterThanOrEqual(5);
    expect(WIRES.some((w) => w.id === "AWG10")).toBe(true);
    expect(WIRES.some((w) => w.id === "AWG30")).toBe(true);
    for (const w of litz) {
      expect(w.strandCount, w.id).toBeGreaterThan(1);
      expect(w.strandDiaMm, w.id).toBeGreaterThan(0);
      // strand copper adds up to the bundle copper area (±15 %)
      const strandArea = Math.PI * ((w.strandDiaMm ?? 0) / 2) ** 2;
      const total = (w.strandCount ?? 0) * strandArea;
      expect(total, w.id).toBeGreaterThan(w.copperAreaMm2 * 0.85);
      expect(total, w.id).toBeLessThan(w.copperAreaMm2 * 1.15);
    }
  });

  it("has DC resistance consistent with copper resistivity (17.24 mΩ·mm²/m ±20 %)", () => {
    for (const w of WIRES) {
      const expected = 17.24 / w.copperAreaMm2;
      expect(w.rdcMohmPerM, w.id).toBeGreaterThan(expected * 0.85);
      expect(w.rdcMohmPerM, w.id).toBeLessThan(expected * 1.2);
    }
  });

  it("solid-wire resistance rises as the gauge number rises", () => {
    const solid = WIRES.filter((w) => w.type === "solid").sort(
      (a, b) => Number(a.id.replace("AWG", "")) - Number(b.id.replace("AWG", ""))
    );
    for (let i = 1; i < solid.length; i++) {
      expect(solid[i].rdcMohmPerM).toBeGreaterThan(solid[i - 1].rdcMohmPerM);
    }
  });
});
