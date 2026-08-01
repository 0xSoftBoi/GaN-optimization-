import { describe, expect, it } from "vitest";
import type { DesignSpec, TopologyId, WaveformTrace } from "@/lib/types";
import { mean } from "@/lib/util";
import { dabPhaseShiftRad, dabPowerW, simulate } from "./index";

function makeSpec(over: Partial<DesignSpec> = {}): DesignSpec {
  return {
    conversion: "dc-dc",
    vinMinV: 40,
    vinNomV: 48,
    vinMaxV: 60,
    voutV: 12,
    poutW: 100,
    bidirectional: false,
    isolated: false,
    ambientC: 25,
    cooling: "natural",
    ...over,
  };
}

function getTrace(r: { traces: WaveformTrace[] }, name: string): WaveformTrace {
  const tr = r.traces.find((x) => x.name === name);
  expect(tr, `trace "${name}" present`).toBeDefined();
  return tr as WaveformTrace;
}

describe("sync-buck simulation", () => {
  const spec = makeSpec(); // 48 V -> 12 V, 100 W
  const r = simulate("sync-buck", spec, 500e3, 10, 100);

  it("mean vout within 3 % of spec", () => {
    const vo = mean(getTrace(r, "vout").v);
    expect(Math.abs(vo - spec.voutV) / spec.voutV).toBeLessThan(0.03);
  });

  it("mean iL ~ iout (resistive load vout^2/pout)", () => {
    const iOut = spec.poutW / spec.voutV; // 8.33 A
    const iL = mean(getTrace(r, "iL").v);
    expect(Math.abs(iL - iOut) / iOut).toBeLessThan(0.03);
  });

  it("inductor ripple matches vout(1-D)/(L*fsw) within 10 %", () => {
    const dIdeal = (12 * (1 - 12 / 48)) / (10e-6 * 500e3); // 1.8 A
    expect(r.inductorRippleApp).toBeGreaterThan(0.9 * dIdeal);
    expect(r.inductorRippleApp).toBeLessThan(1.1 * dIdeal);
  });

  it("vsw swings between ~0 and ~vin", () => {
    const vsw = getTrace(r, "vsw").v;
    expect(Math.max(...vsw)).toBeCloseTo(48, 6);
    expect(Math.min(...vsw)).toBeCloseTo(0, 6);
  });

  it("records >= 6 switching periods", () => {
    const t = getTrace(r, "vout").t;
    expect(t[t.length - 1] - t[0]).toBeGreaterThanOrEqual(6 / 500e3);
  });

  it("vout ripple shrinks with bigger C", () => {
    const small = simulate("sync-buck", spec, 500e3, 10, 47);
    const big = simulate("sync-buck", spec, 500e3, 10, 470);
    expect(big.voutRippleVpp).toBeLessThan(small.voutRippleVpp);
    expect(small.voutRippleVpp).toBeGreaterThan(0);
  });

  it("vout ripple grows with smaller L (bigger current ripple)", () => {
    const bigL = simulate("sync-buck", spec, 500e3, 22, 100);
    const smallL = simulate("sync-buck", spec, 500e3, 4.7, 100);
    expect(smallL.inductorRippleApp).toBeGreaterThan(bigL.inductorRippleApp);
    expect(smallL.voutRippleVpp).toBeGreaterThan(bigL.voutRippleVpp);
  });
});

describe("boost simulation", () => {
  const spec = makeSpec({ vinMinV: 160, vinNomV: 200, vinMaxV: 240, voutV: 400, poutW: 1000 });
  const r = simulate("boost", spec, 100e3, 200, 100);

  it("mean vout within 3 % of spec", () => {
    const vo = mean(getTrace(r, "vout").v);
    expect(Math.abs(vo - 400) / 400).toBeLessThan(0.03);
  });

  it("mean iL ~ input current pout/vin", () => {
    const iIn = 1000 / 200; // 5 A
    const iL = mean(getTrace(r, "iL").v);
    expect(Math.abs(iL - iIn) / iIn).toBeLessThan(0.05);
  });

  it("inductor ripple ~ vin*D/(L*fsw)", () => {
    const dIdeal = (200 * 0.5) / (200e-6 * 100e3); // 5 A
    expect(r.inductorRippleApp).toBeGreaterThan(0.85 * dIdeal);
    expect(r.inductorRippleApp).toBeLessThan(1.15 * dIdeal);
  });

  it("vsw peaks near vout when the switch is off", () => {
    const vsw = getTrace(r, "vsw").v;
    expect(Math.max(...vsw)).toBeGreaterThan(380);
    expect(Math.min(...vsw)).toBeCloseTo(0, 6);
  });
});

describe("interleaved sync-buck simulation", () => {
  const spec = makeSpec({ vinMinV: 10, vinNomV: 12, vinMaxV: 14, voutV: 5, poutW: 60 });
  const r = simulate("interleaved-sync-buck", spec, 500e3, 2.2, 200);

  it("mean vout within 3 %", () => {
    const vo = mean(getTrace(r, "vout").v);
    expect(Math.abs(vo - 5) / 5).toBeLessThan(0.03);
  });

  it("phases share the load current equally", () => {
    const i1 = mean(getTrace(r, "iL").v);
    const i2 = mean(getTrace(r, "iL2").v);
    const iOut = 60 / 5;
    expect(Math.abs(i1 + i2 - iOut) / iOut).toBeLessThan(0.03);
    expect(Math.abs(i1 - i2)).toBeLessThan(0.05 * iOut);
  });

  it("summed current ripple is smaller than per-phase ripple (cancellation)", () => {
    const iTot = getTrace(r, "iLtot").v;
    const last = iTot.slice(-800); // one switching period
    const ppTot = Math.max(...last) - Math.min(...last);
    expect(ppTot).toBeLessThan(r.inductorRippleApp);
  });
});

describe("DAB simulation", () => {
  const spec = makeSpec({
    vinMinV: 360,
    vinNomV: 400,
    vinMaxV: 440,
    voutV: 48,
    poutW: 2000,
    isolated: true,
    bidirectional: true,
  });
  const n = 400 / 48;

  it("power sign flips with phase shift", () => {
    const phi = dabPhaseShiftRad(2000, 400, 48, n, 100e3, 38e-6);
    expect(phi).toBeGreaterThan(0);
    expect(dabPowerW(phi, 400, 48, n, 100e3, 38e-6)).toBeGreaterThan(0);
    expect(dabPowerW(-phi, 400, 48, n, 100e3, 38e-6)).toBeLessThan(0);
    expect(dabPhaseShiftRad(-2000, 400, 48, n, 100e3, 38e-6)).toBeLessThan(0);
  });

  it("phase solver round-trips through the power equation", () => {
    const phi = dabPhaseShiftRad(2000, 400, 48, n, 100e3, 38e-6);
    expect(dabPowerW(phi, 400, 48, n, 100e3, 38e-6)).toBeCloseTo(2000, 3);
  });

  it("more phase shift -> more power (up to pi/2)", () => {
    const p1 = dabPowerW(0.2, 400, 48, n, 100e3, 38e-6);
    const p2 = dabPowerW(0.4, 400, 48, n, 100e3, 38e-6);
    const p3 = dabPowerW(Math.PI / 2, 400, 48, n, 100e3, 38e-6);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
  });

  it("simulated vout settles near spec (open loop, small droop allowed)", () => {
    const r = simulate("dab", spec, 100e3, 38, 470);
    const vo = mean(getTrace(r, "vout").v);
    expect(Math.abs(vo - 48) / 48).toBeLessThan(0.1);
  });

  it("iL trapezoid is half-wave symmetric (near-zero mean) and bridge voltages square", () => {
    const r = simulate("dab", spec, 100e3, 38, 470);
    const iL = getTrace(r, "iL");
    const iPk = Math.max(...iL.v.map(Math.abs));
    expect(Math.abs(mean(iL.v))).toBeLessThan(0.1 * iPk);
    const vpri = getTrace(r, "vpri").v;
    expect(Math.max(...vpri)).toBeCloseTo(400, 6);
    expect(Math.min(...vpri)).toBeCloseTo(-400, 6);
  });
});

describe("totem-pole PFC simulation", () => {
  const spec = makeSpec({
    conversion: "ac-dc",
    vinMinV: 90,
    vinNomV: 325,
    vinMaxV: 373,
    voutV: 400,
    poutW: 3000,
    gridVacRms: 230,
  });
  const r = simulate("totem-pole-pfc", spec, 100e3, 300, 1360);

  it("line current is sinusoidal with peak ~ sqrt(2)*P/Vrms", () => {
    const iL = getTrace(r, "iL").v;
    const iPk = Math.max(...iL.map(Math.abs));
    const iPkIdeal = (Math.SQRT2 * 3000) / 230; // 18.4 A
    expect(Math.abs(iPk - iPkIdeal) / iPkIdeal).toBeLessThan(0.05);
  });

  it("bus ripple matches P/(pi*f_ripple*C*V) charge balance within 40 %", () => {
    // 2x line frequency ripple: Vpp = 2*(P/V)/(2*pi*100*C)
    const vppIdeal = (2 * (3000 / 400)) / (2 * Math.PI * 100 * 1360e-6);
    expect(r.voutRippleVpp).toBeGreaterThan(0.6 * vppIdeal);
    expect(r.voutRippleVpp).toBeLessThan(1.4 * vppIdeal);
  });

  it("mean bus voltage near 400 V and switching ripple estimate positive", () => {
    const vo = mean(getTrace(r, "vout").v);
    expect(Math.abs(vo - 400) / 400).toBeLessThan(0.05);
    expect(r.inductorRippleApp).toBeGreaterThan(0);
    // vbus/(4*L*fsw) worst case = 3.33 A
    expect(r.inductorRippleApp).toBeCloseTo(400 / (4 * 300e-6 * 100e3), 3);
  });
});

describe("approximated topologies (llc, psfb, flyback, forward)", () => {
  const cases: { id: TopologyId; spec: DesignSpec; lUh: number; cUf: number; fsw: number }[] = [
    {
      id: "llc-half-bridge",
      spec: makeSpec({ vinNomV: 400, vinMinV: 360, vinMaxV: 440, voutV: 48, poutW: 500, isolated: true }),
      lUh: 25,
      cUf: 220,
      fsw: 250e3,
    },
    {
      id: "llc-full-bridge",
      spec: makeSpec({ vinNomV: 400, vinMinV: 360, vinMaxV: 440, voutV: 48, poutW: 1000, isolated: true }),
      lUh: 25,
      cUf: 220,
      fsw: 250e3,
    },
    {
      id: "psfb",
      spec: makeSpec({ vinNomV: 400, vinMinV: 360, vinMaxV: 440, voutV: 12, poutW: 600, isolated: true }),
      lUh: 4.7,
      cUf: 470,
      fsw: 150e3,
    },
    {
      id: "flyback",
      spec: makeSpec({ voutV: 12, poutW: 30 }),
      lUh: 40,
      cUf: 220,
      fsw: 100e3,
    },
    {
      id: "forward-active-clamp",
      spec: makeSpec({ voutV: 12, poutW: 150 }),
      lUh: 15,
      cUf: 220,
      fsw: 200e3,
    },
  ];

  for (const c of cases) {
    it(`${c.id}: notes flag approximation, vout near spec, primary current present`, () => {
      const r = simulate(c.id, c.spec, c.fsw, c.lUh, c.cUf);
      expect(r.notes.join(" ")).toMatch(/approximate/i);
      const vo = mean(getTrace(r, "vout").v);
      expect(Math.abs(vo - c.spec.voutV) / c.spec.voutV).toBeLessThan(0.05);
      const iPri = getTrace(r, r.traces.some((x) => x.name === "ipri") ? "ipri" : "iL");
      expect(Math.max(...iPri.v.map(Math.abs))).toBeGreaterThan(0);
    });
  }

  it("flyback secondary current averages to the load current", () => {
    const spec = makeSpec({ voutV: 12, poutW: 30 });
    const r = simulate("flyback", spec, 100e3, 40, 220);
    const iSec = mean(getTrace(r, "isec").v);
    expect(Math.abs(iSec - 30 / 12) / (30 / 12)).toBeLessThan(0.05);
  });
});

describe("all topologies: trace hygiene", () => {
  const dcSpec = makeSpec();
  const isoSpec = makeSpec({ vinNomV: 400, vinMinV: 360, vinMaxV: 440, voutV: 48, poutW: 1000, isolated: true });
  const pfcSpec = makeSpec({ conversion: "ac-dc", vinNomV: 325, voutV: 400, poutW: 3000, gridVacRms: 230 });

  const runs: [TopologyId, DesignSpec][] = [
    ["buck", dcSpec],
    ["sync-buck", dcSpec],
    ["interleaved-sync-buck", dcSpec],
    ["boost", makeSpec({ vinNomV: 200, voutV: 400, poutW: 1000 })],
    ["llc-half-bridge", isoSpec],
    ["llc-full-bridge", isoSpec],
    ["psfb", isoSpec],
    ["dab", isoSpec],
    ["totem-pole-pfc", pfcSpec],
    ["flyback", makeSpec({ voutV: 12, poutW: 30 })],
    ["forward-active-clamp", makeSpec({ voutV: 12, poutW: 150 })],
  ];

  for (const [id, spec] of runs) {
    it(`${id}: finite, equal-length t/v, ripples defined, has vout+iL`, () => {
      const r = simulate(id, spec, 200e3, 22, 220);
      expect(r.topologyId).toBe(id);
      expect(r.traces.length).toBeGreaterThanOrEqual(2);
      const names = r.traces.map((tr) => tr.name);
      expect(names).toContain("vout");
      expect(names).toContain("iL");
      for (const tr of r.traces) {
        expect(tr.t.length).toBe(tr.v.length);
        expect(tr.t.length).toBeGreaterThan(400);
        expect(tr.unit.length).toBeGreaterThan(0);
        for (const x of tr.t) expect(Number.isFinite(x)).toBe(true);
        for (const x of tr.v) expect(Number.isFinite(x)).toBe(true);
        // time strictly increasing
        for (let i = 1; i < tr.t.length; i++) expect(tr.t[i]).toBeGreaterThan(tr.t[i - 1]);
      }
      expect(Number.isFinite(r.voutRippleVpp)).toBe(true);
      expect(Number.isFinite(r.inductorRippleApp)).toBe(true);
      expect(r.voutRippleVpp).toBeGreaterThanOrEqual(0);
      expect(r.inductorRippleApp).toBeGreaterThanOrEqual(0);
    });
  }

  it("throws on non-physical inputs", () => {
    expect(() => simulate("sync-buck", dcSpec, 0, 10, 100)).toThrow();
    expect(() => simulate("sync-buck", dcSpec, 500e3, -1, 100)).toThrow();
    expect(() => simulate("sync-buck", dcSpec, 500e3, 10, 0)).toThrow();
  });
});
