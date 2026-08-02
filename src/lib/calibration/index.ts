/**
 * VoltForge calibration harness (TECHPLAN §U44).
 *
 * Reproduction runs for published measured reference designs. Each anchor
 * design is run through designConverter() and compared against published
 * efficiency. Pass gate: |Δη| ≤ 0.5 % absolute (path to GOAL.md accuracy claim).
 */

import type { DesignResult } from "@/lib/types";
import { designConverter } from "@/lib/optimizer";
import type { CalibrationAnchor } from "./anchors";
import { ALL_ANCHORS } from "./anchors";

export interface CalibrationResult {
  anchorId: string;
  anchorName: string;
  publishedEfficiencyPct: number;
  modelEfficiencyPct: number;
  /** Absolute delta in efficiency percentage points. */
  deltaEfficiencyPct: number;
  /** True if |delta| <= 0.5 %. */
  passed: boolean;
  /** Full design result for detailed inspection. */
  designResult: DesignResult;
  notes: string[];
}

/**
 * Run one anchor through the full design pipeline.
 * Returns detailed comparison of published vs modeled efficiency.
 */
export function runAnchor(anchor: CalibrationAnchor): CalibrationResult {
  const designResult = designConverter(anchor.spec);
  // Published efficiency is typically stated at nominal load (usually 100%).
  const modelEfficiencyPct = designResult.efficiencyCurve
    .find((p) => p.loadPct === anchor.nominalLoadPct)
    ?.efficiencyPct ?? designResult.efficiencyPct;

  const deltaEfficiencyPct = modelEfficiencyPct - anchor.publishedEfficiencyPct;
  const passed = Math.abs(deltaEfficiencyPct) <= 0.5;

  const notes: string[] = [];
  if (!passed) {
    notes.push(`FAIL: |Δη| = ${Math.abs(deltaEfficiencyPct).toFixed(2)} % > 0.5 % gate`);
  }
  if (!designResult.compliance.passed) {
    notes.push(`Warning: Design failed compliance checks (see compliance.findings)`);
  }

  return {
    anchorId: anchor.id,
    anchorName: anchor.name,
    publishedEfficiencyPct: anchor.publishedEfficiencyPct,
    modelEfficiencyPct,
    deltaEfficiencyPct,
    passed,
    designResult,
    notes,
  };
}

/**
 * Run all configured anchors and return a summary report.
 * This is the primary CI entry point for calibration validation.
 */
export function runAllAnchors(): {
  results: CalibrationResult[];
  passCount: number;
  failCount: number;
  allPassed: boolean;
  summary: string;
} {
  const results = ALL_ANCHORS.map((a) => runAnchor(a));
  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.length - passCount;
  const allPassed = failCount === 0;

  const summary =
    results.length === 0
      ? "No anchors configured"
      : `${passCount}/${results.length} anchors passed (|Δη| ≤ 0.5 %)`;

  return { results, passCount, failCount, allPassed, summary };
}

export type { CalibrationAnchor };
export { ALL_ANCHORS };
