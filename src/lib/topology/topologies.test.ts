import { describe, expect, it } from "vitest";
import type { DesignSpec, TopologyId } from "@/lib/types";
import { TOPOLOGIES, getTopology, scoreTopologies } from "./topologies";

const ALL_IDS: TopologyId[] = [
  "buck",
  "sync-buck",
  "interleaved-sync-buck",
  "boost",
  "llc-half-bridge",
  "llc-full-bridge",
  "psfb",
  "dab",
  "totem-pole-pfc",
  "flyback",
  "forward-active-clamp",
];

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

describe("TOPOLOGIES catalog", () => {
  it("covers every TopologyId exactly once", () => {
    const ids = TOPOLOGIES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ALL_IDS) expect(ids).toContain(id);
    expect(ids.length).toBe(ALL_IDS.length);
  });

  it("has plausible metadata on every entry", () => {
    for (const t of TOPOLOGIES) {
      expect(t.minPowerW).toBeGreaterThan(0);
      expect(t.maxPowerW).toBeGreaterThan(t.minPowerW);
      expect(t.switchCount).toBeGreaterThanOrEqual(1);
      expect(t.switchCount).toBeLessThanOrEqual(8);
      expect(t.magnetics.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });

  it("encodes the contract's bidirectionality facts", () => {
    expect(getTopology("dab").bidirectional).toBe(true);
    expect(getTopology("sync-buck").bidirectional).toBe(true);
    expect(getTopology("interleaved-sync-buck").bidirectional).toBe(true);
    for (const id of ["llc-half-bridge", "llc-full-bridge", "psfb", "flyback", "forward-active-clamp"] as const) {
      expect(getTopology(id).bidirectional).toBe(false);
    }
  });
});

describe("scoreTopologies — hard disqualification", () => {
  it("disqualifies non-isolated topologies when the spec needs isolation", () => {
    const scores = scoreTopologies(spec({ isolated: true, voutV: 12, poutW: 100 }));
    const sb = scores.find((s) => s.topology.id === "sync-buck")!;
    expect(sb.disqualified).toMatch(/isolation/);
    expect(sb.score).toBe(0);
  });

  it("disqualifies unidirectional topologies on a bidirectional spec", () => {
    const scores = scoreTopologies(
      spec({ isolated: true, bidirectional: true, vinMinV: 350, vinNomV: 400, vinMaxV: 450, voutV: 48, poutW: 3000 }),
    );
    for (const id of ["llc-full-bridge", "psfb"] as const) {
      const s = scores.find((x) => x.topology.id === id)!;
      expect(s.disqualified).toMatch(/bidirectional/);
    }
    expect(scores.find((x) => x.topology.id === "dab")!.disqualified).toBeUndefined();
  });

  it("disqualifies on power window", () => {
    const tiny = scoreTopologies(spec({ isolated: true, vinMinV: 18, vinNomV: 24, vinMaxV: 30, voutV: 5, poutW: 5 }));
    expect(tiny.find((s) => s.topology.id === "dab")!.disqualified).toMatch(/power-window/);
    expect(tiny.find((s) => s.topology.id === "psfb")!.disqualified).toMatch(/power-window/);
    expect(tiny.find((s) => s.topology.id === "flyback")!.disqualified).toBeUndefined();
    expect(tiny[0].topology.id).toBe("flyback");
  });

  it("reserves totem-pole-pfc for ac-dc and excludes DC-DC topologies from ac-dc specs", () => {
    const dcdc = scoreTopologies(spec({}));
    expect(dcdc.find((s) => s.topology.id === "totem-pole-pfc")!.disqualified).toMatch(/conversion/);

    const acdc = scoreTopologies(
      spec({
        conversion: "ac-dc",
        gridVacRms: 230,
        vinMinV: 370,
        vinNomV: 390,
        vinMaxV: 410,
        voutV: 400,
        poutW: 3600,
        bidirectional: true,
      }),
    );
    expect(acdc[0].topology.id).toBe("totem-pole-pfc");
    expect(acdc[0].score).toBeGreaterThan(0);
    for (const s of acdc.slice(1)) expect(s.disqualified).toMatch(/conversion/);
  });

  it("disqualifies impossible conversion directions", () => {
    const stepUp = scoreTopologies(spec({ voutV: 60, vinMinV: 36, vinNomV: 48, vinMaxV: 60 }));
    expect(stepUp.find((s) => s.topology.id === "sync-buck")!.disqualified).toMatch(/voltage-ratio/);
    const stepDown = scoreTopologies(spec({}));
    expect(stepDown.find((s) => s.topology.id === "boost")!.disqualified).toMatch(/voltage-ratio/);
  });
});

describe("scoreTopologies — ranking", () => {
  it("ranks DAB first for 800 V -> 48 V, 5 kW, bidirectional isolated", () => {
    const scores = scoreTopologies(
      spec({
        vinMinV: 700,
        vinNomV: 800,
        vinMaxV: 900,
        voutV: 48,
        poutW: 5000,
        bidirectional: true,
        isolated: true,
      }),
    );
    expect(scores[0].topology.id).toBe("dab");
    expect(scores[0].score).toBeGreaterThan(50);
    expect(scores[0].disqualified).toBeUndefined();
    expect(scores[0].rationale.join(" ")).toMatch(/ZVS|bidirectional|Turns ratio/i);
  });

  it("returns scores sorted best-first with disqualified entries last", () => {
    for (const s of [
      spec({}),
      spec({ isolated: true, poutW: 60 }),
      spec({ bidirectional: true, poutW: 1000 }),
    ]) {
      const scores = scoreTopologies(s);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i].score).toBeLessThanOrEqual(scores[i - 1].score);
      }
      expect(scores.length).toBe(TOPOLOGIES.length);
    }
  });

  it("prefers sync-buck over async buck for a 100 W point-of-load", () => {
    const scores = scoreTopologies(spec({ poutW: 100 }));
    const sync = scores.find((s) => s.topology.id === "sync-buck")!;
    const async_ = scores.find((s) => s.topology.id === "buck")!;
    expect(sync.score).toBeGreaterThan(async_.score);
    expect(scores[0].topology.id).toBe("sync-buck");
  });

  it("always provides a rationale", () => {
    for (const s of scoreTopologies(spec({ isolated: true, bidirectional: true, poutW: 5000 }))) {
      expect(s.rationale.length).toBeGreaterThan(0);
      expect(s.rationale[0].length).toBeGreaterThan(20);
    }
  });

  it("scores are bounded 0-100", () => {
    for (const s of scoreTopologies(spec({}))) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });
});
