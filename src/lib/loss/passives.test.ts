import { describe, it, expect } from "vitest";
import type { CoreMaterial, WireSpec, CapacitorPart } from "@/lib/types";
import {
  coreLossW,
  acResistanceFactor,
  capacitorLossW,
  skinDepthCuM,
} from "./passives";

// --- inline fixtures -------------------------------------------------------

/** 3C97-ish MnZn ferrite fit: Pv ≈ 100 kW/m³ at 100 kHz / 100 mT. */
const ferrite: CoreMaterial = {
  id: "TEST-3C97",
  mfr: "TestCo",
  steinmetzK: 3.16e-5,
  steinmetzAlpha: 1.8,
  steinmetzBeta: 2.5,
  bsatT: 0.41,
  muR: 2300,
  maxTempC: 140,
};

const awg16: WireSpec = {
  id: "AWG16",
  type: "solid",
  copperAreaMm2: 1.31, // d ≈ 1.29 mm
  rdcMohmPerM: 13.2,
};

const litz: WireSpec = {
  id: "litz-660x44",
  type: "litz",
  copperAreaMm2: 1.3, // ~same total copper as the AWG16 fixture
  strandCount: 660,
  strandDiaMm: 0.05, // AWG44 — sized for 350-850 kHz per litz design charts
  rdcMohmPerM: 13.8,
};

const x7rCap: CapacitorPart = {
  id: "TEST-X7R",
  mfr: "TestCo",
  dielectric: "X7R",
  capUf: 2.2,
  voltageV: 450,
  esrMohm: 8,
  iRmsA: 4,
  priceUsd1k: 0.35,
  suppliers: ["digikey"],
};

// --- Steinmetz core loss ---------------------------------------------------

describe("coreLossW (Steinmetz)", () => {
  it("matches the hand-computed types.ts convention exactly", () => {
    // Pv[kW/m³] = k·f^α·B^β = 3.16e-5 · (2e5)^1.8 · 0.1^2.5
    const f = 200e3;
    const b = 0.1;
    const ve = 5470; // PQ32/20-ish, mm³
    const pvKwM3 = 3.16e-5 * Math.pow(f, 1.8) * Math.pow(b, 2.5);
    expect(coreLossW(ferrite, ve, f, b)).toBeCloseTo(pvKwM3 * ve * 1e-6, 9);
  });

  it("gives datasheet-plausible Pv: ~100 kW/m³ at 100 kHz / 100 mT", () => {
    // Ve = 1e6 mm³ = 1e-3 m³, so P[W] = Pv[kW/m³]·1e3·1e-3 = Pv numerically.
    const pvKwM3 = coreLossW(ferrite, 1e6, 100e3, 0.1);
    expect(pvKwM3).toBeGreaterThan(60);
    expect(pvKwM3).toBeLessThan(160);
  });

  it("is monotonic in both frequency and flux density", () => {
    const ve = 5000;
    let prev = 0;
    for (const f of [50e3, 100e3, 200e3, 500e3]) {
      const p = coreLossW(ferrite, ve, f, 0.1);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
    prev = 0;
    for (const b of [0.05, 0.1, 0.15, 0.2]) {
      const p = coreLossW(ferrite, ve, 100e3, b);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it("beta > 2 makes halving B cut loss by more than 4x", () => {
    const p1 = coreLossW(ferrite, 5000, 100e3, 0.2);
    const p2 = coreLossW(ferrite, 5000, 100e3, 0.1);
    expect(p1 / p2).toBeGreaterThan(4);
    expect(p1 / p2).toBeCloseTo(Math.pow(2, 2.5), 6);
  });

  it("returns 0 for degenerate inputs", () => {
    expect(coreLossW(ferrite, 5000, 0, 0.1)).toBe(0);
    expect(coreLossW(ferrite, 5000, 100e3, 0)).toBe(0);
    expect(coreLossW(ferrite, 0, 100e3, 0.1)).toBe(0);
  });
});

// --- Dowell AC resistance --------------------------------------------------

describe("acResistanceFactor (Dowell)", () => {
  it("skin depth in hot copper is ~0.24 mm at 100 kHz", () => {
    expect(skinDepthCuM(100e3) * 1e3).toBeGreaterThan(0.2);
    expect(skinDepthCuM(100e3) * 1e3).toBeLessThan(0.28);
  });

  it("is always >= 1 and grows monotonically with frequency", () => {
    let prev = 1;
    for (const f of [1e3, 10e3, 50e3, 100e3, 300e3, 1e6]) {
      const fr = acResistanceFactor(f, awg16, 3);
      expect(fr).toBeGreaterThanOrEqual(1);
      expect(fr).toBeGreaterThanOrEqual(prev);
      prev = fr;
    }
  });

  it("approaches 1 at low frequency (DC limit)", () => {
    expect(acResistanceFactor(10, awg16, 1)).toBeCloseTo(1, 3);
  });

  it("more layers means more proximity loss", () => {
    const f = 250e3;
    const fr1 = acResistanceFactor(f, awg16, 1);
    const fr4 = acResistanceFactor(f, awg16, 4);
    expect(fr4).toBeGreaterThan(fr1);
  });

  it("fine-strand litz beats solid wire of equal copper area at HF", () => {
    const f = 500e3;
    const frSolid = acResistanceFactor(f, awg16, 3);
    const frLitz = acResistanceFactor(f, litz, 3);
    expect(frLitz).toBeGreaterThanOrEqual(1);
    // Dowell with m·√N effective layers is conservative for litz, but the
    // ordering and a big margin must hold.
    expect(frLitz).toBeLessThan(0.5 * frSolid);
  });

  it("single-layer AWG16 at 100 kHz lands in the classic 2-6x band", () => {
    // d/δ ≈ 1.29/0.237 ≈ 5.4 → strong skin effect even with one layer
    const fr = acResistanceFactor(100e3, awg16, 1);
    expect(fr).toBeGreaterThan(2);
    expect(fr).toBeLessThan(7);
  });
});

// --- capacitor ESR loss ----------------------------------------------------

describe("capacitorLossW", () => {
  it("computes Irms²·ESR", () => {
    expect(capacitorLossW(x7rCap, 3)).toBeCloseTo(9 * 8e-3, 12); // 72 mW
    expect(capacitorLossW(x7rCap, 0)).toBe(0);
  });

  it("is quadratic in ripple current", () => {
    const p1 = capacitorLossW(x7rCap, 2);
    const p2 = capacitorLossW(x7rCap, 4);
    expect(p2 / p1).toBeCloseTo(4, 9);
  });
});
