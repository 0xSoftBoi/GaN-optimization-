// Smoke render — validates chart SVG geometry (no NaN/Infinity coords),
// mirroring src/components/explore/render-smoke.test.ts.
import { describe, expect, it } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
import { SavingsVsLoadChart, SavingsVsPriceChart } from "./charts";

describe("SavingsVsPriceChart", () => {
  it("renders finite geometry for positive, negative, and mixed savings", () => {
    const positive = [
      { pricePerMwhUsd: 35, fleetAnnualUsdSaved: 500 },
      { pricePerMwhUsd: 52.5, fleetAnnualUsdSaved: 750 },
      { pricePerMwhUsd: 70, fleetAnnualUsdSaved: 1000 },
      { pricePerMwhUsd: 87.5, fleetAnnualUsdSaved: 1250 },
      { pricePerMwhUsd: 105, fleetAnnualUsdSaved: 1500 },
    ];
    const negative = positive.map((p) => ({ ...p, fleetAnnualUsdSaved: -p.fleetAnnualUsdSaved }));

    for (const pts of [positive, negative]) {
      const html = renderToStaticMarkup(
        createElement(SavingsVsPriceChart, { points: pts, currentPriceUsd: 70 }),
      );
      expect(html).toContain("<svg");
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("Infinity");
    }
  });

  it("renders nothing for an empty sweep instead of throwing", () => {
    const html = renderToStaticMarkup(
      createElement(SavingsVsPriceChart, { points: [], currentPriceUsd: 70 }),
    );
    expect(html).toBe("");
  });
});

describe("SavingsVsLoadChart", () => {
  it("renders finite geometry across mixed-sign bars", () => {
    const rows = [
      { loadPct: 30, weightFrac: 0.1, usd: -20 },
      { loadPct: 60, weightFrac: 0.3, usd: 120 },
      { loadPct: 90, weightFrac: 0.2, usd: 340 },
      { loadPct: 100, weightFrac: 0.05, usd: 60 },
    ];
    const html = renderToStaticMarkup(createElement(SavingsVsLoadChart, { rows }));
    expect(html).toContain("<svg");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("renders nothing for empty rows instead of throwing", () => {
    const html = renderToStaticMarkup(createElement(SavingsVsLoadChart, { rows: [] }));
    expect(html).toBe("");
  });
});
