/** Display formatting helpers for the explore UI. Pure, dependency-free. */

import { roundSig, siFormat } from "@/lib/util";

/** "$12.40" / "$1,240" — trims cents above $100. */
export function fmtUsd(x: number): string {
  if (!Number.isFinite(x)) return "—";
  if (Math.abs(x) >= 100) return `$${Math.round(x).toLocaleString("en-US")}`;
  return `$${x.toFixed(2)}`;
}

/** "250 kHz", "1.2 MHz". */
export function fmtHz(x: number): string {
  return siFormat(x, "Hz", 3);
}

/** Plain number with sensible significant figures; "—" for non-finite. */
export function fmtNum(x: number | undefined, sig = 3): string {
  if (x === undefined || !Number.isFinite(x)) return "—";
  const r = roundSig(x, sig);
  // Avoid scientific notation for the ranges we show.
  return Math.abs(r) >= 1000 ? Math.round(r).toLocaleString("en-US") : String(r);
}

/** "97.4%" style percentage. */
export function fmtPct(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return "—";
  return `${x.toFixed(digits)}%`;
}
