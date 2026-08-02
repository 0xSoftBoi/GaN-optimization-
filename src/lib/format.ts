/**
 * VoltForge — shared display formatting for the two-persona UI.
 * Engineering pages and the economics/TCO views import from here so a
 * dollar figure or an energy quantity reads identically everywhere.
 * Pure functions, no locale surprises (fixed en-US grouping).
 */

import { roundSig } from "@/lib/util";

/** Scale ladder shared by USD formatting. */
const USD_SCALES: readonly [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];

/**
 * Compact USD: formatUsd(1_200_000) → "$1.2M", 43_000 → "$43k", 980 → "$980",
 * -43_000 → "-$43k". Two significant digits above $1k, whole dollars below.
 */
export function formatUsd(x: number): string {
  if (!Number.isFinite(x)) return `$${String(x)}`;
  const sign = x < 0 ? "-" : "";
  const abs = Math.abs(x);
  const whole = Math.round(abs);
  if (whole < 1000) return `${sign}$${whole}`;
  for (let i = 0; i < USD_SCALES.length; i++) {
    const [scale, suffix] = USD_SCALES[i];
    if (abs >= scale) {
      let m = roundSig(abs / scale, 2);
      // Rounding can carry into the next scale (999_600 → 1000k → 1M).
      if (m >= 1000 && i > 0) {
        m = roundSig(m / 1000, 2);
        return `${sign}$${m}${USD_SCALES[i - 1][1]}`;
      }
      return `${sign}$${m}${suffix}`;
    }
  }
  return `${sign}$${whole}`; // unreachable: abs >= 1000 always matches "k"
}

/**
 * Round to `sig` significant digits and add en-US thousands separators.
 * formatNumber(12345.6, 3) → "12,300"; formatNumber(0.012345, 2) → "0.012".
 */
export function formatNumber(x: number, sig = 3): string {
  if (!Number.isFinite(x)) return String(x);
  const r = roundSig(x, sig);
  if (Math.abs(r) >= 1000) {
    return r.toLocaleString("en-US", { maximumFractionDigits: 10 });
  }
  return String(r);
}

/** Unit ladder for energy quantities expressed in MWh. */
const ENERGY_SCALES: readonly [number, string][] = [
  [1e6, "TWh"],
  [1e3, "GWh"],
  [1, "MWh"],
  [1e-3, "kWh"],
];

/**
 * Energy given in MWh: formatEnergy(1200) → "1.2 GWh", 340 → "340 MWh",
 * 0.34 → "340 kWh". Two significant digits; negatives keep their sign.
 */
export function formatEnergy(mwh: number): string {
  if (!Number.isFinite(mwh)) return `${String(mwh)} MWh`;
  if (mwh === 0) return "0 MWh";
  const sign = mwh < 0 ? "-" : "";
  const abs = Math.abs(mwh);
  for (let i = 0; i < ENERGY_SCALES.length; i++) {
    const [scale, unit] = ENERGY_SCALES[i];
    if (abs >= scale) {
      let m = roundSig(abs / scale, 2);
      if (m >= 1000 && i > 0) {
        m = roundSig(m / 1000, 2);
        return `${sign}${m} ${ENERGY_SCALES[i - 1][1]}`;
      }
      return `${sign}${m} ${unit}`;
    }
  }
  // Below 1 kWh: still express in kWh.
  return `${sign}${roundSig(abs * 1000, 2)} kWh`;
}

/**
 * Percentage with fixed decimal places; input is already in percent.
 * formatPct(97.31) → "97.3%"; formatPct(5, 0) → "5%".
 */
export function formatPct(x: number, dp = 1): string {
  if (!Number.isFinite(x)) return `${String(x)}%`;
  return `${x.toFixed(dp)}%`;
}
