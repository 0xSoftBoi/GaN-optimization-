/**
 * VoltForge economics — converts a DesignResult's efficiency curve into the
 * numbers energy professionals negotiate with: $/MWh saved, fleet TCO deltas,
 * payback, CO₂. Pure TypeScript, no I/O.
 *
 * HONESTY CONTRACT: nothing in this module fetches or asserts market data.
 * Every commercial input (energy price, carbon intensity, load profile,
 * baseline efficiency, fleet size, horizon) lives in EconomicsAssumptions —
 * a user-adjustable object. `defaultAssumptions()` provides clearly-labeled
 * editable starting points, not facts. Typical ranges, for the docs page:
 *
 *  - pricePerMwhUsd (default 70): retail industrial electricity in the US has
 *    recently run roughly 60–110 $/MWh (EIA industrial averages); EU
 *    industrial rates are often 100–250 $/MWh (Eurostat); wholesale hub
 *    prices can sit at 20–60 $/MWh. Pick the number your meter actually pays.
 *  - carbonKgPerMwh (default 350): grid carbon intensity varies enormously —
 *    world average is on the order of 400–450 kg CO₂/MWh (Ember/IEA annual
 *    reviews), the US grid ~350–400, the EU ~250, hydro/nuclear-heavy grids
 *    under 50, coal-heavy grids 700+. Set it to your region.
 *  - baselineEfficiencyPct (default 96.5): a flat "titanium-class" reference —
 *    the 80 PLUS Titanium tier requires ~96 % at 50 % load (230 V). A flat
 *    96.5 % line is a deliberately tough, clearly-labeled comparison baseline.
 *  - hoursPerYear (default 8760 = 24 × 365): derate for non-continuous duty.
 */

import type { DesignResult, DesignSpec } from "@/lib/types";
import { interp1 } from "@/lib/util";

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------

/** One operating point of the annual load-duty profile. */
export interface LoadProfilePoint {
  /** Converter load as % of rated poutW (0–100). */
  loadPct: number;
  /** Relative time weight; weights are normalized internally. */
  weight: number;
}

/**
 * User-adjustable commercial assumptions. Every field is an editable input —
 * defaults from `defaultAssumptions()` are starting points, not market data.
 */
export interface EconomicsAssumptions {
  /** Energy price the operator pays, USD per MWh. */
  pricePerMwhUsd: number;
  /** Operating hours per year (8760 = continuous). */
  hoursPerYear: number;
  /** Annual load-duty profile; weights normalized to 1. */
  loadProfile: LoadProfilePoint[];
  /**
   * Flat reference efficiency (%) the incumbent fleet is assumed to run at,
   * independent of load. Default is a titanium-class 96.5 % flat baseline.
   */
  baselineEfficiencyPct: number;
  /** Number of identical converter units deployed. */
  fleetUnits: number;
  /** Evaluation horizon in years (simple sum, no discounting). */
  horizonYears: number;
  /** Grid carbon intensity, kg CO₂ per MWh of electricity. */
  carbonKgPerMwh: number;
}

/** One row of the price-sensitivity sweep. */
export interface PriceSensitivityPoint {
  pricePerMwhUsd: number;
  fleetAnnualUsdSaved: number;
}

/**
 * Per-load-point contribution to the annual savings — the data behind a
 * "savings by load profile" chart. Rows sum (by construction) to the
 * headline `annualUsdSavedPerUnit` / `annualMwhSavedPerUnit`.
 */
export interface LoadProfileBreakdownPoint {
  /** Converter load as % of rated poutW, as given in the assumptions. */
  loadPct: number;
  /** This point's weight normalized so all points sum to 1. */
  weightFrac: number;
  /** This design's efficiency at this load point (%, interpolated). */
  efficiencyPct: number;
  /** Per-unit annual MWh saved vs baseline attributable to this point. */
  annualMwhSavedPerUnit: number;
  /** Per-unit annual USD saved vs baseline attributable to this point. */
  annualUsdSavedPerUnit: number;
}

/** Output of `energyEconomics()`. All monetary values in USD. */
export interface EnergyEconomics {
  /** Profile-weighted efficiency of THIS design (%, interpolated curve). */
  weightedEfficiencyPct: number;
  /** Profile-weighted efficiency of the flat baseline (%, equals the flat value). */
  baselineWeightedPct: number;
  /** Annual OUTPUT energy delivered per unit, MWh. */
  annualMwhPerUnit: number;
  /** Annual INPUT energy avoided vs the baseline per unit, MWh (negative if worse). */
  annualMwhSavedPerUnit: number;
  /** annualMwhSavedPerUnit × price. */
  annualUsdSavedPerUnit: number;
  /** Per-unit annual savings × fleetUnits. */
  fleetAnnualUsdSaved: number;
  /** Fleet annual savings × horizonYears (undiscounted). */
  fleetHorizonUsdSaved: number;
  /** BOM cost of one unit, from the design result. */
  unitBomCostUsd: number;
  /**
   * Months for one unit's annual savings to repay its BOM cost.
   * null when the design never pays back (savings ≤ 0).
   */
  paybackMonths: number | null;
  /** Fleet-wide CO₂ avoided per year, tonnes (negative if worse than baseline). */
  co2SavedTonnesPerYear: number;
  /** Profile-weighted dissipation of this design, W per unit. */
  lossAtProfileW: number;
  /** Fleet annual savings at 0.5×, 0.75×, 1×, 1.25×, 1.5× the assumed price. */
  sensitivity: PriceSensitivityPoint[];
  /**
   * Per-load-point savings contribution — rows sum to the headline totals.
   * Optional in the type only so older object literals (fixtures/stubs
   * elsewhere) stay valid; `energyEconomics()` always populates it.
   */
  loadProfileBreakdown?: LoadProfileBreakdownPoint[];
}

/** Multipliers for the price-sensitivity sweep (5 points, centered on 1×). */
const SENSITIVITY_MULTIPLIERS = [0.5, 0.75, 1, 1.25, 1.5] as const;

/**
 * Editable default assumptions for a given spec. Values are deliberately
 * conservative, clearly-labeled starting points (see module header for
 * typical ranges) — the UI must present them as inputs, not facts.
 *
 * Load profile: datacenter-style duty weighted toward 60–90 % load, where
 * well-utilized rack power systems spend most of their hours.
 */
export function defaultAssumptions(spec: DesignSpec): EconomicsAssumptions {
  void spec; // Reserved: per-application profiles may key off the spec later.
  return {
    pricePerMwhUsd: 70,
    hoursPerYear: 8760,
    loadProfile: [
      { loadPct: 30, weight: 0.1 },
      { loadPct: 50, weight: 0.15 },
      { loadPct: 60, weight: 0.2 },
      { loadPct: 75, weight: 0.3 },
      { loadPct: 90, weight: 0.2 },
      { loadPct: 100, weight: 0.05 },
    ],
    baselineEfficiencyPct: 96.5, // Titanium-class flat baseline (editable).
    fleetUnits: 1,
    horizonYears: 5,
    carbonKgPerMwh: 350,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function fin(x: number, name: string): number {
  if (typeof x !== "number" || !Number.isFinite(x)) {
    throw new Error(`economics: ${name} must be a finite number`);
  }
  return x;
}

/** Throws with a descriptive message on any unusable assumption set. */
export function assertValidAssumptions(a: EconomicsAssumptions): void {
  if (fin(a.pricePerMwhUsd, "pricePerMwhUsd") < 0) {
    throw new Error("economics: pricePerMwhUsd must be >= 0");
  }
  if (fin(a.hoursPerYear, "hoursPerYear") <= 0 || a.hoursPerYear > 8784) {
    throw new Error("economics: hoursPerYear must be in (0, 8784]");
  }
  if (fin(a.baselineEfficiencyPct, "baselineEfficiencyPct") <= 0 || a.baselineEfficiencyPct > 100) {
    throw new Error("economics: baselineEfficiencyPct must be in (0, 100]");
  }
  if (fin(a.fleetUnits, "fleetUnits") < 1) {
    throw new Error("economics: fleetUnits must be >= 1");
  }
  if (fin(a.horizonYears, "horizonYears") <= 0) {
    throw new Error("economics: horizonYears must be > 0");
  }
  if (fin(a.carbonKgPerMwh, "carbonKgPerMwh") < 0) {
    throw new Error("economics: carbonKgPerMwh must be >= 0");
  }
  if (!Array.isArray(a.loadProfile) || a.loadProfile.length === 0) {
    throw new Error("economics: loadProfile must contain at least one point");
  }
  let weightSum = 0;
  for (const p of a.loadProfile) {
    if (fin(p.loadPct, "loadProfile.loadPct") < 0 || p.loadPct > 100) {
      throw new Error("economics: loadProfile.loadPct must be in [0, 100]");
    }
    if (fin(p.weight, "loadProfile.weight") < 0) {
      throw new Error("economics: loadProfile.weight must be >= 0");
    }
    weightSum += p.weight;
  }
  if (weightSum <= 0) {
    throw new Error("economics: loadProfile weights must sum to > 0");
  }
}

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

const W_PER_MW = 1e6;

/**
 * Energy economics of a design vs a flat-efficiency baseline processing the
 * SAME output energy, over the given load profile.
 *
 * Per profile point i (weights wᵢ normalized to Σw = 1):
 *   P_out,i  = poutW · loadPctᵢ/100
 *   η_i      = interp(efficiencyCurve, loadPctᵢ) / 100
 *   P_in,i   = P_out,i / η_i          P_in,base,i = P_out,i / (η_base/100)
 * Annual energies (MWh) sum wᵢ · P · hoursPerYear / 1e6; savings are
 * E_in,base − E_in (positive when this design beats the baseline).
 */
export function energyEconomics(
  result: DesignResult,
  a: EconomicsAssumptions,
): EnergyEconomics {
  assertValidAssumptions(a);

  const curve = result.efficiencyCurve;
  if (!Array.isArray(curve) || curve.length === 0) {
    throw new Error("economics: result.efficiencyCurve is empty");
  }
  const poutW = fin(result.spec.poutW, "result.spec.poutW");
  if (poutW <= 0) throw new Error("economics: result.spec.poutW must be > 0");

  const sorted = [...curve].sort((p, q) => p.loadPct - q.loadPct);
  const xs = sorted.map((p) => p.loadPct);
  const ys = sorted.map((p) => p.efficiencyPct);

  const weightSum = a.loadProfile.reduce((s, p) => s + p.weight, 0);
  const etaBase = a.baselineEfficiencyPct / 100;

  // Profile-weighted powers (W) and efficiencies (%).
  const hours = a.hoursPerYear;
  let weightedEffPct = 0;
  let poutAvgW = 0; // Σ w·P_out
  let pinAvgW = 0; // Σ w·P_in (this design)
  let pinBaseAvgW = 0; // Σ w·P_in (baseline)
  const loadProfileBreakdown: LoadProfileBreakdownPoint[] = [];
  for (const p of a.loadProfile) {
    const w = p.weight / weightSum;
    const effPct = interp1(xs, ys, p.loadPct);
    if (!Number.isFinite(effPct) || effPct <= 0) {
      throw new Error(`economics: efficiency curve gives ${effPct}% at ${p.loadPct}% load`);
    }
    const pOut = (poutW * p.loadPct) / 100;
    const pIn = pOut / (effPct / 100);
    const pInBase = pOut / etaBase;
    weightedEffPct += w * effPct;
    poutAvgW += w * pOut;
    pinAvgW += w * pIn;
    pinBaseAvgW += w * pInBase;

    const pointMwhSaved = (w * (pInBase - pIn) * hours) / W_PER_MW;
    loadProfileBreakdown.push({
      loadPct: p.loadPct,
      weightFrac: w,
      efficiencyPct: effPct,
      annualMwhSavedPerUnit: pointMwhSaved,
      annualUsdSavedPerUnit: pointMwhSaved * a.pricePerMwhUsd,
    });
  }

  const annualMwhPerUnit = (poutAvgW * hours) / W_PER_MW;
  const annualMwhInPerUnit = (pinAvgW * hours) / W_PER_MW;
  const annualMwhInBasePerUnit = (pinBaseAvgW * hours) / W_PER_MW;
  const annualMwhSavedPerUnit = annualMwhInBasePerUnit - annualMwhInPerUnit;

  const annualUsdSavedPerUnit = annualMwhSavedPerUnit * a.pricePerMwhUsd;
  const fleetAnnualUsdSaved = annualUsdSavedPerUnit * a.fleetUnits;
  const fleetHorizonUsdSaved = fleetAnnualUsdSaved * a.horizonYears;

  const unitBomCostUsd = fin(result.bomCostUsd, "result.bomCostUsd");
  const paybackMonths =
    annualUsdSavedPerUnit > 0 ? (unitBomCostUsd / annualUsdSavedPerUnit) * 12 : null;

  const co2SavedTonnesPerYear =
    (annualMwhSavedPerUnit * a.fleetUnits * a.carbonKgPerMwh) / 1000;

  const sensitivity: PriceSensitivityPoint[] = SENSITIVITY_MULTIPLIERS.map((m) => {
    const price = a.pricePerMwhUsd * m;
    return {
      pricePerMwhUsd: price,
      fleetAnnualUsdSaved: annualMwhSavedPerUnit * price * a.fleetUnits,
    };
  });

  return {
    weightedEfficiencyPct: weightedEffPct,
    baselineWeightedPct: a.baselineEfficiencyPct,
    annualMwhPerUnit,
    annualMwhSavedPerUnit,
    annualUsdSavedPerUnit,
    fleetAnnualUsdSaved,
    fleetHorizonUsdSaved,
    unitBomCostUsd,
    paybackMonths,
    co2SavedTonnesPerYear,
    lossAtProfileW: pinAvgW - poutAvgW,
    sensitivity,
    loadProfileBreakdown,
  };
}
