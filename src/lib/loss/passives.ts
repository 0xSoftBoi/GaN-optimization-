/**
 * VoltForge loss engine — passive-component losses.
 *  - core loss via Steinmetz fit (types.ts convention: Pv[kW/m³] = k·f^α·B^β)
 *  - winding AC resistance via Dowell layer model (copper at 100 °C)
 *  - capacitor ESR loss
 */

import type { CoreMaterial, WireSpec, CapacitorPart } from "@/lib/types";

// ---------------------------------------------------------------------------
// Core loss (Steinmetz)
// ---------------------------------------------------------------------------

/**
 * Sinusoidal Steinmetz core loss, W.
 * Pv [kW/m³] = k · f[Hz]^alpha · B[T]^beta  (per the frozen types.ts fit),
 * so P = Pv·1e3 [W/m³] · Ve[mm³]·1e-9 [m³] = Pv · Ve · 1e-6.
 * B is the PEAK AC flux density (half of ΔB for symmetric excitation).
 * For non-sinusoidal drive the magnetics module applies its iGSE correction
 * on top of this; this is the canonical sinusoidal kernel.
 */
export function coreLossW(
  material: CoreMaterial,
  veMm3: number,
  fHz: number,
  bPkT: number
): number {
  if (fHz <= 0 || bPkT <= 0 || veMm3 <= 0) return 0;
  const pvKwPerM3 =
    material.steinmetzK *
    Math.pow(fHz, material.steinmetzAlpha) *
    Math.pow(bPkT, material.steinmetzBeta);
  return pvKwPerM3 * veMm3 * 1e-6;
}

// ---------------------------------------------------------------------------
// Winding AC resistance (Dowell)
// ---------------------------------------------------------------------------

/** Copper resistivity at 100 °C, Ω·m: ρ20·(1 + 0.00393·(100 − 20)). */
export const RHO_CU_100C = 1.68e-8 * (1 + 0.00393 * 80); // ≈ 2.21e-8 Ω·m

const MU0 = 4e-7 * Math.PI;

/** Skin depth in copper at 100 °C, meters: δ = sqrt(ρ/(π·µ0·f)). */
export function skinDepthCuM(fHz: number): number {
  return Math.sqrt(RHO_CU_100C / (Math.PI * MU0 * fHz));
}

/** Dowell kernel: Fr(Δ, m) for m effective layers of normalized thickness Δ. */
function dowellFr(delta: number, m: number): number {
  if (delta < 1e-3) return 1; // sinh/cosh cancel numerically below this
  const x = delta;
  const skin =
    x * ((Math.sinh(2 * x) + Math.sin(2 * x)) / (Math.cosh(2 * x) - Math.cos(2 * x)));
  const prox =
    x *
    ((2 * (m * m - 1)) / 3) *
    ((Math.sinh(x) - Math.sin(x)) / (Math.cosh(x) + Math.cos(x)));
  return Math.max(1, skin + prox);
}

/**
 * AC/DC resistance ratio Fr ≥ 1 via Dowell's layer model (copper at 100 °C).
 *
 *  - solid round wire: equivalent-foil thickness h = (π/4)^0.75·d ≈ 0.834·d
 *    (standard round-to-foil conversion)
 *  - litz: per-strand Δ with effective layer count m·√(strands) — each layer
 *    of the bundle presents √k strand sub-layers to the proximity field
 *  - foil: thickness inferred from area assuming a 25:1 width:thickness
 *    aspect (typical 0.1–0.3 mm foil), documented approximation
 *
 * `layers` is the number of winding layers in the window (≥ 1).
 */
export function acResistanceFactor(
  fHz: number,
  wire: WireSpec,
  layers: number
): number {
  if (fHz <= 0) return 1;
  const m = Math.max(1, layers);
  const deltaSkinM = skinDepthCuM(fHz);

  if (wire.type === "litz" && wire.strandDiaMm && wire.strandCount) {
    const hM = 0.834 * wire.strandDiaMm * 1e-3;
    const mEff = m * Math.sqrt(wire.strandCount);
    return dowellFr(hM / deltaSkinM, mEff);
  }

  if (wire.type === "foil") {
    const tMm = Math.sqrt(wire.copperAreaMm2 / 25); // 25:1 aspect assumption
    return dowellFr((tMm * 1e-3) / deltaSkinM, m);
  }

  // solid round
  const dMm = 2 * Math.sqrt(wire.copperAreaMm2 / Math.PI);
  const hM = 0.834 * dMm * 1e-3;
  return dowellFr(hM / deltaSkinM, m);
}

// ---------------------------------------------------------------------------
// Capacitor ESR loss
// ---------------------------------------------------------------------------

/** P = Irms²·ESR, W. */
export function capacitorLossW(cap: CapacitorPart, iRmsA: number): number {
  return iRmsA * iRmsA * cap.esrMohm * 1e-3;
}
