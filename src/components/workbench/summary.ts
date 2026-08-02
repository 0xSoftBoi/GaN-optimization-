/**
 * Pure presentation helpers that turn a DesignResult + EconomicsAssumptions
 * into commercial-facing text: the Impact panel's plain-English sentence,
 * the downloadable executive summary, friendly error copy, and the
 * compliance verdict/consequence framing used by the executive persona.
 *
 * No React/DOM — everything here is a pure function so it unit-tests under
 * the node vitest environment, same convention as ./format.ts.
 */

import type { ComplianceReport, DesignResult } from "@/lib/types";
import type { EconomicsAssumptions, EnergyEconomics } from "@/lib/economics";
import { formatPct, formatUsd } from "@/lib/format";
import { fmtW } from "./format";

// ---------------------------------------------------------------------------
// Impact panel — plain-English trade sentence
// ---------------------------------------------------------------------------

/**
 * One sentence summarizing the $ trade at the current assumptions, e.g.
 * "At $70/MWh across 500 units, this design returns its BOM cost in 8 months
 * and saves $412k/yr vs a 96.5% baseline — assumptions editable."
 * Handles the break-even and worse-than-baseline cases honestly instead of
 * dividing by zero or showing a negative payback.
 */
export function impactSentence(
  a: EconomicsAssumptions,
  eco: EnergyEconomics,
): string {
  const fleetWord =
    a.fleetUnits === 1 ? "this unit" : `${a.fleetUnits.toLocaleString("en-US")} units`;
  const priceStr = `$${Math.round(a.pricePerMwhUsd).toLocaleString("en-US")}/MWh`;
  const baselineStr = `${formatPct(a.baselineEfficiencyPct, 1)} baseline`;

  if (eco.annualUsdSavedPerUnit <= 0) {
    return `At ${priceStr} across ${fleetWord}, this design does not beat the ${baselineStr} at these assumptions — it costs ${formatUsd(
      Math.abs(eco.fleetAnnualUsdSaved),
    )}/yr more to run. Try a different price, baseline, or fleet size below.`;
  }

  const months = eco.paybackMonths ?? 0;
  const paybackStr =
    months < 1 ? "under a month" : `${Math.round(months)} month${Math.round(months) === 1 ? "" : "s"}`;

  return `At ${priceStr} across ${fleetWord}, this design returns its BOM cost in ${paybackStr} and saves ${formatUsd(
    eco.fleetAnnualUsdSaved,
  )}/yr vs a ${baselineStr} — assumptions editable.`;
}

// ---------------------------------------------------------------------------
// Friendly error copy
// ---------------------------------------------------------------------------

/**
 * Maps a raw engine/API error string to short, non-technical copy. The raw
 * message is never discarded — callers show it in a collapsible
 * "technical details" block alongside this headline.
 */
export function friendlyErrorMessage(raw: string): string {
  if (/^HTTP 4\d\d/.test(raw) || /invalid/i.test(raw)) {
    return "That request could not be processed — check the specification and try again.";
  }
  if (/^HTTP 5\d\d/.test(raw)) {
    return "The design engine hit an internal error while working on this spec.";
  }
  if (/abort|network|fetch/i.test(raw)) {
    return "The connection to the design engine was interrupted.";
  }
  return "The engine could not complete this design.";
}

// ---------------------------------------------------------------------------
// Compliance verdict + consequence framing (executive persona)
// ---------------------------------------------------------------------------

/** Rule id -> what a FAIL on that rule actually blocks, in plain language. */
const CONSEQUENCE: Record<string, string> = {
  "device-vds-derating":
    "blocks production sign-off until voltage margin is restored — device stress risks field failures",
  "gate-dvdt-cmti":
    "risks gate-driver mis-triggering and EMI issues in the field until drive strength or isolation margin is fixed",
  "tj-margin":
    "blocks thermal sign-off — the device will run hotter than its safe margin, cutting expected lifetime",
  "creepage-clearance":
    "blocks safety certification (IEC 62368-1) until creepage/clearance is increased",
  "output-ripple":
    "fails the output spec — downstream loads may misbehave until ripple is reduced",
  "isolation-consistency":
    "blocks safety sign-off — the design does not meet the isolation the spec requires",
  "bidirectional-consistency":
    "the design cannot deliver the bidirectional operation the spec requires",
  "efficiency-target":
    "misses the stated efficiency target — revisit topology or device selection",
};

/** Plain-language consequence of a FAIL on `rule`; always returns something. */
export function complianceConsequence(rule: string): string {
  return CONSEQUENCE[rule] ?? "should be resolved before this design is signed off for production";
}

export interface ComplianceSummary {
  passed: boolean;
  failCount: number;
  warnCount: number;
  /** One-line, persona-neutral headline. */
  headline: string;
}

/** Condenses a full ComplianceReport into the executive-facing verdict. */
export function complianceVerdict(report: ComplianceReport): ComplianceSummary {
  const failCount = report.findings.filter((f) => f.severity === "fail").length;
  const warnCount = report.findings.filter((f) => f.severity === "warn").length;
  const headline = report.passed
    ? warnCount > 0
      ? `Passed with ${warnCount} item${warnCount === 1 ? "" : "s"} to watch`
      : "Passed — no issues found"
    : `${failCount} issue${failCount === 1 ? "" : "s"} block production sign-off`;
  return { passed: report.passed, failCount, warnCount, headline };
}

// ---------------------------------------------------------------------------
// Executive summary export (Markdown one-pager)
// ---------------------------------------------------------------------------

/**
 * A printable/emailable Markdown one-pager: spec, headline numbers, the
 * editable commercial assumptions behind them, and any warnings. This is
 * the artifact an executive persona can actually take into a meeting.
 */
export function buildSummaryMarkdown(
  result: DesignResult,
  a: EconomicsAssumptions,
  eco: EnergyEconomics,
): string {
  const spec = result.spec;
  const verdict = complianceVerdict(result.compliance);
  const lines: string[] = [];

  lines.push(`# ${spec.name ?? "VoltForge design summary"}`);
  lines.push("");
  lines.push(
    "Generated by VoltForge. Estimates from datasheet parameters and standard analytical " +
      "methods — a design-exploration aid, not a substitute for bench measurement. Validate on hardware before production.",
  );
  lines.push("");
  lines.push("## Specification");
  lines.push(`- Conversion: ${spec.vinNomV} V → ${spec.voutV} V, ${spec.poutW} W (${spec.conversion})`);
  lines.push(`- Topology: ${result.topology?.name ?? "—"}`);
  lines.push(`- Isolated: ${spec.isolated ? "yes" : "no"} · Bidirectional: ${spec.bidirectional ? "yes" : "no"}`);
  lines.push(`- Ambient: ${spec.ambientC} °C · Cooling: ${spec.cooling}`);
  lines.push("");
  lines.push("## Headline numbers");
  lines.push(`- Efficiency: ${formatPct(result.efficiencyPct, 2)}`);
  lines.push(`- Total loss: ${fmtW(result.losses.totalW)}`);
  lines.push(`- BOM cost (per unit): ${formatUsd(result.bomCostUsd)}`);
  lines.push(`- Fleet annual savings vs baseline: ${formatUsd(eco.fleetAnnualUsdSaved)}/yr`);
  lines.push(
    `- Payback: ${
      eco.paybackMonths !== null
        ? `${eco.paybackMonths.toFixed(1)} months`
        : "does not pay back at these assumptions"
    }`,
  );
  lines.push(`- CO2 avoided: ${eco.co2SavedTonnesPerYear.toFixed(1)} t/yr`);
  lines.push(`- Compliance: ${verdict.passed ? "PASSED" : "ISSUES FOUND"} — ${verdict.headline}`);
  lines.push("");
  lines.push("## Assumptions behind the $ numbers (editable — not market data)");
  lines.push(`- Energy price: $${a.pricePerMwhUsd}/MWh`);
  lines.push(`- Fleet size: ${a.fleetUnits} unit${a.fleetUnits === 1 ? "" : "s"}`);
  lines.push(`- Horizon: ${a.horizonYears} year${a.horizonYears === 1 ? "" : "s"}`);
  lines.push(`- Baseline efficiency: ${a.baselineEfficiencyPct}% flat`);
  lines.push(`- Operating hours/yr: ${a.hoursPerYear}`);
  lines.push(`- Grid carbon intensity: ${a.carbonKgPerMwh} kg CO2/MWh`);
  lines.push("");
  if (result.warnings.length > 0) {
    lines.push("## Warnings");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("_See /docs for methodology and the sourced ranges behind the default assumptions._");
  return lines.join("\n");
}
