import { describe, expect, it } from "vitest";
import type { DesignSpec, TopologyId } from "@/lib/types";
import { designCompensator } from "./compensator";

function spec(over: Partial<DesignSpec>): DesignSpec {
  return {
    conversion: "dc-dc",
    vinMinV: 36,
    vinNomV: 48,
    vinMaxV: 60,
    voutV: 12,
    poutW: 500,
    bidirectional: false,
    isolated: false,
    ambientC: 40,
    cooling: "forced-air",
    ...over,
  };
}

/** |H(e^{jw})| of the digital filter (b, a descending powers of z). */
function digitalMag(b: number[], a: number[], theta: number): number {
  const evalPoly = (p: number[]) => {
    let re = 0;
    let im = 0;
    for (const c of p) {
      const r2 = re * Math.cos(theta) - im * Math.sin(theta) + c;
      const i2 = re * Math.sin(theta) + im * Math.cos(theta);
      re = r2;
      im = i2;
    }
    return Math.hypot(re, im);
  };
  return evalPoly(b) / evalPoly(a);
}

// Representative (spec, fsw, L, C) tuples that match each topology's scale.
const CASES: { id: TopologyId; s: DesignSpec; fsw: number; lUh: number; cUf: number }[] = [
  { id: "buck", s: spec({ poutW: 60 }), fsw: 500e3, lUh: 22, cUf: 100 },
  { id: "sync-buck", s: spec({}), fsw: 500e3, lUh: 10, cUf: 200 },
  { id: "interleaved-sync-buck", s: spec({ poutW: 1000 }), fsw: 500e3, lUh: 10, cUf: 400 },
  {
    id: "boost",
    s: spec({ vinMinV: 180, vinNomV: 200, vinMaxV: 240, voutV: 400, poutW: 1000 }),
    fsw: 200e3,
    lUh: 330,
    cUf: 470,
  },
  {
    id: "llc-half-bridge",
    s: spec({ vinMinV: 380, vinNomV: 400, vinMaxV: 420, voutV: 12, poutW: 300, isolated: true }),
    fsw: 500e3,
    lUh: 60,
    cUf: 1000,
  },
  {
    id: "llc-full-bridge",
    s: spec({ vinMinV: 380, vinNomV: 400, vinMaxV: 420, voutV: 48, poutW: 3000, isolated: true }),
    fsw: 250e3,
    lUh: 25,
    cUf: 680,
  },
  {
    id: "psfb",
    s: spec({ vinMinV: 350, vinNomV: 400, vinMaxV: 450, voutV: 48, poutW: 3000, isolated: true }),
    fsw: 150e3,
    lUh: 15,
    cUf: 470,
  },
  {
    id: "dab",
    s: spec({
      vinMinV: 700,
      vinNomV: 800,
      vinMaxV: 900,
      voutV: 48,
      poutW: 5000,
      isolated: true,
      bidirectional: true,
    }),
    fsw: 100e3,
    lUh: 45,
    cUf: 1000,
  },
  {
    id: "totem-pole-pfc",
    s: spec({
      conversion: "ac-dc",
      gridVacRms: 230,
      vinMinV: 370,
      vinNomV: 390,
      vinMaxV: 410,
      voutV: 400,
      poutW: 3600,
    }),
    fsw: 100e3,
    lUh: 250,
    cUf: 1000,
  },
  {
    id: "flyback",
    s: spec({ vinMinV: 90, vinNomV: 110, vinMaxV: 130, voutV: 12, poutW: 60, isolated: true }),
    fsw: 200e3,
    lUh: 15,
    cUf: 220,
  },
  {
    id: "forward-active-clamp",
    s: spec({ vinMinV: 36, vinNomV: 48, vinMaxV: 72, voutV: 12, poutW: 200, isolated: true }),
    fsw: 300e3,
    lUh: 8,
    cUf: 330,
  },
];

describe("designCompensator — universal sanity", () => {
  for (const c of CASES) {
    it(`${c.id}: bounded crossover, healthy phase margin, finite coefficients`, () => {
      const d = designCompensator(c.id, c.s, c.fsw, c.lUh, c.cUf);
      expect(d.crossoverHz).toBeLessThan(c.fsw / 8);
      expect(d.crossoverHz).toBeGreaterThan(c.fsw / 200);
      expect(d.phaseMarginDeg).toBeGreaterThanOrEqual(50);
      expect(d.phaseMarginDeg).toBeLessThan(95);
      expect(d.sampleHz).toBe(c.fsw);
      expect(d.kp).toBeGreaterThan(0);
      expect(d.ki).toBeGreaterThan(0);
      expect(Number.isFinite(d.kp)).toBe(true);
      expect(Number.isFinite(d.ki)).toBe(true);
      expect(d.polesHz[0]).toBe(0); // integrator
      for (const f of [...d.polesHz.slice(1), ...d.zerosHz]) {
        expect(f).toBeGreaterThan(0);
        expect(f).toBeLessThan(c.fsw / 2); // nothing above Nyquist
      }
      expect(d.b.length).toBe(d.a.length);
      for (const x of [...d.b, ...d.a]) expect(Number.isFinite(x)).toBe(true);
      expect(d.a[0]).toBe(1);
      expect(d.notes.length).toBeGreaterThan(1);
    });
  }
});

describe("designCompensator — family behavior", () => {
  it("buck-derived plants get a Type-3 (LC double pole needs ~150° of boost)", () => {
    const d = designCompensator("sync-buck", spec({}), 500e3, 10, 200);
    expect(d.kind).toBe("type-3");
    expect(d.zerosHz.length).toBe(2);
    expect(d.polesHz.length).toBe(3); // integrator + double HF pole
    expect(d.kd).toBeGreaterThan(0);
    // zeros placed below crossover to boost phase through the resonance
    for (const fz of d.zerosHz) expect(fz).toBeLessThan(d.crossoverHz);
  });

  it("keeps the boost crossover at or below RHPZ/3", () => {
    const c = CASES.find((x) => x.id === "boost")!;
    const d = designCompensator("boost", c.s, c.fsw, c.lUh, c.cUf);
    const dNom = 1 - c.s.vinNomV / c.s.voutV;
    const R = (c.s.voutV * c.s.voutV) / c.s.poutW;
    const fRhpz = ((1 - dNom) ** 2 * R) / (c.lUh * 1e-6) / (2 * Math.PI);
    expect(d.crossoverHz).toBeLessThanOrEqual(fRhpz / 3);
    expect(d.notes.join(" ")).toMatch(/RHP/i);
  });

  it("flyback also respects the RHPZ-limited crossover", () => {
    const c = CASES.find((x) => x.id === "flyback")!;
    const d = designCompensator("flyback", c.s, c.fsw, c.lUh, c.cUf);
    const dNom = 0.45;
    const R = (c.s.voutV * c.s.voutV) / c.s.poutW;
    const fRhpz = ((1 - dNom) ** 2 * R) / (dNom * c.lUh * 1e-6) / (2 * Math.PI);
    expect(d.crossoverHz).toBeLessThanOrEqual(fRhpz / 3);
  });

  it("resonant converters get a PI from the charge-control approximation", () => {
    for (const id of ["llc-half-bridge", "llc-full-bridge", "dab"] as const) {
      const c = CASES.find((x) => x.id === id)!;
      const d = designCompensator(id, c.s, c.fsw, c.lUh, c.cUf);
      expect(d.kind).toBe("pi");
      expect(d.zerosHz.length).toBe(1);
      expect(d.kd).toBeUndefined();
    }
  });

  it("totem-pole PFC current loop is a PI on Vout/(sL) with ~60° margin", () => {
    const c = CASES.find((x) => x.id === "totem-pole-pfc")!;
    const d = designCompensator("totem-pole-pfc", c.s, c.fsw, c.lUh, c.cUf);
    expect(d.kind).toBe("pi");
    expect(d.phaseMarginDeg).toBeCloseTo(60, 0);
  });

  it("crossover scales with switching frequency", () => {
    const d200 = designCompensator("sync-buck", spec({}), 200e3, 10, 200);
    const d500 = designCompensator("sync-buck", spec({}), 500e3, 10, 200);
    expect(d500.crossoverHz).toBeGreaterThan(d200.crossoverHz);
  });
});

describe("designCompensator — digital biquad", () => {
  it("has a pure integrator pole (a(z=1) = 0) with positive DC-path gain", () => {
    for (const c of CASES) {
      const d = designCompensator(c.id, c.s, c.fsw, c.lUh, c.cUf);
      const aAt1 = d.a.reduce((s, x) => s + x, 0);
      expect(Math.abs(aAt1)).toBeLessThan(1e-9);
      const bSum = d.b.reduce((s, x) => s + x, 0);
      expect(bSum).toBeGreaterThan(0); // integrator-path residue is positive
    }
  });

  it("gain-matches the analog prototype at the crossover", () => {
    for (const c of CASES) {
      const d = designCompensator(c.id, c.s, c.fsw, c.lUh, c.cUf);
      const theta = (2 * Math.PI * d.crossoverHz) / d.sampleHz;
      // |H(e^{jθc})| equals the analog |Gc(jωc)| = kp by construction
      expect(digitalMag(d.b, d.a, theta) / d.kp).toBeCloseTo(1, 3);
    }
  });

  it("digital gain rises toward DC (integral action)", () => {
    const d = designCompensator("sync-buck", spec({}), 500e3, 10, 200);
    const thetaC = (2 * Math.PI * d.crossoverHz) / d.sampleHz;
    // Deep below the compensator zeros the integrator dominates: 1/f slope.
    // (A type-3 dips between its zeros and fc, so probe well below fz.)
    expect(digitalMag(d.b, d.a, thetaC / 1e4)).toBeGreaterThan(digitalMag(d.b, d.a, thetaC / 1e3));
    expect(digitalMag(d.b, d.a, thetaC / 1e4)).toBeGreaterThan(digitalMag(d.b, d.a, thetaC));
  });
});
