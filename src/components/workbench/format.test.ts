import { describe, expect, it } from "vitest";
import type {
  BomLine,
  DesignResult,
  DeviceLoss,
  LossBreakdown,
  SwitchDevice,
} from "@/lib/types";
import {
  barPath,
  bomToCsv,
  chosenPowerDensity,
  csvEscape,
  fmtHz,
  fmtPct,
  fmtPowerDensity,
  fmtUsd,
  fmtW,
  lossSegments,
  marginBarFrac,
  marginTone,
  niceDomainTicks,
  niceTicks,
  scaleLinear,
} from "./format";

// ---------------------------------------------------------------------------
// Inline fixtures (no data-module import per module rules)
// ---------------------------------------------------------------------------

const FIX_DEVICE: SwitchDevice = {
  id: "FIX650",
  mfr: "FixtureSemi",
  tech: "GaN",
  vdsMaxV: 650,
  idMaxA: 30,
  rdsOnMohm25: 50,
  rdsOnTempco: 0.01,
  qgNc: 6,
  qossNc: 60,
  eossUj: 8,
  qrrNc: 0,
  vgsDriveV: 6,
  vthV: 1.7,
  rthJCcPerW: 0.5,
  pkg: "PQFN 6x8",
  priceUsd1k: 4.2,
  suppliers: ["Digi-Key"],
};

function deviceLoss(over: Partial<DeviceLoss>): DeviceLoss {
  return {
    role: "primary-hs",
    device: FIX_DEVICE,
    positions: 2,
    parallelPerPosition: 1,
    conductionW: 4,
    switchingW: 3,
    cossW: 1,
    gateW: 0.5,
    deadTimeW: 0.5,
    totalW: 9,
    tjC: 95,
    ...over,
  };
}

const FIX_LOSSES: LossBreakdown = {
  devices: [
    deviceLoss({}),
    deviceLoss({ role: "sr", conductionW: 6, switchingW: 0, cossW: 0.4, gateW: 0.6, deadTimeW: 1, totalW: 8 }),
  ],
  magneticsCoreW: 5,
  magneticsCopperW: 7,
  capacitorW: 1.5,
  overheadW: 3,
  totalW: 33.5,
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe("formatting", () => {
  it("fmtW picks SI prefixes", () => {
    expect(fmtW(12.34)).toBe("12.3 W");
    expect(fmtW(1234)).toBe("1.23 kW");
    expect(fmtW(0.5)).toBe("500 mW");
  });

  it("fmtHz handles typical switching frequencies", () => {
    expect(fmtHz(140e3)).toBe("140 kHz");
    expect(fmtHz(1e6)).toBe("1 MHz");
  });

  it("fmtUsd / fmtPct are fixed-point", () => {
    expect(fmtUsd(123.456)).toBe("$123.46");
    expect(fmtPct(97.812)).toBe("97.8%");
  });

  it("fmtUsd groups thousands and keeps cents (BOM-line precision)", () => {
    expect(fmtUsd(12345.678)).toBe("$12,345.68");
    expect(fmtUsd(1234567.8)).toBe("$1,234,567.80");
    expect(fmtUsd(-4200)).toBe("-$4,200.00");
    expect(fmtUsd(0)).toBe("$0.00");
  });

  it("fmtPowerDensity steps to kW/L above 1000 W/L", () => {
    expect(fmtPowerDensity(450)).toBe("450 W/L");
    expect(fmtPowerDensity(2600)).toBe("2.6 kW/L");
  });
});

// ---------------------------------------------------------------------------
// Chart math
// ---------------------------------------------------------------------------

describe("scaleLinear", () => {
  it("maps endpoints and midpoints linearly", () => {
    expect(scaleLinear(0, 0, 10, 0, 100)).toBe(0);
    expect(scaleLinear(10, 0, 10, 0, 100)).toBe(100);
    expect(scaleLinear(5, 0, 10, 100, 200)).toBe(150);
  });

  it("degenerate domain collapses to range start", () => {
    expect(scaleLinear(3, 5, 5, 0, 100)).toBe(0);
  });
});

describe("niceTicks", () => {
  it("produces 4-6 clean ticks over typical loss ranges", () => {
    for (const hi of [0.9, 7, 42, 180, 950, 12345]) {
      const t = niceTicks(0, hi);
      expect(t.length).toBeGreaterThanOrEqual(3);
      expect(t.length).toBeLessThanOrEqual(7);
      expect(t[0]).toBe(0);
      expect(t[t.length - 1]).toBeLessThanOrEqual(hi + 1e-9);
      // monotonic increasing
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    }
  });

  it("handles efficiency-style narrow ranges", () => {
    const t = niceTicks(94.2, 98.6);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.length).toBeLessThanOrEqual(7);
    expect(t[0]).toBeGreaterThanOrEqual(94.2);
    expect(t[t.length - 1]).toBeLessThanOrEqual(98.6);
  });

  it("degenerate span returns the single value", () => {
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});

describe("niceDomainTicks", () => {
  it("snaps a narrow efficiency band outward to 4-6 clean ticks", () => {
    const { d0, d1, ticks } = niceDomainTicks(94.66, 97.74);
    expect(d0).toBeLessThanOrEqual(94.66);
    expect(d1).toBeGreaterThanOrEqual(97.74);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks[0]).toBe(d0);
    expect(ticks[ticks.length - 1]).toBe(d1);
  });

  it("keeps a clean 0-based domain intact", () => {
    const { d0, ticks } = niceDomainTicks(0, 100);
    expect(d0).toBe(0);
    expect(ticks[0]).toBe(0);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThanOrEqual(7);
  });

  it("evenly spaces ticks by a single step", () => {
    const { ticks } = niceDomainTicks(12.3, 87.2);
    const step = ticks[1] - ticks[0];
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 8);
    }
  });
});

describe("barPath", () => {
  it("rounds the data end and closes the path", () => {
    const p = barPath(10, 20, 100, 14);
    expect(p.startsWith("M10,20")).toBe(true);
    expect(p).toContain("a4,4");
    expect(p.endsWith("z")).toBe(true);
  });

  it("shrinks the radius for sliver bars instead of inverting", () => {
    const p = barPath(0, 0, 2, 14);
    expect(p).toContain("a2,2");
  });

  it("empty for non-positive width", () => {
    expect(barPath(0, 0, 0, 14)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Loss segments
// ---------------------------------------------------------------------------

describe("lossSegments", () => {
  it("returns the 9 canonical categories in order", () => {
    const segs = lossSegments(FIX_LOSSES);
    expect(segs.map((s) => s.key)).toEqual([
      "conduction",
      "switching",
      "coss",
      "gate",
      "dead-time",
      "core",
      "copper",
      "cap",
      "overhead",
    ]);
  });

  it("sums device mechanisms across roles and conserves total energy", () => {
    const segs = lossSegments(FIX_LOSSES);
    const byKey = Object.fromEntries(segs.map((s) => [s.key, s.w]));
    expect(byKey["conduction"]).toBeCloseTo(10);
    expect(byKey["switching"]).toBeCloseTo(3);
    expect(byKey["dead-time"]).toBeCloseTo(1.5);
    const total = segs.reduce((s, x) => s + x.w, 0);
    expect(total).toBeCloseTo(FIX_LOSSES.totalW, 6);
  });
});

// ---------------------------------------------------------------------------
// Thermal margin classification
// ---------------------------------------------------------------------------

describe("marginTone", () => {
  it("green above 25, amber 15-25 inclusive, rose below 15", () => {
    expect(marginTone(40)).toBe("ok");
    expect(marginTone(25.01)).toBe("ok");
    expect(marginTone(25)).toBe("tight");
    expect(marginTone(15)).toBe("tight");
    expect(marginTone(14.99)).toBe("low");
    expect(marginTone(-5)).toBe("low");
  });

  it("bar fraction clamps to [0,1] on a 50C scale", () => {
    expect(marginBarFrac(25)).toBeCloseTo(0.5);
    expect(marginBarFrac(500)).toBe(1);
    expect(marginBarFrac(-10)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe("bomToCsv", () => {
  const lines: BomLine[] = [
    {
      ref: ["Q1", "Q2"],
      partId: "FIX650",
      mfr: "FixtureSemi",
      description: '650V GaN FET, 50mΩ, "top-cooled"',
      qty: 2,
      unitPriceUsd: 4.2,
      extPriceUsd: 8.4,
      suppliers: ["Digi-Key", "Mouser"],
    },
    {
      ref: ["L1"],
      partId: "PQ32/20-3C97",
      mfr: "Ferroxcube",
      description: "PQ32/20, 3C97, gapped",
      qty: 1,
      unitPriceUsd: 2.1,
      extPriceUsd: 2.1,
      suppliers: ["Mouser"],
    },
  ];

  it("emits header + one row per line + total row", () => {
    const csv = bomToCsv(lines, 10.5);
    const rows = csv.split("\n");
    expect(rows.length).toBe(1 + lines.length + 1);
    expect(rows[0].startsWith("Refs,Part,Mfr")).toBe(true);
    expect(rows[rows.length - 1]).toContain("TOTAL");
    expect(rows[rows.length - 1]).toContain("10.50");
  });

  it("escapes quotes and commas RFC-4180 style", () => {
    const csv = bomToCsv(lines, 10.5);
    expect(csv).toContain('"650V GaN FET, 50mΩ, ""top-cooled"""');
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
  });
});

// ---------------------------------------------------------------------------
// Power density lookup
// ---------------------------------------------------------------------------

describe("chosenPowerDensity", () => {
  const base = {
    deviceId: "FIX650",
    efficiencyPct: 97,
    bomCostUsd: 100,
    feasible: true,
    pareto: false,
  };

  function resultWith(candidates: DesignResult["candidates"]): DesignResult {
    // Only the fields chosenPowerDensity touches need to be realistic.
    return {
      topology: { id: "dab" },
      fswHz: 140e3,
      candidates,
    } as unknown as DesignResult;
  }

  it("prefers the exact topology+fsw candidate", () => {
    const r = resultWith([
      { ...base, topologyId: "dab", fswHz: 100e3, powerDensityWPerL: 900 },
      { ...base, topologyId: "dab", fswHz: 140e3, powerDensityWPerL: 1200 },
      { ...base, topologyId: "llc-half-bridge", fswHz: 140e3, powerDensityWPerL: 2000 },
    ]);
    expect(chosenPowerDensity(r)).toBe(1200);
  });

  it("falls back to nearest-fsw feasible sibling of the same topology", () => {
    const r = resultWith([
      { ...base, topologyId: "dab", fswHz: 100e3, powerDensityWPerL: 900 },
      { ...base, topologyId: "dab", fswHz: 200e3, powerDensityWPerL: 1500 },
    ]);
    expect(chosenPowerDensity(r)).toBe(900); // 40k away vs 60k away
  });

  it("undefined when no feasible candidate matches the topology", () => {
    const r = resultWith([
      { ...base, topologyId: "dab", fswHz: 140e3, powerDensityWPerL: 1200, feasible: false },
    ]);
    expect(chosenPowerDensity(r)).toBeUndefined();
  });
});
