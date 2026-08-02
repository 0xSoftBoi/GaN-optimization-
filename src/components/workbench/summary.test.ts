import { describe, expect, it } from "vitest";
import type { ComplianceReport, DesignResult } from "@/lib/types";
import type { EconomicsAssumptions, EnergyEconomics } from "@/lib/economics";
import {
  buildSummaryMarkdown,
  complianceConsequence,
  complianceVerdict,
  friendlyErrorMessage,
  impactSentence,
} from "./summary";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function assumptions(over: Partial<EconomicsAssumptions> = {}): EconomicsAssumptions {
  return {
    pricePerMwhUsd: 70,
    hoursPerYear: 8760,
    loadProfile: [{ loadPct: 75, weight: 1 }],
    baselineEfficiencyPct: 96.5,
    fleetUnits: 500,
    horizonYears: 5,
    carbonKgPerMwh: 350,
    ...over,
  };
}

function eco(over: Partial<EnergyEconomics> = {}): EnergyEconomics {
  return {
    weightedEfficiencyPct: 98,
    baselineWeightedPct: 96.5,
    annualMwhPerUnit: 10,
    annualMwhSavedPerUnit: 0.5,
    annualUsdSavedPerUnit: 40,
    fleetAnnualUsdSaved: 20000,
    fleetHorizonUsdSaved: 100000,
    unitBomCostUsd: 200,
    paybackMonths: 8,
    co2SavedTonnesPerYear: 87.5,
    lossAtProfileW: 100,
    sensitivity: [],
    ...over,
  };
}

function stubResult(over: Partial<DesignResult> = {}): DesignResult {
  return {
    spec: {
      name: "5 kW bidirectional 800 V → 48 V",
      conversion: "dc-dc",
      vinNomV: 800,
      voutV: 48,
      poutW: 5000,
      isolated: true,
      bidirectional: true,
      ambientC: 40,
      cooling: "forced-air",
    },
    topology: { id: "dab", name: "Dual active bridge" },
    efficiencyPct: 97.8,
    losses: { totalW: 112 },
    bomCostUsd: 200,
    compliance: { passed: true, findings: [] },
    warnings: [],
    ...over,
  } as unknown as DesignResult;
}

// ---------------------------------------------------------------------------
// impactSentence
// ---------------------------------------------------------------------------

describe("impactSentence", () => {
  it("states price, fleet size, payback and savings when the design wins", () => {
    const s = impactSentence(assumptions(), eco());
    expect(s).toContain("$70/MWh");
    expect(s).toContain("500 units");
    expect(s).toContain("8 months");
    expect(s).toContain("$20k/yr");
    expect(s).toContain("96.5% baseline");
    expect(s).toMatch(/assumptions editable/i);
  });

  it("singularizes a fleet of one unit", () => {
    const s = impactSentence(assumptions({ fleetUnits: 1 }), eco({ fleetAnnualUsdSaved: 35 }));
    expect(s).toContain("this unit");
    expect(s).not.toContain("1 units");
  });

  it("rounds sub-month paybacks to 'under a month' instead of 0 months", () => {
    const s = impactSentence(assumptions(), eco({ paybackMonths: 0.4 }));
    expect(s).toContain("under a month");
  });

  it("is honest when the design loses to baseline — no fake payback", () => {
    const s = impactSentence(
      assumptions(),
      eco({ annualUsdSavedPerUnit: -10, fleetAnnualUsdSaved: -5000, paybackMonths: null }),
    );
    expect(s).toMatch(/does not beat/i);
    expect(s).toContain("$5k/yr more");
    expect(s).not.toMatch(/returns its BOM cost/);
  });
});

// ---------------------------------------------------------------------------
// friendlyErrorMessage
// ---------------------------------------------------------------------------

describe("friendlyErrorMessage", () => {
  it("distinguishes client (4xx) from server (5xx) errors", () => {
    expect(friendlyErrorMessage("HTTP 400 — Invalid design spec")).toMatch(/could not be processed/i);
    expect(friendlyErrorMessage("HTTP 500 — engine error")).toMatch(/internal error/i);
  });

  it("flags network interruptions distinctly", () => {
    expect(friendlyErrorMessage("Failed to fetch")).toMatch(/connection/i);
  });

  it("falls back to a generic message for anything else", () => {
    expect(friendlyErrorMessage("boom")).toBe("The engine could not complete this design.");
  });

  it("never returns the raw technical string verbatim", () => {
    const raw = "HTTP 500 — TypeError: cannot read property 'x' of undefined at engine.ts:42";
    expect(friendlyErrorMessage(raw)).not.toContain("TypeError");
  });
});

// ---------------------------------------------------------------------------
// complianceVerdict / complianceConsequence
// ---------------------------------------------------------------------------

describe("complianceVerdict", () => {
  it("clean pass with no warnings", () => {
    const r: ComplianceReport = { passed: true, findings: [] };
    const v = complianceVerdict(r);
    expect(v.passed).toBe(true);
    expect(v.failCount).toBe(0);
    expect(v.headline).toMatch(/no issues/i);
  });

  it("pass with warnings surfaces the count", () => {
    const r: ComplianceReport = {
      passed: true,
      findings: [
        { rule: "tj-margin", severity: "warn", detail: "tight" },
        { rule: "output-ripple", severity: "pass", detail: "ok" },
      ],
    };
    const v = complianceVerdict(r);
    expect(v.passed).toBe(true);
    expect(v.warnCount).toBe(1);
    expect(v.headline).toContain("1 item");
  });

  it("fail counts block sign-off in the headline", () => {
    const r: ComplianceReport = {
      passed: false,
      findings: [
        { rule: "creepage-clearance", severity: "fail", detail: "insufficient" },
        { rule: "tj-margin", severity: "fail", detail: "over limit" },
      ],
    };
    const v = complianceVerdict(r);
    expect(v.failCount).toBe(2);
    expect(v.headline).toMatch(/2 issues block production sign-off/);
  });
});

describe("complianceConsequence", () => {
  it("maps known rules to a specific business consequence", () => {
    expect(complianceConsequence("creepage-clearance")).toMatch(/safety certification/i);
    expect(complianceConsequence("tj-margin")).toMatch(/thermal sign-off/i);
  });

  it("falls back to a generic consequence for unknown rules", () => {
    expect(complianceConsequence("some-future-rule")).toMatch(/signed off/i);
  });
});

// ---------------------------------------------------------------------------
// buildSummaryMarkdown
// ---------------------------------------------------------------------------

describe("buildSummaryMarkdown", () => {
  it("includes spec, headline numbers, and every editable assumption", () => {
    const md = buildSummaryMarkdown(stubResult(), assumptions(), eco());
    expect(md).toContain("5 kW bidirectional 800 V");
    expect(md).toContain("800 V → 48 V");
    expect(md).toContain("Dual active bridge");
    expect(md).toContain("$20k/yr");
    expect(md).toContain("8.0 months");
    expect(md).toContain("$70/MWh");
    expect(md).toContain("500 units");
    expect(md).toContain("editable — not market data");
    expect(md).toContain("PASSED");
  });

  it("reports a null payback honestly instead of a fabricated number", () => {
    const md = buildSummaryMarkdown(stubResult(), assumptions(), eco({ paybackMonths: null }));
    expect(md).toMatch(/does not pay back/i);
  });

  it("omits the Warnings section when there are none, includes it when present", () => {
    const clean = buildSummaryMarkdown(stubResult({ warnings: [] }), assumptions(), eco());
    expect(clean).not.toContain("## Warnings");

    const warned = buildSummaryMarkdown(
      stubResult({ warnings: ["Thermal margin tight on primary FET"] }),
      assumptions(),
      eco(),
    );
    expect(warned).toContain("## Warnings");
    expect(warned).toContain("Thermal margin tight on primary FET");
  });

  it("surfaces ISSUES FOUND when compliance failed", () => {
    const md = buildSummaryMarkdown(
      stubResult({
        compliance: {
          passed: false,
          findings: [{ rule: "tj-margin", severity: "fail", detail: "over limit" }],
        },
      }),
      assumptions(),
      eco(),
    );
    expect(md).toContain("ISSUES FOUND");
  });
});
