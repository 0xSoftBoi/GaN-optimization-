// TEMPORARY smoke render — validates chart SVG geometry (no NaN coords).
import { describe, expect, it } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// vitest's esbuild transform emits classic JSX (React.createElement) for the
// .tsx sources; provide the global it expects.
(globalThis as { React?: unknown }).React = React;
import type { DesignCandidateSummary, SwitchDevice } from "@/lib/types";
import FomBarChart from "./FomBarChart";
import ParetoChart from "./ParetoChart";

function dev(id: string, rds: number, qg: number): SwitchDevice {
  return {
    id,
    mfr: "T",
    tech: "GaN",
    vdsMaxV: 650,
    idMaxA: 30,
    rdsOnMohm25: rds,
    rdsOnTempco: 0.01,
    qgNc: qg,
    qossNc: 60,
    eossUj: 8,
    qrrNc: 0,
    vgsDriveV: 6,
    vthV: 1.7,
    rthJCcPerW: 1,
    pkg: "PQFN",
    priceUsd1k: 3,
    suppliers: ["Digi-Key"],
  };
}

function cand(i: number, pareto: boolean, feasible: boolean): DesignCandidateSummary {
  return {
    topologyId: "dab",
    deviceId: `D${i}`,
    fswHz: 100e3 + i * 50e3,
    efficiencyPct: 94 + i * 0.5,
    bomCostUsd: 100 + i * 30,
    powerDensityWPerL: 1000 + i * 400,
    feasible,
    pareto,
  };
}

describe("chart smoke render", () => {
  it("FomBarChart renders finite geometry", () => {
    const html = renderToStaticMarkup(
      createElement(FomBarChart, { devices: [dev("A", 50, 6), dev("B", 25, 45), dev("C", 70, 90)] }),
    );
    expect(html).toContain("<svg");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("ParetoChart renders finite geometry incl. infeasible rings", () => {
    const cands = [cand(0, false, true), cand(1, true, true), cand(2, true, true), cand(3, false, false)];
    const html = renderToStaticMarkup(
      createElement(ParetoChart, {
        candidates: cands,
        selectedKey: null,
        onHover: () => {},
        onSelect: () => {},
      }),
    );
    expect(html).toContain("<svg");
    expect(html).toContain("polyline"); // pareto front connector
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});
