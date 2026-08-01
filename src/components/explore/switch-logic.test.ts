import { describe, expect, it } from "vitest";
import type { SwitchDevice } from "@/lib/types";
import {
  COMPARE_MAX,
  EMPTY_FILTER,
  filterSwitches,
  fomMohmNc,
  nextSort,
  normalizedFomBars,
  sortSwitches,
  toggleCompare,
} from "./switch-logic";

/** Inline fixtures — datasheet-plausible, not imported from the data module. */
function dev(over: Partial<SwitchDevice> & { id: string }): SwitchDevice {
  return {
    mfr: "TestCo",
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
    rthJCcPerW: 1.0,
    pkg: "PQFN 6x8",
    priceUsd1k: 3.5,
    suppliers: ["Digi-Key", "Mouser"],
    ...over,
  };
}

const GAN = dev({ id: "GAN650", tech: "GaN", rdsOnMohm25: 50, qgNc: 6, vdsMaxV: 650 });
const SIC = dev({
  id: "SIC1200",
  tech: "SiC",
  rdsOnMohm25: 25,
  qgNc: 45,
  qrrNc: 120,
  vdsMaxV: 1200,
  mfr: "WideBand",
});
const SI = dev({
  id: "SI600",
  tech: "Si",
  rdsOnMohm25: 70,
  qgNc: 90,
  qrrNc: 4000,
  vdsMaxV: 600,
  notes: "superjunction",
});
const ALL = [GAN, SIC, SI];

describe("fomMohmNc", () => {
  it("is Rds·Qg and lower for the GaN part than the Si part", () => {
    expect(fomMohmNc(GAN)).toBeCloseTo(300);
    expect(fomMohmNc(SI)).toBeCloseTo(6300);
    expect(fomMohmNc(GAN)).toBeLessThan(fomMohmNc(SI));
  });
});

describe("normalizedFomBars", () => {
  it("marks the lowest-FoM device best with ratio 1 and scales others up", () => {
    const bars = normalizedFomBars(ALL);
    const gan = bars.find((b) => b.id === "GAN650")!;
    const si = bars.find((b) => b.id === "SI600")!;
    expect(gan.best).toBe(true);
    expect(gan.ratioToBest).toBeCloseTo(1);
    expect(si.ratioToBest).toBeCloseTo(6300 / 300);
    // Bar-length fractions are in (0, 1] and the worst device fills the axis.
    for (const b of bars) {
      expect(b.fracOfWorst).toBeGreaterThan(0);
      expect(b.fracOfWorst).toBeLessThanOrEqual(1);
    }
    expect(si.fracOfWorst).toBeCloseTo(1);
  });

  it("handles an empty set", () => {
    expect(normalizedFomBars([])).toEqual([]);
  });
});

describe("filterSwitches", () => {
  it("passes everything through the empty filter", () => {
    expect(filterSwitches(ALL, EMPTY_FILTER)).toHaveLength(3);
  });

  it("filters by tech", () => {
    const out = filterSwitches(ALL, { ...EMPTY_FILTER, tech: "SiC" });
    expect(out.map((d) => d.id)).toEqual(["SIC1200"]);
  });

  it("filters by Vds range (inclusive bounds)", () => {
    const out = filterSwitches(ALL, { ...EMPTY_FILTER, vdsMinV: 600, vdsMaxV: 650 });
    expect(out.map((d) => d.id).sort()).toEqual(["GAN650", "SI600"]);
  });

  it("matches free text against id, mfr, and notes case-insensitively", () => {
    expect(filterSwitches(ALL, { ...EMPTY_FILTER, q: "wideband" })).toHaveLength(1);
    expect(filterSwitches(ALL, { ...EMPTY_FILTER, q: "SUPERJUNCTION" })).toHaveLength(1);
    expect(filterSwitches(ALL, { ...EMPTY_FILTER, q: "gan650" })).toHaveLength(1);
    expect(filterSwitches(ALL, { ...EMPTY_FILTER, q: "zzz-nope" })).toHaveLength(0);
  });
});

describe("sortSwitches", () => {
  it("sorts numerically ascending and descending", () => {
    const asc = sortSwitches(ALL, "rdsOnMohm25", "asc").map((d) => d.id);
    expect(asc).toEqual(["SIC1200", "GAN650", "SI600"]);
    const desc = sortSwitches(ALL, "rdsOnMohm25", "desc").map((d) => d.id);
    expect(desc).toEqual(["SI600", "GAN650", "SIC1200"]);
  });

  it("sorts by the computed FoM column", () => {
    const asc = sortSwitches(ALL, "fom", "asc").map((d) => d.id);
    expect(asc).toEqual(["GAN650", "SIC1200", "SI600"]);
  });

  it("sorts strings case-insensitively and does not mutate the input", () => {
    const input = [...ALL];
    const byMfr = sortSwitches(input, "mfr", "asc").map((d) => d.mfr);
    expect(byMfr).toEqual(["TestCo", "TestCo", "WideBand"]);
    expect(input.map((d) => d.id)).toEqual(ALL.map((d) => d.id));
  });

  it("is stable for equal keys", () => {
    const out = sortSwitches(ALL, "mfr", "asc").map((d) => d.id);
    // GAN650 and SI600 share mfr "TestCo" — original order preserved.
    expect(out.indexOf("GAN650")).toBeLessThan(out.indexOf("SI600"));
  });
});

describe("nextSort", () => {
  it("toggles direction on the same column, resets to asc on a new one", () => {
    const s0 = { key: "fom" as const, dir: "asc" as const };
    expect(nextSort(s0, "fom")).toEqual({ key: "fom", dir: "desc" });
    expect(nextSort({ key: "fom", dir: "desc" }, "fom")).toEqual({ key: "fom", dir: "asc" });
    expect(nextSort(s0, "priceUsd1k")).toEqual({ key: "priceUsd1k", dir: "asc" });
  });
});

describe("toggleCompare", () => {
  it("adds, removes, and enforces the 4-part tray limit", () => {
    let ids: string[] = [];
    ids = toggleCompare(ids, "a");
    ids = toggleCompare(ids, "b");
    expect(ids).toEqual(["a", "b"]);
    ids = toggleCompare(ids, "a");
    expect(ids).toEqual(["b"]);
    ids = toggleCompare(ids, "c");
    ids = toggleCompare(ids, "d");
    ids = toggleCompare(ids, "e");
    expect(ids).toHaveLength(COMPARE_MAX);
    // Full tray: adding a 5th is a no-op…
    expect(toggleCompare(ids, "f")).toEqual(ids);
    // …but removing a member still works.
    expect(toggleCompare(ids, "b")).not.toContain("b");
  });
});
