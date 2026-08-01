/**
 * VoltForge magnetics data: ferrite core materials, core shapes, wire table.
 *
 * Values are typical datasheet figures (TDK, Ferroxcube, Proterial/Hitachi
 * Metals catalogs). Steinmetz coefficients follow the shared convention
 * (types.ts): Pv[kW/m³] = k · f[Hz]^alpha · B[T]^beta, fitted to the 100 °C
 * loss curves over 100–500 kHz (B is the AC flux-density amplitude).
 * bsatT is the ~100 °C saturation figure (design-relevant, not the 25 °C one).
 */

import type { CoreMaterial, CoreShape, WireSpec } from "@/lib/types";

// ---------------------------------------------------------------------------
// Core materials
// ---------------------------------------------------------------------------

export const CORE_MATERIALS: CoreMaterial[] = [
  // TDK N87 — workhorse 25–150 kHz power ferrite. ~375 kW/m³ @100 kHz/200 mT/100 °C.
  {
    id: "N87",
    mfr: "TDK",
    steinmetzK: 2.6e-3,
    steinmetzAlpha: 1.43,
    steinmetzBeta: 2.85,
    bsatT: 0.39,
    muR: 2200,
    maxTempC: 120,
  },
  // TDK N97 — improved N87, lower loss around 100 °C. ~320 kW/m³ @100 kHz/200 mT.
  {
    id: "N97",
    mfr: "TDK",
    steinmetzK: 1.9e-3,
    steinmetzAlpha: 1.45,
    steinmetzBeta: 2.9,
    bsatT: 0.41,
    muR: 2300,
    maxTempC: 120,
  },
  // TDK N49 — 300 kHz–1 MHz material. ~80 kW/m³ @500 kHz/50 mT/100 °C.
  {
    id: "N49",
    mfr: "TDK",
    steinmetzK: 3.8e-4,
    steinmetzAlpha: 1.55,
    steinmetzBeta: 2.7,
    bsatT: 0.41,
    muR: 1500,
    maxTempC: 120,
  },
  // Ferroxcube 3C95 — low loss, flat loss-vs-temperature, 25–500 kHz.
  {
    id: "3C95",
    mfr: "Ferroxcube",
    steinmetzK: 1.36e-3,
    steinmetzAlpha: 1.45,
    steinmetzBeta: 2.75,
    bsatT: 0.41,
    muR: 3000,
    maxTempC: 120,
  },
  // Ferroxcube 3F36 — 500 kHz–1 MHz resonant-converter material.
  {
    id: "3F36",
    mfr: "Ferroxcube",
    steinmetzK: 7.6e-5,
    steinmetzAlpha: 1.6,
    steinmetzBeta: 2.6,
    bsatT: 0.42,
    muR: 1600,
    maxTempC: 120,
  },
  // Proterial (Hitachi Metals) ML91S — premium low-loss HF ferrite,
  // ~50 kW/m³ @300 kHz/100 mT/100 °C.
  {
    id: "ML91S",
    mfr: "Proterial",
    steinmetzK: 3.6e-5,
    steinmetzAlpha: 1.65,
    steinmetzBeta: 2.9,
    bsatT: 0.44,
    muR: 3200,
    maxTempC: 120,
  },
];

export function findCoreMaterial(id: string): CoreMaterial | undefined {
  return CORE_MATERIALS.find((m) => m.id === id);
}

// ---------------------------------------------------------------------------
// Core shapes
// ---------------------------------------------------------------------------
// aeMm2/awMm2/veMm3/leMm from catalog effective-parameter tables; mltMm is the
// bobbin mean-length-per-turn; priceUsd is a realistic 1k-volume core-set price.
// Where one mechanical shape ships in several materials, the id carries the
// material suffix.

export const CORES: CoreShape[] = [
  // --- PQ family (TDK / Proterial) ---
  { id: "PQ20/16-N49", mfr: "TDK", materialId: "N49", aeMm2: 62, awMm2: 30, veMm3: 2330, leMm: 37.6, mltMm: 44, priceUsd: 0.55 },
  { id: "PQ20/20-N97", mfr: "TDK", materialId: "N97", aeMm2: 62, awMm2: 36, veMm3: 2850, leMm: 45.7, mltMm: 46, priceUsd: 0.6 },
  { id: "PQ26/25-N97", mfr: "TDK", materialId: "N97", aeMm2: 118, awMm2: 47, veMm3: 6530, leMm: 54.3, mltMm: 56, priceUsd: 0.85 },
  { id: "PQ26/25-ML91S", mfr: "Proterial", materialId: "ML91S", aeMm2: 118, awMm2: 47, veMm3: 6530, leMm: 54.3, mltMm: 56, priceUsd: 1.6 },
  { id: "PQ32/20-N49", mfr: "TDK", materialId: "N49", aeMm2: 169, awMm2: 46, veMm3: 9440, leMm: 55.9, mltMm: 67, priceUsd: 1.2 },
  { id: "PQ32/30-N97", mfr: "TDK", materialId: "N97", aeMm2: 167, awMm2: 68, veMm3: 12500, leMm: 74.7, mltMm: 67, priceUsd: 1.45 },
  { id: "PQ35/35-3C95", mfr: "Ferroxcube", materialId: "3C95", aeMm2: 190, awMm2: 88, veMm3: 16300, leMm: 86.1, mltMm: 75, priceUsd: 1.9 },
  { id: "PQ35/35-ML91S", mfr: "Proterial", materialId: "ML91S", aeMm2: 190, awMm2: 88, veMm3: 16300, leMm: 86.1, mltMm: 75, priceUsd: 3.2 },
  { id: "PQ40/40-N97", mfr: "TDK", materialId: "N97", aeMm2: 201, awMm2: 117, veMm3: 20500, leMm: 102, mltMm: 84, priceUsd: 2.6 },
  { id: "PQ50/50-3C95", mfr: "Ferroxcube", materialId: "3C95", aeMm2: 328, awMm2: 139, veMm3: 37100, leMm: 113, mltMm: 104, priceUsd: 4.5 },
  { id: "PQ50/50-3F36", mfr: "Ferroxcube", materialId: "3F36", aeMm2: 328, awMm2: 139, veMm3: 37100, leMm: 113, mltMm: 104, priceUsd: 5.2 },
  // --- E family ---
  { id: "E25/13/7-N87", mfr: "TDK", materialId: "N87", aeMm2: 52.5, awMm2: 56, veMm3: 3020, leMm: 57.5, mltMm: 49, priceUsd: 0.4 },
  { id: "E32/16/9-3C95", mfr: "Ferroxcube", materialId: "3C95", aeMm2: 83, awMm2: 95, veMm3: 6180, leMm: 74.2, mltMm: 60, priceUsd: 0.6 },
  { id: "E42/21/15-N87", mfr: "TDK", materialId: "N87", aeMm2: 178, awMm2: 178, veMm3: 17300, leMm: 97.2, mltMm: 77, priceUsd: 1.3 },
  { id: "E42/21/20-N87", mfr: "TDK", materialId: "N87", aeMm2: 233, awMm2: 178, veMm3: 22700, leMm: 97.2, mltMm: 84, priceUsd: 1.55 },
  { id: "E55/28/21-3C95", mfr: "Ferroxcube", materialId: "3C95", aeMm2: 353, awMm2: 250, veMm3: 43500, leMm: 123, mltMm: 116, priceUsd: 2.8 },
  { id: "E65/32/27-N87", mfr: "TDK", materialId: "N87", aeMm2: 535, awMm2: 394, veMm3: 78650, leMm: 147, mltMm: 150, priceUsd: 4.9 },
  // --- Toroids (awMm2 = usable ~70 % of the inner-diameter circle) ---
  { id: "TN25/15/10-3C95", mfr: "Ferroxcube", materialId: "3C95", aeMm2: 51, awMm2: 120, veMm3: 3070, leMm: 60.2, mltMm: 42, priceUsd: 0.5 },
  { id: "R34/21/13-N87", mfr: "TDK", materialId: "N87", aeMm2: 84, awMm2: 230, veMm3: 7000, leMm: 83, mltMm: 55, priceUsd: 0.85 },
  { id: "TX63/38/25-3C95", mfr: "Ferroxcube", materialId: "3C95", aeMm2: 312, awMm2: 790, veMm3: 47400, leMm: 152, mltMm: 105, priceUsd: 3.5 },
];

// ---------------------------------------------------------------------------
// Wires
// ---------------------------------------------------------------------------
// Solid: standard AWG copper table (area, mΩ/m at 20 °C). Litz: served bundles
// of AWG38/40/44 strands; rdc = 17.24 mΩ·mm²/m ÷ copper area, +3 % lay factor.

export const WIRES: WireSpec[] = [
  // Solid magnet wire, AWG10–AWG30 (even sizes)
  { id: "AWG10", type: "solid", copperAreaMm2: 5.261, rdcMohmPerM: 3.277 },
  { id: "AWG12", type: "solid", copperAreaMm2: 3.309, rdcMohmPerM: 5.211 },
  { id: "AWG14", type: "solid", copperAreaMm2: 2.081, rdcMohmPerM: 8.286 },
  { id: "AWG16", type: "solid", copperAreaMm2: 1.309, rdcMohmPerM: 13.17 },
  { id: "AWG18", type: "solid", copperAreaMm2: 0.8231, rdcMohmPerM: 20.95 },
  { id: "AWG20", type: "solid", copperAreaMm2: 0.5176, rdcMohmPerM: 33.31 },
  { id: "AWG22", type: "solid", copperAreaMm2: 0.3255, rdcMohmPerM: 52.96 },
  { id: "AWG24", type: "solid", copperAreaMm2: 0.2047, rdcMohmPerM: 84.22 },
  { id: "AWG26", type: "solid", copperAreaMm2: 0.1288, rdcMohmPerM: 133.9 },
  { id: "AWG28", type: "solid", copperAreaMm2: 0.081, rdcMohmPerM: 212.9 },
  { id: "AWG30", type: "solid", copperAreaMm2: 0.0509, rdcMohmPerM: 338.6 },
  // Litz — strand count × strand AWG (38: 0.101 mm, 40: 0.080 mm, 44: 0.051 mm)
  { id: "litz-60x38", type: "litz", copperAreaMm2: 0.481, strandCount: 60, strandDiaMm: 0.101, rdcMohmPerM: 36.9 },
  { id: "litz-120x38", type: "litz", copperAreaMm2: 0.961, strandCount: 120, strandDiaMm: 0.101, rdcMohmPerM: 18.5 },
  { id: "litz-270x38", type: "litz", copperAreaMm2: 2.163, strandCount: 270, strandDiaMm: 0.101, rdcMohmPerM: 8.21 },
  { id: "litz-420x38", type: "litz", copperAreaMm2: 3.364, strandCount: 420, strandDiaMm: 0.101, rdcMohmPerM: 5.28 },
  { id: "litz-660x38", type: "litz", copperAreaMm2: 5.287, strandCount: 660, strandDiaMm: 0.101, rdcMohmPerM: 3.36 },
  { id: "litz-800x40", type: "litz", copperAreaMm2: 4.008, strandCount: 800, strandDiaMm: 0.0799, rdcMohmPerM: 4.43 },
  { id: "litz-1050x44", type: "litz", copperAreaMm2: 2.132, strandCount: 1050, strandDiaMm: 0.0508, rdcMohmPerM: 8.33 },
];
