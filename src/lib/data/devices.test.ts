import { describe, expect, it } from "vitest";
import { SWITCH_DEVICES, findSwitches, getSwitch } from "./devices";

const ALLOWED_SUPPLIERS = new Set(["Digi-Key", "Mouser", "Arrow", "Avnet"]);

describe("SWITCH_DEVICES integrity", () => {
  it("has at least 40 parts", () => {
    expect(SWITCH_DEVICES.length).toBeGreaterThanOrEqual(40);
  });

  it("has unique ids", () => {
    const ids = SWITCH_DEVICES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers GaN, SiC and Si with the named flagship parts", () => {
    for (const id of [
      "NV6128",
      "EPC2218",
      "IGT60R070D1",
      "GS66508T",
      "LMG3522R030",
      "C3M0075120K",
      "IMZ120R030M1H",
      "NVHL080N120SC1",
      "SCT3030AL",
      "SCTW90N65G2V",
      "IPP60R040C7",
    ]) {
      expect(getSwitch(id), id).toBeDefined();
    }
    const byTech = (t: string) => SWITCH_DEVICES.filter((d) => d.tech === t);
    expect(byTech("GaN").length).toBeGreaterThanOrEqual(15);
    expect(byTech("SiC").length).toBeGreaterThanOrEqual(9);
    expect(byTech("Si").length).toBeGreaterThanOrEqual(3);
    expect(byTech("Si").length).toBeLessThanOrEqual(6); // comparison set only
  });

  it("has positive, plausible electrical parameters", () => {
    for (const d of SWITCH_DEVICES) {
      expect(d.vdsMaxV, d.id).toBeGreaterThanOrEqual(80);
      expect(d.vdsMaxV, d.id).toBeLessThanOrEqual(1700);
      expect(d.idMaxA, d.id).toBeGreaterThan(0);
      expect(d.idMaxA, d.id).toBeLessThan(300);
      expect(d.rdsOnMohm25, d.id).toBeGreaterThan(0.5);
      expect(d.rdsOnMohm25, d.id).toBeLessThan(500);
      expect(d.qgNc, d.id).toBeGreaterThan(0);
      expect(d.qossNc, d.id).toBeGreaterThan(0);
      expect(d.eossUj, d.id).toBeGreaterThan(0);
      expect(d.qrrNc, d.id).toBeGreaterThanOrEqual(0);
      expect(d.vthV, d.id).toBeGreaterThan(0);
      expect(d.vthV, d.id).toBeLessThan(d.vgsDriveV); // must enhance at drive rail
      expect(d.rthJCcPerW, d.id).toBeGreaterThan(0.1);
      expect(d.rthJCcPerW, d.id).toBeLessThan(5);
      expect(d.priceUsd1k, d.id).toBeGreaterThan(0.5);
      expect(d.priceUsd1k, d.id).toBeLessThan(100);
      expect(d.pkg.length, d.id).toBeGreaterThan(0);
    }
  });

  it("only lists approved suppliers, at least one each", () => {
    for (const d of SWITCH_DEVICES) {
      expect(d.suppliers.length, d.id).toBeGreaterThan(0);
      for (const s of d.suppliers) expect(ALLOWED_SUPPLIERS.has(s), `${d.id}: ${s}`).toBe(true);
    }
  });

  it("GaN devices have zero reverse-recovery charge", () => {
    for (const d of SWITCH_DEVICES.filter((x) => x.tech === "GaN")) {
      expect(d.qrrNc, d.id).toBe(0);
    }
  });

  it("SiC and Si devices have nonzero body-diode Qrr, Si >> SiC", () => {
    const sic = SWITCH_DEVICES.filter((d) => d.tech === "SiC");
    const si = SWITCH_DEVICES.filter((d) => d.tech === "Si");
    for (const d of [...sic, ...si]) expect(d.qrrNc, d.id).toBeGreaterThan(0);
    const maxSic = Math.max(...sic.map((d) => d.qrrNc));
    const minSi = Math.min(...si.map((d) => d.qrrNc));
    expect(minSi).toBeGreaterThan(maxSic); // SJ minority-carrier storage dominates
  });

  it("Rds(on) tempco falls in the per-technology band", () => {
    const bands = {
      GaN: [0.009, 0.012],
      SiC: [0.004, 0.007],
      Si: [0.008, 0.01],
    } as const;
    for (const d of SWITCH_DEVICES) {
      const [lo, hi] = bands[d.tech];
      expect(d.rdsOnTempco, d.id).toBeGreaterThanOrEqual(lo);
      expect(d.rdsOnTempco, d.id).toBeLessThanOrEqual(hi);
    }
  });

  it("Eoss respects the physical bound E = ∫v dq ≤ Qoss·(Vds/2)", () => {
    for (const d of SWITCH_DEVICES) {
      const boundUj = (d.qossNc * (d.vdsMaxV / 2)) / 1000; // nC·V -> µJ
      expect(d.eossUj, d.id).toBeLessThanOrEqual(boundUj);
      expect(d.eossUj, d.id).toBeGreaterThan(0.01 * boundUj); // not absurdly low
    }
  });

  it("Si superjunction shows charge-heavy Coss: Eoss/(Qoss·Vhalf) far below GaN", () => {
    const ratio = (d: (typeof SWITCH_DEVICES)[number]) =>
      d.eossUj / ((d.qossNc * (d.vdsMaxV / 2)) / 1000);
    const gan650 = SWITCH_DEVICES.filter((d) => d.tech === "GaN" && d.vdsMaxV >= 600);
    const si = SWITCH_DEVICES.filter((d) => d.tech === "Si");
    const meanGan = gan650.reduce((s, d) => s + ratio(d), 0) / gan650.length;
    const meanSi = si.reduce((s, d) => s + ratio(d), 0) / si.length;
    expect(meanSi).toBeLessThan(meanGan / 3);
  });

  it("GaN beats Si on the Rds·Qg hard-switching FOM in the 600-650 V class", () => {
    const fom = (d: (typeof SWITCH_DEVICES)[number]) => d.rdsOnMohm25 * d.qgNc;
    const gan = SWITCH_DEVICES.filter(
      (d) => d.tech === "GaN" && d.vdsMaxV >= 600 && d.vdsMaxV <= 650,
    );
    const si = SWITCH_DEVICES.filter((d) => d.tech === "Si");
    const worstGan = Math.max(...gan.map(fom));
    const bestSi = Math.min(...si.map(fom));
    expect(worstGan).toBeLessThan(bestSi);
  });

  it("price rises monotonically as Rds drops within the Wolfspeed C3M 1200 V family", () => {
    const fam = ["C3M0075120K", "C3M0032120K", "C3M0016120K"].map((id) => getSwitch(id)!);
    expect(fam[0].rdsOnMohm25).toBeGreaterThan(fam[1].rdsOnMohm25);
    expect(fam[1].rdsOnMohm25).toBeGreaterThan(fam[2].rdsOnMohm25);
    expect(fam[0].priceUsd1k).toBeLessThan(fam[1].priceUsd1k);
    expect(fam[1].priceUsd1k).toBeLessThan(fam[2].priceUsd1k);
  });

  it("all 1200 V parts are SiC (no GaN/Si at that node in the DB)", () => {
    for (const d of SWITCH_DEVICES.filter((x) => x.vdsMaxV >= 1200)) {
      expect(d.tech, d.id).toBe("SiC");
    }
  });
});

describe("findSwitches", () => {
  it("returns everything for an empty filter", () => {
    expect(findSwitches({})).toHaveLength(SWITCH_DEVICES.length);
  });

  it("filters by tech", () => {
    const gan = findSwitches({ tech: "GaN" });
    expect(gan.length).toBeGreaterThan(0);
    expect(gan.every((d) => d.tech === "GaN")).toBe(true);
  });

  it("filters by minimum voltage", () => {
    const hv = findSwitches({ minVdsV: 1200 });
    expect(hv.length).toBeGreaterThan(0);
    expect(hv.every((d) => d.vdsMaxV >= 1200)).toBe(true);
    expect(hv.map((d) => d.id)).toContain("C3M0032120K");
  });

  it("filters by minimum current and maximum Rds", () => {
    const r = findSwitches({ minIdA: 50, maxRdsOnMohm: 5 });
    expect(r.length).toBeGreaterThan(0);
    for (const d of r) {
      expect(d.idMaxA).toBeGreaterThanOrEqual(50);
      expect(d.rdsOnMohm25).toBeLessThanOrEqual(5);
    }
  });

  it("tightening a constraint yields a subset", () => {
    const loose = findSwitches({ maxRdsOnMohm: 100 });
    const tight = findSwitches({ maxRdsOnMohm: 30 });
    expect(tight.length).toBeLessThan(loose.length);
    const looseIds = new Set(loose.map((d) => d.id));
    expect(tight.every((d) => looseIds.has(d.id))).toBe(true);
  });

  it("combines all constraints (AND semantics)", () => {
    const r = findSwitches({ tech: "SiC", minVdsV: 1200, minIdA: 60, maxRdsOnMohm: 35 });
    for (const d of r) {
      expect(d.tech).toBe("SiC");
      expect(d.vdsMaxV).toBeGreaterThanOrEqual(1200);
      expect(d.idMaxA).toBeGreaterThanOrEqual(60);
      expect(d.rdsOnMohm25).toBeLessThanOrEqual(35);
    }
    expect(r.map((d) => d.id)).toContain("C3M0032120K");
  });

  it("returns empty for impossible filters", () => {
    expect(findSwitches({ tech: "GaN", minVdsV: 1200 })).toHaveLength(0);
    expect(findSwitches({ maxRdsOnMohm: 0.1 })).toHaveLength(0);
  });
});

describe("getSwitch", () => {
  it("finds by exact id", () => {
    const d = getSwitch("NV6128");
    expect(d?.mfr).toBe("Navitas");
    expect(d?.tech).toBe("GaN");
  });

  it("returns undefined for unknown ids", () => {
    expect(getSwitch("NOT-A-PART")).toBeUndefined();
    expect(getSwitch("nv6128")).toBeUndefined(); // case-sensitive part numbers
  });
});
