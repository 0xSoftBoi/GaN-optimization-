import { describe, expect, it } from "vitest";
import type { DesignSpec, TopologyId } from "@/lib/types";
import { operatingPoints } from "./operating-points";

function spec(over: Partial<DesignSpec>): DesignSpec {
  return {
    conversion: "dc-dc",
    vinMinV: 36,
    vinNomV: 48,
    vinMaxV: 60,
    voutV: 12,
    poutW: 240,
    bidirectional: false,
    isolated: false,
    ambientC: 40,
    cooling: "forced-air",
    ...over,
  };
}

/** A spec that sits inside each topology's practical envelope. */
const SPEC_BY_ID: Record<TopologyId, DesignSpec> = {
  buck: spec({ poutW: 60 }),
  "sync-buck": spec({ poutW: 500 }),
  "interleaved-sync-buck": spec({ poutW: 1000 }),
  boost: spec({ vinMinV: 180, vinNomV: 200, vinMaxV: 240, voutV: 400, poutW: 1000 }),
  "llc-half-bridge": spec({ vinMinV: 380, vinNomV: 400, vinMaxV: 420, voutV: 12, poutW: 300, isolated: true }),
  "llc-full-bridge": spec({ vinMinV: 380, vinNomV: 400, vinMaxV: 420, voutV: 48, poutW: 3000, isolated: true }),
  psfb: spec({ vinMinV: 350, vinNomV: 400, vinMaxV: 450, voutV: 48, poutW: 3000, isolated: true }),
  dab: spec({
    vinMinV: 700,
    vinNomV: 800,
    vinMaxV: 900,
    voutV: 48,
    poutW: 5000,
    isolated: true,
    bidirectional: true,
  }),
  "totem-pole-pfc": spec({
    conversion: "ac-dc",
    gridVacRms: 230,
    vinMinV: 370,
    vinNomV: 390,
    vinMaxV: 410,
    voutV: 400,
    poutW: 3600,
  }),
  flyback: spec({ vinMinV: 90, vinNomV: 110, vinMaxV: 130, voutV: 12, poutW: 60, isolated: true }),
  "forward-active-clamp": spec({ vinMinV: 36, vinNomV: 48, vinMaxV: 72, voutV: 12, poutW: 200, isolated: true }),
};

const FSW = 200e3;

describe("operatingPoints — universal sanity", () => {
  const ids = Object.keys(SPEC_BY_ID) as TopologyId[];
  for (const id of ids) {
    it(`${id}: all stresses finite and physical`, () => {
      const op = operatingPoints(id, SPEC_BY_ID[id], FSW);
      expect(op.topologyId).toBe(id);
      expect(op.switchPoints.length).toBeGreaterThan(0);
      expect(op.magnetics.length).toBeGreaterThan(0);
      expect(Number.isFinite(op.capRmsA)).toBe(true);
      expect(op.capRmsA).toBeGreaterThan(0);
      expect(op.notes.length).toBeGreaterThan(0);
      for (const sp of op.switchPoints) {
        expect(sp.positions).toBeGreaterThanOrEqual(1);
        expect(sp.vOffV).toBeGreaterThan(0);
        expect(sp.iRmsA).toBeGreaterThan(0);
        expect(sp.iRmsA).toBeGreaterThanOrEqual(sp.iAvgA); // RMS >= average, always
        expect(sp.dutyEff).toBeGreaterThan(0);
        expect(sp.dutyEff).toBeLessThanOrEqual(1);
        expect(sp.deadTimeFrac).toBeGreaterThanOrEqual(0);
        expect(sp.deadTimeFrac).toBeLessThanOrEqual(0.1);
        for (const v of [sp.vOffV, sp.iRmsA, sp.iAvgA, sp.iOnA, sp.iOffA, sp.fswHz]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
      for (const m of op.magnetics) {
        expect(m.inductanceUh).toBeGreaterThan(0);
        expect(m.iPeakA).toBeGreaterThan(0);
        expect(m.iPeakA).toBeGreaterThanOrEqual(m.iRmsA * 0.99);
        expect(m.voltSecondsVus).toBeGreaterThan(0);
        expect(m.acFluxFraction).toBeGreaterThan(0);
        expect(m.acFluxFraction).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe("sync-buck", () => {
  const s = SPEC_BY_ID["sync-buck"];

  it("duty ≈ vout/vin", () => {
    const op = operatingPoints("sync-buck", s, FSW);
    const hs = op.switchPoints.find((p) => p.role === "buck-hs")!;
    expect(hs.dutyEff).toBeCloseTo(12 / 48, 3);
  });

  it("SR is ZVS, HS is hard-switched, both block vinMax", () => {
    const op = operatingPoints("sync-buck", s, FSW);
    const hs = op.switchPoints.find((p) => p.role === "buck-hs")!;
    const sr = op.switchPoints.find((p) => p.role === "sr")!;
    expect(hs.zvs).toBe(false);
    expect(sr.zvs).toBe(true);
    expect(hs.vOffV).toBe(s.vinMaxV);
    expect(sr.deadTimeFrac).toBeGreaterThan(0);
  });

  it("inductance falls with switching frequency (monotonic)", () => {
    const l100 = operatingPoints("sync-buck", s, 100e3).magnetics[0].inductanceUh;
    const l400 = operatingPoints("sync-buck", s, 400e3).magnetics[0].inductanceUh;
    expect(l400).toBeLessThan(l100);
    expect(l100 / l400).toBeCloseTo(4, 1);
  });

  it("volt-seconds fall with switching frequency", () => {
    const v100 = operatingPoints("sync-buck", s, 100e3).magnetics[0].voltSecondsVus;
    const v400 = operatingPoints("sync-buck", s, 400e3).magnetics[0].voltSecondsVus;
    expect(v400).toBeLessThan(v100);
  });
});

describe("interleaved-sync-buck", () => {
  it("halves per-phase RMS current vs single phase and doubles positions", () => {
    const s = SPEC_BY_ID["interleaved-sync-buck"];
    const single = operatingPoints("sync-buck", s, FSW);
    const dual = operatingPoints("interleaved-sync-buck", s, FSW);
    const hs1 = single.switchPoints.find((p) => p.role === "buck-hs")!;
    const hs2 = dual.switchPoints.find((p) => p.role === "buck-hs")!;
    expect(hs2.positions).toBe(2);
    expect(hs2.iRmsA / hs1.iRmsA).toBeCloseTo(0.5, 2);
    expect(dual.magnetics.length).toBe(2);
  });

  it("interleaving reduces output-cap RMS current", () => {
    const s = SPEC_BY_ID["interleaved-sync-buck"];
    const single = operatingPoints("sync-buck", s, FSW);
    const dual = operatingPoints("interleaved-sync-buck", s, FSW);
    expect(dual.capRmsA).toBeLessThan(single.capRmsA);
  });
});

describe("boost", () => {
  const s = SPEC_BY_ID.boost;
  it("switch blocks vout and duty ≈ 1 - vin/vout", () => {
    const op = operatingPoints("boost", s, FSW);
    const ls = op.switchPoints.find((p) => p.role === "boost-ls")!;
    expect(ls.vOffV).toBe(400);
    expect(ls.dutyEff).toBeCloseTo(1 - 200 / 400, 3);
    expect(ls.zvs).toBe(false);
  });
  it("output cap carries the classic Iout·√(D/(1-D))", () => {
    const op = operatingPoints("boost", s, FSW);
    const iout = s.poutW / s.voutV;
    expect(op.capRmsA).toBeCloseTo(iout * Math.sqrt(0.5 / 0.5), 2);
  });
});

describe("dab", () => {
  const s = SPEC_BY_ID.dab;
  it("all 8 positions are ZVS", () => {
    const op = operatingPoints("dab", s, FSW);
    const positions = op.switchPoints.reduce((n, p) => n + p.positions, 0);
    expect(positions).toBe(8);
    for (const p of op.switchPoints) expect(p.zvs).toBe(true);
  });
  it("turns ratio ≈ vinNom/vout and both transformer + series inductor required", () => {
    const op = operatingPoints("dab", s, FSW);
    const xfmr = op.magnetics.find((m) => m.role === "transformer")!;
    const lser = op.magnetics.find((m) => m.role === "resonant-inductor")!;
    expect(xfmr.turnsRatio).toBeCloseTo(800 / 48, 2);
    expect(lser.inductanceUh).toBeGreaterThan(1);
    // magnetizing target = 10x series inductance
    expect(xfmr.inductanceUh / lser.inductanceUh).toBeCloseTo(10, 1);
  });
  it("tank peak current ≈ 1.2·P/V1 at φ = 30°", () => {
    const op = operatingPoints("dab", s, FSW);
    const lser = op.magnetics.find((m) => m.role === "resonant-inductor")!;
    expect(lser.iPeakA).toBeCloseTo(1.2 * (5000 / 800), 1);
  });
  it("secondary bridge current scales by the turns ratio", () => {
    const op = operatingPoints("dab", s, FSW);
    const pri = op.switchPoints.find((p) => p.role === "primary-fb")!;
    const sec = op.switchPoints.find((p) => p.role === "secondary-fb")!;
    expect(sec.iRmsA / pri.iRmsA).toBeCloseTo(800 / 48, 1);
  });
});

describe("llc", () => {
  it("half-bridge: primary ZVS with turn-off at magnetizing current only", () => {
    const op = operatingPoints("llc-half-bridge", SPEC_BY_ID["llc-half-bridge"], FSW);
    const pri = op.switchPoints.find((p) => p.role === "primary-llc")!;
    expect(pri.zvs).toBe(true);
    expect(pri.positions).toBe(2);
    expect(pri.iOffA).toBeLessThan(pri.iRmsA * 2); // turn-off current is small (magnetizing only)
    expect(op.magnetics.map((m) => m.role)).toContain("resonant-inductor");
    const sr = op.switchPoints.find((p) => p.role === "sr")!;
    expect(sr.vOffV).toBeCloseTo(2 * 12, 5); // center-tap blocks 2·Vout
  });
  it("full-bridge: 4 primary positions, half the turns-ratio-referred drive of the HB", () => {
    const hb = operatingPoints("llc-half-bridge", SPEC_BY_ID["llc-full-bridge"], FSW);
    const fb = operatingPoints("llc-full-bridge", SPEC_BY_ID["llc-full-bridge"], FSW);
    const nHb = hb.magnetics.find((m) => m.role === "transformer")!.turnsRatio!;
    const nFb = fb.magnetics.find((m) => m.role === "transformer")!.turnsRatio!;
    expect(nFb / nHb).toBeCloseTo(2, 5); // FB drives twice the tank voltage
    expect(fb.switchPoints.find((p) => p.role === "primary-llc")!.positions).toBe(4);
  });
});

describe("psfb", () => {
  it("exactly half the primary positions get ZVS", () => {
    const op = operatingPoints("psfb", SPEC_BY_ID.psfb, FSW);
    const pri = op.switchPoints.filter((p) => p.role.startsWith("primary"));
    const zvsPos = pri.filter((p) => p.zvs).reduce((n, p) => n + p.positions, 0);
    const totalPos = pri.reduce((n, p) => n + p.positions, 0);
    expect(totalPos).toBe(4);
    expect(zvsPos).toBe(2);
  });
  it("output inductor ripples at 2·fsw", () => {
    const op = operatingPoints("psfb", SPEC_BY_ID.psfb, FSW);
    const lout = op.magnetics.find((m) => m.role === "output-inductor")!;
    expect(lout.fswHz).toBe(2 * FSW);
  });
});

describe("totem-pole-pfc", () => {
  const s = SPEC_BY_ID["totem-pole-pfc"];
  it("fast leg hard-switched at fsw, slow leg at line frequency", () => {
    const op = operatingPoints("totem-pole-pfc", s, FSW);
    const fast = op.switchPoints.find((p) => p.role === "pfc-fast-leg")!;
    const slow = op.switchPoints.find((p) => p.role === "pfc-slow-leg")!;
    expect(fast.fswHz).toBe(FSW);
    expect(fast.zvs).toBe(false);
    expect(slow.fswHz).toBeLessThanOrEqual(60);
    expect(slow.zvs).toBe(true);
    expect(fast.vOffV).toBe(400);
  });
  it("inductor peak clears √2·Iac and cap RMS is dominated by 2×line ripple", () => {
    const op = operatingPoints("totem-pole-pfc", s, FSW);
    const iAc = s.poutW / (s.gridVacRms ?? 230);
    const choke = op.magnetics.find((m) => m.role === "pfc-inductor")!;
    expect(choke.iPeakA).toBeGreaterThan(Math.SQRT2 * iAc);
    const iout = s.poutW / s.voutV;
    expect(op.capRmsA).toBeGreaterThan(iout / Math.SQRT2); // at least the LF component
  });
});

describe("flyback / forward-active-clamp", () => {
  it("flyback primary blocks vin + reflected vout with margin", () => {
    const s = SPEC_BY_ID.flyback;
    const op = operatingPoints("flyback", s, FSW);
    const pri = op.switchPoints.find((p) => p.role === "primary-flyback")!;
    expect(pri.vOffV).toBeGreaterThan(s.vinMaxV);
    expect(op.magnetics[0].role).toBe("coupled-inductor");
    expect(op.magnetics[0].turnsRatio).toBeGreaterThan(0);
  });
  it("forward-active-clamp main switch blocks vin/(1-D) and gets ZVS", () => {
    const s = SPEC_BY_ID["forward-active-clamp"];
    const op = operatingPoints("forward-active-clamp", s, FSW);
    const main = op.switchPoints.find((p) => p.role === "primary-main")!;
    expect(main.vOffV).toBeCloseTo(s.vinMaxV / 0.55, 1);
    expect(main.zvs).toBe(true);
    expect(op.magnetics.map((m) => m.role)).toContain("output-inductor");
  });
  it("forward's buck output filter has far lower cap stress than the flyback", () => {
    const fly = operatingPoints("flyback", SPEC_BY_ID.flyback, FSW);
    const fwd = operatingPoints("forward-active-clamp", SPEC_BY_ID["forward-active-clamp"], FSW);
    const iOutFly = SPEC_BY_ID.flyback.poutW / 12;
    const iOutFwd = SPEC_BY_ID["forward-active-clamp"].poutW / 12;
    expect(fly.capRmsA / iOutFly).toBeGreaterThan(3 * (fwd.capRmsA / iOutFwd));
  });
});
