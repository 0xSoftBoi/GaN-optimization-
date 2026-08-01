import { describe, expect, it } from "vitest";
import type {
  DesignSpec,
  DeviceLoss,
  Heatsink,
  LossBreakdown,
  SwitchDevice,
} from "@/lib/types";
import {
  COLD_PLATE_RTH_SA_C_PER_W,
  FALLBACK_HEATSINKS,
  RTH_CS_C_PER_W,
  SELECTION_MARGIN_C,
  iterateThermal,
  sinkRthSa,
  solveThermal,
} from "./index";

// ---------------------------------------------------------------------------
// Inline fixtures (no data-module import per module rules)
// ---------------------------------------------------------------------------

const GAN650: SwitchDevice = {
  id: "TEST-GAN-650",
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
  rthJCcPerW: 0.9,
  pkg: "PQFN 8x8",
  priceUsd1k: 3.5,
  suppliers: ["Digi-Key"],
};

function makeDeviceLoss(
  totalW: number,
  positions = 2,
  parallelPerPosition = 1,
  role = "primary-hs",
): DeviceLoss {
  const per = totalW / (positions * parallelPerPosition);
  return {
    role,
    device: GAN650,
    positions,
    parallelPerPosition,
    conductionW: per * 0.6,
    switchingW: per * 0.3,
    cossW: per * 0.05,
    gateW: per * 0.03,
    deadTimeW: per * 0.02,
    totalW,
    tjC: 25,
  };
}

function makeBreakdown(deviceLosses: DeviceLoss[]): LossBreakdown {
  const devW = deviceLosses.reduce((s, d) => s + d.totalW, 0);
  return {
    devices: deviceLosses,
    magneticsCoreW: 2,
    magneticsCopperW: 2,
    capacitorW: 0.5,
    overheadW: 1,
    totalW: devW + 5.5,
  };
}

function makeSpec(over: Partial<DesignSpec> = {}): DesignSpec {
  return {
    conversion: "dc-dc",
    vinMinV: 360,
    vinNomV: 400,
    vinMaxV: 450,
    voutV: 48,
    poutW: 1000,
    bidirectional: false,
    isolated: true,
    ambientC: 40,
    cooling: "forced-air",
    ...over,
  };
}

const ONE_SINK: Heatsink[] = [
  {
    id: "HS-TEST",
    mfr: "TestCo",
    rthSaCPerWNatural: 8,
    rthSaCPerWForced: 3,
    heightMm: 25,
    footprintMm: [40, 40],
    priceUsd: 2,
  },
];

// ---------------------------------------------------------------------------
// solveThermal
// ---------------------------------------------------------------------------

describe("solveThermal", () => {
  it("produces plausible Tj above ambient with a heatsink attached", () => {
    const rep = solveThermal(makeBreakdown([makeDeviceLoss(10)]), makeSpec());
    expect(rep.nodes).toHaveLength(1);
    expect(rep.heatsink).toBeDefined();
    expect(rep.nodes[0].tjC).toBeGreaterThan(40);
    expect(rep.nodes[0].tjC).toBeLessThan(125);
    expect(rep.ok).toBe(true);
    // Hand check: sink 40 + 10·RthSA; node adds 5 W · (0.9+0.5)/1.
    const rthSa = sinkRthSa(rep.heatsink!, "forced-air");
    const expected = 40 + 10 * rthSa + 5 * (0.9 + RTH_CS_C_PER_W);
    expect(rep.nodes[0].tjC).toBeCloseTo(expected, 1);
  });

  it("hotter ambient shrinks the margin", () => {
    const losses = makeBreakdown([makeDeviceLoss(10)]);
    const cool = solveThermal(losses, makeSpec({ ambientC: 25 }), ONE_SINK);
    const hot = solveThermal(losses, makeSpec({ ambientC: 60 }), ONE_SINK);
    expect(hot.worstMarginC).toBeLessThan(cool.worstMarginC);
    expect(cool.worstMarginC - hot.worstMarginC).toBeCloseTo(35, 1);
  });

  it("forced air beats natural convection on the same sink", () => {
    const losses = makeBreakdown([makeDeviceLoss(10)]);
    const natural = solveThermal(
      losses,
      makeSpec({ cooling: "natural" }),
      ONE_SINK,
    );
    const forced = solveThermal(
      losses,
      makeSpec({ cooling: "forced-air" }),
      ONE_SINK,
    );
    expect(forced.worstMarginC).toBeGreaterThan(natural.worstMarginC);
    // ΔTj = P·(RthNat − RthForced) = 10·(8−3) = 50 °C
    expect(forced.worstMarginC - natural.worstMarginC).toBeCloseTo(50, 1);
  });

  it("Tj is monotonic in dissipated power", () => {
    const spec = makeSpec();
    const tjAt = (w: number) =>
      solveThermal(makeBreakdown([makeDeviceLoss(w)]), spec, ONE_SINK).nodes[0]
        .tjC;
    expect(tjAt(5)).toBeLessThan(tjAt(10));
    expect(tjAt(10)).toBeLessThan(tjAt(20));
  });

  it("picks the cheapest heatsink meeting Tj,max with 15 °C margin", () => {
    const cheapest = Math.min(...FALLBACK_HEATSINKS.map((h) => h.priceUsd));
    const light = solveThermal(makeBreakdown([makeDeviceLoss(2)]), makeSpec());
    expect(light.heatsink!.priceUsd).toBe(cheapest);
    expect(light.worstMarginC).toBeGreaterThanOrEqual(SELECTION_MARGIN_C);

    const heavy = solveThermal(makeBreakdown([makeDeviceLoss(40)]), makeSpec());
    expect(heavy.heatsink!.priceUsd).toBeGreaterThan(light.heatsink!.priceUsd);
    expect(heavy.worstMarginC).toBeGreaterThanOrEqual(SELECTION_MARGIN_C);
  });

  it("respects the height limit when a fitting sink exists", () => {
    const rep = solveThermal(
      makeBreakdown([makeDeviceLoss(10)]),
      makeSpec({ heightLimitMm: 30 }),
    );
    expect(rep.heatsink!.heightMm).toBeLessThanOrEqual(30);
  });

  it("liquid / cold-plate cooling uses a low fixed RthSA and no catalog sink", () => {
    const losses = makeBreakdown([makeDeviceLoss(10)]);
    const rep = solveThermal(losses, makeSpec({ cooling: "liquid" }));
    expect(rep.heatsink).toBeUndefined();
    const expected = 40 + 10 * COLD_PLATE_RTH_SA_C_PER_W + 5 * 1.4;
    expect(rep.nodes[0].tjC).toBeCloseTo(expected, 1);
    // Cold plate should beat any air-cooled option at the same losses.
    const air = solveThermal(losses, makeSpec({ cooling: "natural" }));
    expect(rep.worstMarginC).toBeGreaterThan(air.worstMarginC);
  });

  it("flags an unsolvable design (ok=false) instead of hiding it", () => {
    const rep = solveThermal(
      makeBreakdown([makeDeviceLoss(200)]),
      makeSpec({ cooling: "natural" }),
    );
    expect(rep.ok).toBe(false);
    expect(rep.worstMarginC).toBeLessThan(0);
  });

  it("parallel devices lower the per-position junction rise", () => {
    const spec = makeSpec();
    const single = solveThermal(
      makeBreakdown([makeDeviceLoss(20, 2, 1)]),
      spec,
      ONE_SINK,
    );
    const dual = solveThermal(
      makeBreakdown([makeDeviceLoss(20, 2, 2)]),
      spec,
      ONE_SINK,
    );
    expect(dual.nodes[0].tjC).toBeLessThan(single.nodes[0].tjC);
  });
});

// ---------------------------------------------------------------------------
// iterateThermal
// ---------------------------------------------------------------------------

describe("iterateThermal", () => {
  /** Rds(on) tempco model: conduction loss grows ~0.8 %/°C above 25 °C. */
  function makeEval(baseW: number) {
    let calls = 0;
    const fn = (tjC: number): LossBreakdown => {
      calls++;
      const scale = 1 + 0.008 * (tjC - 25);
      const d = makeDeviceLoss(baseW * scale, 1, 1);
      d.tjC = tjC;
      return makeBreakdown([d]);
    };
    return { fn, callCount: () => calls };
  }

  it("converges to a self-consistent electro-thermal fixed point", () => {
    const { fn, callCount } = makeEval(8);
    const { losses, thermal } = iterateThermal(makeSpec(), fn);
    // <=10 recomputes after the initial evaluation
    expect(callCount()).toBeLessThanOrEqual(11);
    // Returned pair is consistent: solved Tj within ~1 °C of the Tj the
    // losses were evaluated at.
    const tjEval = losses.devices[0].tjC;
    const tjSolved = Math.max(...thermal.nodes.map((n) => n.tjC));
    expect(Math.abs(tjSolved - tjEval)).toBeLessThan(1.5);
    expect(thermal.ok).toBe(true);
  });

  it("hot converged losses exceed the cold-junction estimate", () => {
    const { fn } = makeEval(8);
    const { losses } = iterateThermal(makeSpec(), fn);
    const coldW = fn(25).devices[0].totalW;
    expect(losses.devices[0].totalW).toBeGreaterThan(coldW);
  });

  it("hotter ambient converges to a hotter junction", () => {
    const a = iterateThermal(makeSpec({ ambientC: 25 }), makeEval(8).fn, ONE_SINK);
    const b = iterateThermal(makeSpec({ ambientC: 55 }), makeEval(8).fn, ONE_SINK);
    const tj = (r: typeof a) => Math.max(...r.thermal.nodes.map((n) => n.tjC));
    expect(tj(b)).toBeGreaterThan(tj(a));
  });
});
