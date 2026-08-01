/**
 * Workbench pure helpers — number/unit formatting, chart math, CSV export,
 * and classification utilities for the design workbench UI.
 *
 * Deliberately free of React/DOM so everything here runs under the node
 * vitest environment.
 */

import type { BomLine, DesignResult, LossBreakdown } from "@/lib/types";
import { clamp, roundSig, siFormat } from "@/lib/util";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtW(x: number): string {
  return siFormat(x, "W", 3);
}

export function fmtHz(x: number): string {
  return siFormat(x, "Hz", 3);
}

export function fmtUsd(x: number): string {
  return `$${x.toFixed(2)}`;
}

export function fmtPct(x: number, digits = 1): string {
  return `${x.toFixed(digits)}%`;
}

export function fmtC(x: number, digits = 1): string {
  return `${x.toFixed(digits)} °C`;
}

/** W/L with automatic kW/L step for dense designs. */
export function fmtPowerDensity(wPerL: number): string {
  if (wPerL >= 1000) return `${roundSig(wPerL / 1000, 3)} kW/L`;
  return `${roundSig(wPerL, 3)} W/L`;
}

// ---------------------------------------------------------------------------
// Chart math
// ---------------------------------------------------------------------------

/** Linear domain→range mapping (no clamping). */
export function scaleLinear(
  v: number,
  d0: number,
  d1: number,
  r0: number,
  r1: number,
): number {
  if (d1 === d0) return r0;
  return r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/**
 * 4–6 clean axis ticks covering [lo, hi]. Steps snap to 1/2/2.5/5 × 10^n.
 */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi <= lo) return [lo];
  const span = hi - lo;
  const mag = Math.pow(10, Math.floor(Math.log10(span / Math.max(2, target))));
  const steps = [1, 2, 2.5, 5, 10, 20, 25, 50, 100].map((m) => m * mag);
  let best: number[] | null = null;
  let bestScore = Infinity;
  for (const step of steps) {
    const start = Math.ceil(lo / step - 1e-9) * step;
    const ticks: number[] = [];
    for (let v = start; v <= hi + step * 1e-9; v += step) {
      ticks.push(roundSig(v, 8) + 0); // +0 normalizes -0 from ceil()
      if (ticks.length > 40) break; // way too fine; skip
    }
    if (ticks.length < 2 || ticks.length > 40) continue;
    const n = ticks.length;
    const score = Math.abs(n - target) + (n > 6 ? 10 : 0) + (n < 4 ? 2 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = ticks;
    }
  }
  return best ?? [roundSig(lo, 8), roundSig(hi, 8)];
}

/**
 * Ticks with the domain snapped outward to step boundaries — for value axes
 * where the plot may breathe beyond the data (e.g. efficiency %). Returns
 * the expanded domain along with the ticks, which land on every step.
 */
export function niceDomainTicks(
  lo: number,
  hi: number,
  target = 5,
): { d0: number; d1: number; ticks: number[] } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return { d0: lo, d1: lo + 1, ticks: [lo] };
  }
  const span = hi - lo;
  const rawStep = span / Math.max(2, target - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let step = 10 * mag;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * mag >= rawStep - 1e-12) {
      step = m * mag;
      break;
    }
  }
  const d0 = Math.floor(lo / step + 1e-9) * step;
  const d1 = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = d0; v <= d1 + step * 1e-9; v += step) {
    ticks.push(roundSig(v, 8) + 0);
  }
  return { d0: roundSig(d0, 8) + 0, d1: roundSig(d1, 8) + 0, ticks };
}

/**
 * Horizontal bar with a 4px-rounded data end (right) and a square baseline
 * (left) — per mark spec. Degrades to a plain rect path for slivers.
 */
export function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0 || h <= 0) return "";
  const rr = Math.min(r, w, h / 2);
  return [
    `M${roundSig(x, 6)},${roundSig(y, 6)}`,
    `h${roundSig(w - rr, 6)}`,
    `a${rr},${rr} 0 0 1 ${rr},${rr}`,
    `v${roundSig(h - 2 * rr, 6)}`,
    `a${rr},${rr} 0 0 1 ${-rr},${rr}`,
    `h${roundSig(-(w - rr), 6)}`,
    "z",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Loss waterfall
// ---------------------------------------------------------------------------

export interface LossSegment {
  key: string;
  label: string;
  w: number;
}

/**
 * Flatten a LossBreakdown into the 9 canonical waterfall segments:
 * conduction / switching / coss / gate / dead-time (summed over all device
 * roles) + core / copper / cap / overhead.
 */
export function lossSegments(l: LossBreakdown): LossSegment[] {
  const sumBy = (f: (d: LossBreakdown["devices"][number]) => number) =>
    l.devices.reduce((s, d) => s + f(d), 0);
  return [
    { key: "conduction", label: "Conduction", w: sumBy((d) => d.conductionW) },
    { key: "switching", label: "Switching", w: sumBy((d) => d.switchingW) },
    { key: "coss", label: "Coss", w: sumBy((d) => d.cossW) },
    { key: "gate", label: "Gate", w: sumBy((d) => d.gateW) },
    { key: "dead-time", label: "Dead-time", w: sumBy((d) => d.deadTimeW) },
    { key: "core", label: "Core", w: l.magneticsCoreW },
    { key: "copper", label: "Copper", w: l.magneticsCopperW },
    { key: "cap", label: "Capacitor", w: l.capacitorW },
    { key: "overhead", label: "Overhead", w: l.overheadW },
  ];
}

// ---------------------------------------------------------------------------
// Thermal margin classification
// ---------------------------------------------------------------------------

/** green > 25 °C, amber 15–25 °C, rose < 15 °C. */
export type MarginTone = "ok" | "tight" | "low";

export function marginTone(marginC: number): MarginTone {
  if (marginC > 25) return "ok";
  if (marginC >= 15) return "tight";
  return "low";
}

/** Margin bar fill fraction (0–1) on a fixed 0–50 °C scale. */
export function marginBarFrac(marginC: number): number {
  return clamp(marginC / 50, 0, 1);
}

// ---------------------------------------------------------------------------
// BOM CSV export
// ---------------------------------------------------------------------------

export function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function bomToCsv(lines: BomLine[], totalUsd: number): string {
  const header = [
    "Refs",
    "Part",
    "Mfr",
    "Description",
    "Qty",
    "Unit USD",
    "Ext USD",
    "Suppliers",
  ];
  const rows = lines.map((l) => [
    l.ref.join(" "),
    l.partId,
    l.mfr,
    l.description,
    String(l.qty),
    l.unitPriceUsd.toFixed(2),
    l.extPriceUsd.toFixed(2),
    l.suppliers.join("; "),
  ]);
  rows.push(["", "", "", "TOTAL", "", "", totalUsd.toFixed(2), ""]);
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

// ---------------------------------------------------------------------------
// Result digging
// ---------------------------------------------------------------------------

/**
 * Power density of the chosen design, read from the candidate sweep (exact
 * topology+fsw match preferred, else nearest-fsw feasible sibling).
 */
export function chosenPowerDensity(r: DesignResult): number | undefined {
  const mine = r.candidates.filter(
    (c) => c.topologyId === r.topology.id && c.feasible,
  );
  if (mine.length === 0) return undefined;
  const exact = mine.find((c) => c.fswHz === r.fswHz);
  if (exact) return exact.powerDensityWPerL;
  let best = mine[0];
  for (const c of mine) {
    if (Math.abs(c.fswHz - r.fswHz) < Math.abs(best.fswHz - r.fswHz)) best = c;
  }
  return best.powerDensityWPerL;
}
