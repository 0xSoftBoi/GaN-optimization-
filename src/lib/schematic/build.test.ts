import { describe, expect, it } from "vitest";
import type { TopologyId } from "@/lib/types";
import { buildSchematic, type AnnotatedNetlistComponent } from "./build";
import {
  GAN100,
  GAN650,
  mkDl,
  mkMag,
  mkParts,
  SPEC_BUCK,
  SPEC_DAB,
  SPEC_PFC,
} from "./testFixtures";

const ALL_TOPOLOGIES: TopologyId[] = [
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

const ISO = new Set<TopologyId>([
  "llc-half-bridge",
  "llc-full-bridge",
  "psfb",
  "dab",
  "flyback",
  "forward-active-clamp",
]);

function specFor(id: TopologyId) {
  if (id === "totem-pole-pfc") return SPEC_PFC;
  return ISO.has(id) ? SPEC_DAB : SPEC_BUCK;
}

const FULL_MAGS = [mkMag("transformer", 500, 20, 5), mkMag("output-inductor", 22, 12), mkMag("resonant-inductor", 8, 6)];

describe("buildSchematic — all topologies", () => {
  for (const id of ALL_TOPOLOGIES) {
    it(`${id}: consistent nets, parseable SPICE, labeled SVG`, () => {
      const sch = buildSchematic(id, specFor(id), mkParts([mkDl(GAN650, "bridge", 8)], FULL_MAGS));

      // every component pin references a declared net
      const netSet = new Set(sch.nets);
      for (const c of sch.components) {
        for (const [pin, net] of Object.entries(c.pins)) {
          expect(netSet.has(net), `${c.ref}.${pin} -> ${net} not declared`).toBe(true);
        }
      }
      expect(sch.nets).toContain("PGND");
      expect(sch.nets).toContain("VOUT");
      expect(sch.nets).toContain("SW1");

      // SVG: dark style, every ref labeled, net names present
      expect(sch.svg).toContain("<svg");
      expect(sch.svg).toContain("#0a0e14");
      expect(sch.svg).toContain("#22d3ee");
      expect(sch.svg).toMatch(/width="9\d\d"/);
      for (const c of sch.components) expect(sch.svg).toContain(c.ref);
      expect(sch.svg).toContain("VOUT");

      // SPICE: directives + every non-ground net appears as a node
      expect(sch.spiceNetlist).toContain(".tran");
      expect(sch.spiceNetlist).toContain(".end");
      expect(sch.spiceNetlist).toContain("PULSE(");
      for (const net of sch.nets) {
        if (net === "PGND") continue; // mapped to SPICE node 0
        expect(sch.spiceNetlist, `net ${net} missing from SPICE`).toContain(net);
      }
    });
  }
});

describe("buildSchematic — sync-buck specifics", () => {
  const parts = mkParts([mkDl(GAN100, "hs", 1), mkDl(GAN100, "sr", 1)], [mkMag("output-inductor", 3.3, 8)]);
  const sch = buildSchematic("sync-buck", SPEC_BUCK, parts);

  it("emits canonical nets and correctly wired half-bridge", () => {
    for (const n of ["VIN", "PGND", "SW1", "VOUT", "G1", "G2"]) expect(sch.nets).toContain(n);
    const switches = sch.components.filter((c) => c.kind === "switch");
    expect(switches).toHaveLength(2);
    expect(switches[0].pins).toEqual({ D: "VIN", G: "G1", S: "SW1" });
    expect(switches[1].pins).toEqual({ D: "SW1", G: "G2", S: "PGND" });
  });

  it("wires the output inductor SW1 -> VOUT with the magnetics partId", () => {
    const l = sch.components.find((c) => c.kind === "inductor");
    expect(l).toBeDefined();
    expect(Object.values(l!.pins)).toEqual(["SW1", "VOUT"]);
    expect(l!.partId).toBe("MAG-output-inductor-PQ32/20");
  });

  it("SPICE has Ron from the device, fsw period, and a load", () => {
    expect(sch.spiceNetlist).toContain("Ron=0.0032"); // 3.2 mΩ
    expect(sch.spiceNetlist).toContain("SW_EPC2218");
    expect(sch.spiceNetlist).toContain("2.000e-6"); // 1/500 kHz period in PULSE
    expect(sch.spiceNetlist).toContain("RLOAD VOUT 0");
    expect(sch.spiceNetlist).toContain(".tran");
  });

  it("annotates every component with pricing meta for the BOM", () => {
    for (const c of sch.components as AnnotatedNetlistComponent[]) {
      expect(c.meta).toBeDefined();
      expect(c.meta.unitPriceUsd).toBeGreaterThan(0);
      expect(c.meta.description.length).toBeGreaterThan(0);
    }
  });

  it("uses one dual driver per leg and a controller with per-position PWM pins", () => {
    const drivers = sch.components.filter((c) => c.kind === "driver");
    expect(drivers).toHaveLength(1);
    const ctl = sch.components.find((c) => c.kind === "controller");
    expect(ctl?.pins.PWM1).toBe("PWM1");
    expect(ctl?.pins.PWM2).toBe("PWM2");
    expect(ctl?.pins.FB).toBe("FB");
  });
});

describe("buildSchematic — parallel devices", () => {
  it("emits one physical switch per parallel device, sharing position nets", () => {
    const sch = buildSchematic("sync-buck", SPEC_BUCK, mkParts([mkDl(GAN100, "hb", 2, 2)]));
    const switches = sch.components.filter((c) => c.kind === "switch");
    expect(switches).toHaveLength(4); // 2 positions x 2 parallel
    const gates = new Set(switches.map((c) => c.pins.G));
    expect(gates).toEqual(new Set(["G1", "G2"]));
    // paralleled pair shares D/S nets
    const hs = switches.filter((c) => c.pins.G === "G1");
    expect(hs[0].pins.D).toBe(hs[1].pins.D);
    expect(hs[0].pins.S).toBe(hs[1].pins.S);
  });
});

describe("buildSchematic — dab", () => {
  const sch = buildSchematic("dab", SPEC_DAB, mkParts([mkDl(GAN650, "bridge", 8)], FULL_MAGS));

  it("has two full bridges, an isolated secondary, and a coupled transformer", () => {
    expect(sch.components.filter((c) => c.kind === "switch")).toHaveLength(8);
    expect(sch.nets).toContain("SGND");
    for (const n of ["SW1", "SW2", "SW3", "SW4"]) expect(sch.nets).toContain(n);
    const t = sch.components.find((c) => c.kind === "transformer");
    expect(t).toBeDefined();
    expect(sch.spiceNetlist).toMatch(/\nKT1 /);
    expect(sch.spiceNetlist).toContain("RTIE SGND 0");
  });

  it("uses one driver per leg (4 legs)", () => {
    expect(sch.components.filter((c) => c.kind === "driver")).toHaveLength(4);
  });
});

describe("buildSchematic — llc-half-bridge", () => {
  it("emits a series resonant Cr/Lr tank", () => {
    const sch = buildSchematic("llc-half-bridge", SPEC_DAB, mkParts([mkDl(GAN650, "bridge", 4)], FULL_MAGS));
    const cr = sch.components.find((c) => c.kind === "capacitor" && c.value.includes("resonant"));
    expect(cr).toBeDefined();
    expect(sch.spiceNetlist).toContain(`${cr!.ref} SW1 CR1`);
    const lr = sch.components.find((c) => c.kind === "inductor" && c.value.includes("resonant"));
    expect(lr).toBeDefined();
  });
});

describe("buildSchematic — totem-pole PFC", () => {
  it("has AC input nets and a 50 Hz source in SPICE", () => {
    const sch = buildSchematic("totem-pole-pfc", SPEC_PFC, mkParts([mkDl(GAN650, "pfc", 4)], FULL_MAGS));
    expect(sch.nets).toContain("ACL");
    expect(sch.nets).toContain("ACN");
    expect(sch.spiceNetlist).toContain("SIN(0 325.3 50)"); // 230 Vrms peak
    expect(sch.components.filter((c) => c.kind === "switch")).toHaveLength(4);
  });
});
