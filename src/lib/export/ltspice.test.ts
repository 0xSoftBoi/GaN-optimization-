import { describe, expect, it } from "vitest";
import type { Schematic } from "@/lib/types";
import { buildSchematic } from "@/lib/schematic";
import { GAN100, GAN650, mkDl, mkMag, mkParts, SPEC_BUCK, SPEC_DAB } from "@/lib/schematic/testFixtures";
import { ltspiceNetlist } from "./ltspice";

const BUCK = buildSchematic("sync-buck", SPEC_BUCK, mkParts([mkDl(GAN100, "hs", 1), mkDl(GAN100, "sr", 1)], [mkMag("output-inductor", 3.3, 8)]));
const DAB = buildSchematic(
  "dab",
  SPEC_DAB,
  mkParts([mkDl(GAN650, "bridge", 8)], [mkMag("transformer", 500, 20, 5), mkMag("resonant-inductor", 8, 6)]),
);

describe("ltspiceNetlist — structure", () => {
  for (const [name, sch] of [["sync-buck", BUCK], ["dab", DAB]] as const) {
    it(`${name}: title header, .tran present, terminated by .end`, () => {
      const net = ltspiceNetlist(sch, `VoltForge ${name}`);
      const lines = net.trimEnd().split("\n");
      expect(lines[0]).toBe(`* VoltForge ${name} — LTspice netlist`);
      expect(net).toContain(".tran ");
      expect(lines[lines.length - 1]).toBe(".end");
      // exactly one .end, and nothing after it
      expect(lines.filter((l) => l.trim() === ".end")).toHaveLength(1);
    });

    it(`${name}: switch subckt models with Ron/Roff survive the transform`, () => {
      const net = ltspiceNetlist(sch, name);
      expect(net).toContain(".subckt SW_");
      expect(net).toContain(".ends SW_");
      expect(net).toMatch(/\.model SMOD_\w+ SW\(Ron=[\d.e-]+ Roff=1e6/);
      expect(net).toContain("PULSE(");
    });

    it(`${name}: deterministic — two calls identical`, () => {
      expect(ltspiceNetlist(sch, name)).toBe(ltspiceNetlist(sch, name));
    });

    it(`${name}: every net appears (PGND mapped to node 0) and element cards are well-formed`, () => {
      const net = ltspiceNetlist(sch, name);
      for (const n of sch.nets) {
        if (n === "PGND") continue;
        expect(net, `net ${n} missing`).toContain(n);
      }
      // Element cards: ref token then at least two node tokens, no tabs or
      // doubled spaces that would hint at a mangled node name.
      for (const line of net.split("\n")) {
        if (!line || line.startsWith("*") || line.startsWith(".") || line.startsWith("+")) continue;
        expect(line).not.toMatch(/\t| {2}/);
        expect(line.split(" ").length).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe("ltspiceNetlist — node sanitization", () => {
  const dirty: Schematic = {
    nets: ["NET A", "VOUT", "PGND"],
    components: [
      { ref: "R1", kind: "resistor", value: "10k", pins: { "1": "NET A", "2": "VOUT" } },
    ],
    svg: "<svg/>",
    spiceNetlist: [
      "* dirty fixture",
      "V1 NET A 0 DC 5",
      "R1 NET A VOUT 10k",
      "RL VOUT 0 100",
      ".tran 1e-6 1e-3",
      ".end",
    ].join("\n"),
  };

  it("rewrites spaced net names into legal LTspice nodes", () => {
    const net = ltspiceNetlist(dirty, "dirty");
    expect(net).toContain("R1 NET_A VOUT 10k");
    expect(net).toContain("V1 NET_A 0 DC 5");
    for (const line of net.split("\n")) {
      if (line.startsWith("*")) continue;
      expect(line).not.toContain("NET A");
    }
  });

  it("appends a default .tran when the source deck lacks one", () => {
    const bare: Schematic = { ...dirty, spiceNetlist: "R1 A 0 1k" };
    const net = ltspiceNetlist(bare, "bare");
    const lines = net.trimEnd().split("\n");
    expect(net).toContain(".tran ");
    expect(lines[lines.length - 1]).toBe(".end");
  });
});
