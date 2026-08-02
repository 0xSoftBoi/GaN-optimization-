/**
 * Pareto-explorer logic: the default 5 kW example spec, spec-form parsing,
 * axis tick generation, scales, and candidate classification. Pure TS.
 */

import type { Cooling, DesignCandidateSummary, DesignSpec, TopologyId } from "@/lib/types";
import { clamp } from "@/lib/util";

// ---------------------------------------------------------------------------
// The 5 kW example (README flagship prompt: "5 kW bidirectional converter,
// 800 V bus to 48 V rack, forced air, 40 °C")
// ---------------------------------------------------------------------------

export const DEFAULT_SPEC: DesignSpec = {
  name: "5 kW bidirectional 800V→48V",
  conversion: "dc-dc",
  vinMinV: 680,
  vinNomV: 800,
  vinMaxV: 900,
  voutV: 48,
  poutW: 5000,
  bidirectional: true,
  isolated: true,
  ambientC: 40,
  cooling: "forced-air",
};

/** Shape of the /api/optimize response body. */
export interface OptimizeResponse {
  candidates: DesignCandidateSummary[];
  bestSummary: {
    topologyId: TopologyId;
    efficiencyPct: number;
    bomCostUsd: number;
    fswHz: number;
    deviceId: string;
  };
}

// ---------------------------------------------------------------------------
// Spec form (string state → DesignSpec)
// ---------------------------------------------------------------------------

export interface SpecFormState {
  name: string;
  conversion: DesignSpec["conversion"];
  vinMinV: string;
  vinNomV: string;
  vinMaxV: string;
  voutV: string;
  poutW: string;
  bidirectional: boolean;
  isolated: boolean;
  ambientC: string;
  cooling: Cooling;
  /** Optional — empty string means "let the optimizer sweep". */
  fswKhz: string;
  targetEfficiencyPct: string;
  costCeilingUsd: string;
}

export function formStateFromSpec(spec: DesignSpec): SpecFormState {
  return {
    name: spec.name ?? "",
    conversion: spec.conversion,
    vinMinV: String(spec.vinMinV),
    vinNomV: String(spec.vinNomV),
    vinMaxV: String(spec.vinMaxV),
    voutV: String(spec.voutV),
    poutW: String(spec.poutW),
    bidirectional: spec.bidirectional,
    isolated: spec.isolated,
    ambientC: String(spec.ambientC),
    cooling: spec.cooling,
    fswKhz: spec.fswHz !== undefined ? String(spec.fswHz / 1e3) : "",
    targetEfficiencyPct:
      spec.targetEfficiencyPct !== undefined ? String(spec.targetEfficiencyPct) : "",
    costCeilingUsd: spec.costCeilingUsd !== undefined ? String(spec.costCeilingUsd) : "",
  };
}

function parseNum(raw: string, label: string, errors: string[]): number | undefined {
  const t = raw.trim();
  if (t === "") {
    errors.push(`${label} is required`);
    return undefined;
  }
  const v = Number(t);
  if (!Number.isFinite(v) || v <= 0) {
    errors.push(`${label} must be a positive number`);
    return undefined;
  }
  return v;
}

function parseOptNum(raw: string, label: string, errors: string[]): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const v = Number(t);
  if (!Number.isFinite(v) || v <= 0) {
    errors.push(`${label} must be a positive number (or blank)`);
    return undefined;
  }
  return v;
}

/** Validate + convert the form state. Errors are human-readable strings. */
export function specFromForm(
  f: SpecFormState,
): { ok: true; spec: DesignSpec } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const vinMinV = parseNum(f.vinMinV, "Vin min", errors);
  const vinNomV = parseNum(f.vinNomV, "Vin nom", errors);
  const vinMaxV = parseNum(f.vinMaxV, "Vin max", errors);
  const voutV = parseNum(f.voutV, "Vout", errors);
  const poutW = parseNum(f.poutW, "Pout", errors);
  const ambientRaw = f.ambientC.trim();
  const ambientC = ambientRaw === "" ? undefined : Number(ambientRaw);
  if (ambientC === undefined || !Number.isFinite(ambientC)) {
    errors.push("Ambient must be a number");
  }
  const fswKhz = parseOptNum(f.fswKhz, "fsw", errors);
  const targetEfficiencyPct = parseOptNum(f.targetEfficiencyPct, "Target eff", errors);
  const costCeilingUsd = parseOptNum(f.costCeilingUsd, "Cost ceiling", errors);

  if (
    vinMinV !== undefined &&
    vinNomV !== undefined &&
    vinMaxV !== undefined &&
    !(vinMinV <= vinNomV && vinNomV <= vinMaxV)
  ) {
    errors.push("Vin range must satisfy min ≤ nom ≤ max");
  }
  if (targetEfficiencyPct !== undefined && targetEfficiencyPct >= 100) {
    errors.push("Target efficiency must be < 100%");
  }

  if (errors.length) return { ok: false, errors };

  const spec: DesignSpec = {
    ...(f.name.trim() ? { name: f.name.trim() } : {}),
    conversion: f.conversion,
    vinMinV: vinMinV as number,
    vinNomV: vinNomV as number,
    vinMaxV: vinMaxV as number,
    voutV: voutV as number,
    poutW: poutW as number,
    bidirectional: f.bidirectional,
    isolated: f.isolated,
    ...(fswKhz !== undefined ? { fswHz: fswKhz * 1e3 } : {}),
    ambientC: ambientC as number,
    cooling: f.cooling,
    ...(targetEfficiencyPct !== undefined ? { targetEfficiencyPct } : {}),
    ...(costCeilingUsd !== undefined ? { costCeilingUsd } : {}),
  };
  return { ok: true, spec };
}

// ---------------------------------------------------------------------------
// Axis ticks — clean 1/2/2.5/5 steps, aiming for 4–6 ticks
// ---------------------------------------------------------------------------

/**
 * Nice tick positions covering [lo, hi]. Chooses a 1/2/2.5/5×10^k step whose
 * tick count lands in [4, 6] (closest to 5 wins). Degenerate domains return
 * a single tick.
 */
export function niceTicks(lo: number, hi: number): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi < lo) [lo, hi] = [hi, lo];
  const range = hi - lo;
  if (range === 0) return [lo];

  const mags = [0.5, 1, 2]; // around the decade of range/5
  const bases = [1, 2, 2.5, 5];
  let bestTicks: number[] | null = null;
  let bestScore = Infinity;
  const decade = Math.pow(10, Math.floor(Math.log10(range / 5)));
  for (const m of mags) {
    for (const b of bases) {
      const step = b * m * decade;
      const start = Math.ceil(lo / step) * step;
      const ticks: number[] = [];
      for (let t = start; t <= hi + step * 1e-9; t += step) {
        // Snap floating error to the step grid.
        ticks.push(Math.round(t / step) * step);
      }
      const n = ticks.length;
      if (n < 4 || n > 6) continue;
      const score = Math.abs(n - 5);
      if (score < bestScore) {
        bestScore = score;
        bestTicks = ticks;
      }
    }
  }
  if (bestTicks) return bestTicks;
  // Fallback (very unusual ranges): 5 evenly spaced ticks.
  return [0, 1, 2, 3, 4].map((i) => lo + (range * i) / 4);
}

/** [min, max] of xs padded by frac on each side (never zero-width). */
export function paddedExtent(xs: number[], frac = 0.06): [number, number] {
  if (xs.length === 0) return [0, 1];
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (lo === hi) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.05 : 1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * frac;
  return [lo - pad, hi + pad];
}

/** Linear scale factory: domain → range. */
export function linScale(
  d0: number,
  d1: number,
  r0: number,
  r1: number,
): (x: number) => number {
  const k = d1 !== d0 ? (r1 - r0) / (d1 - d0) : 0;
  return (x: number) => r0 + (x - d0) * k;
}

// ---------------------------------------------------------------------------
// Candidate classification & point sizing
// ---------------------------------------------------------------------------

export interface CandidateGroups {
  front: DesignCandidateSummary[];
  dominated: DesignCandidateSummary[];
  infeasible: DesignCandidateSummary[];
}

export function groupCandidates(cands: DesignCandidateSummary[]): CandidateGroups {
  const front: DesignCandidateSummary[] = [];
  const dominated: DesignCandidateSummary[] = [];
  const infeasible: DesignCandidateSummary[] = [];
  for (const c of cands) {
    if (!c.feasible) infeasible.push(c);
    else if (c.pareto) front.push(c);
    else dominated.push(c);
  }
  // Front sorted by cost so a connecting line can be drawn left→right.
  front.sort((a, b) => a.bomCostUsd - b.bomCostUsd);
  return { front, dominated, infeasible };
}

/**
 * Point radius from power density: area ∝ density (sqrt radius scale),
 * clamped to [3.5, 9] px so every point stays hoverable and none dominates.
 */
export function radiusForDensity(
  dWPerL: number,
  dMin: number,
  dMax: number,
): number {
  const rMin = 3.5;
  const rMax = 9;
  if (!(dMax > dMin) || !Number.isFinite(dWPerL)) return (rMin + rMax) / 2;
  const t = clamp((dWPerL - dMin) / (dMax - dMin), 0, 1);
  const aMin = rMin * rMin;
  const aMax = rMax * rMax;
  return Math.sqrt(aMin + t * (aMax - aMin));
}

/** Unique key for a candidate point (topology × device × fsw). */
export function candidateKey(c: DesignCandidateSummary): string {
  return `${c.topologyId}|${c.deviceId}|${Math.round(c.fswHz)}`;
}
