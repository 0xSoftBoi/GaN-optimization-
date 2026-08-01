import { describe, expect, it } from "vitest";
import { buildSchematic } from "@/lib/schematic";
import {
  GAN100,
  GAN650,
  mkDl,
  mkMag,
  mkParts,
  SPEC_BUCK,
  SPEC_DAB,
  SPEC_PFC,
} from "@/lib/schematic/testFixtures";
import { deterministicUuid, kicadSchematic } from "./kicad";

const FULL_MAGS = [mkMag("transformer", 500, 20, 5), mkMag("output-inductor", 22, 12), mkMag("resonant-inductor", 8, 6)];

const BUCK = buildSchematic("sync-buck", SPEC_BUCK, mkParts([mkDl(GAN100, "hs", 1), mkDl(GAN100, "sr", 1)], [mkMag("output-inductor", 3.3, 8)]));
const DAB = buildSchematic("dab", SPEC_DAB, mkParts([mkDl(GAN650, "bridge", 8)], FULL_MAGS));
const PFC = buildSchematic("totem-pole-pfc", SPEC_PFC, mkParts([mkDl(GAN650, "pfc", 4)], FULL_MAGS));

const CASES = [
  ["sync-buck", BUCK],
  ["dab", DAB],
  ["totem-pole-pfc", PFC],
] as const;

/** Count parens outside quoted strings (values may contain "(role)" text). */
function parenBalance(doc: string): { open: number; close: number; minDepth: number } {
  const stripped = doc.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  let open = 0;
  let close = 0;
  let depth = 0;
  let minDepth = 0;
  for (const ch of stripped) {
    if (ch === "(") {
      open++;
      depth++;
    } else if (ch === ")") {
      close++;
      depth--;
      minDepth = Math.min(minDepth, depth);
    }
  }
  return { open, close, minDepth };
}

describe("deterministicUuid", () => {
  it("is stable, well-formed and ref-dependent", () => {
    const a = deterministicUuid("sym:Q1");
    expect(a).toBe(deterministicUuid("sym:Q1"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(deterministicUuid("sym:Q2"));
  });
});

describe("kicadSchematic — document structure", () => {
  for (const [name, sch] of CASES) {
    it(`${name}: balanced s-expression with KiCad 8 header`, () => {
      const doc = kicadSchematic(sch, `VoltForge ${name}`);
      const bal = parenBalance(doc);
      expect(bal.open).toBe(bal.close);
      expect(bal.minDepth).toBe(0); // never closes more than it opened
      expect(bal.open).toBeGreaterThan(50);
      expect(doc).toContain("(kicad_sch");
      expect(doc).toContain("(version 20231120)");
      expect(doc).toContain('(generator "voltforge")');
      expect(doc).toContain('(paper "A3")');
      expect(doc).toContain(`(title "VoltForge ${name}")`);
      expect(doc).toContain("(sheet_instances");
    });

    it(`${name}: every component ref appears as a placed symbol`, () => {
      const doc = kicadSchematic(sch, name);
      for (const c of sch.components) {
        expect(doc, `missing ref ${c.ref}`).toContain(`(property "Reference" "${c.ref}"`);
      }
    });

    it(`${name}: every net name appears as a global_label`, () => {
      const doc = kicadSchematic(sch, name);
      for (const net of sch.nets) {
        expect(doc, `missing label for net ${net}`).toContain(`(global_label "${net}"`);
      }
    });

    it(`${name}: deterministic — two calls are byte-identical`, () => {
      expect(kicadSchematic(sch, name)).toBe(kicadSchematic(sch, name));
    });

    it(`${name}: all coordinates sit on the 1.27 mm grid`, () => {
      const doc = kicadSchematic(sch, name);
      const ats = [...doc.matchAll(/\(at (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)];
      expect(ats.length).toBeGreaterThan(sch.components.length);
      for (const m of ats) {
        for (const v of [Number(m[1]), Number(m[2])]) {
          const k = v / 1.27;
          expect(Math.abs(k - Math.round(k)), `${m[0]} off-grid`).toBeLessThan(1e-6);
        }
      }
    });

    it(`${name}: every lib_id used is defined in lib_symbols`, () => {
      const doc = kicadSchematic(sch, name);
      const defined = new Set([...doc.matchAll(/\(symbol "([^"]+:[^"]+)"/g)].map((m) => m[1]));
      const used = new Set([...doc.matchAll(/\(lib_id "([^"]+)"\)/g)].map((m) => m[1]));
      expect(used.size).toBeGreaterThan(0);
      for (const id of used) expect(defined.has(id), `lib_id ${id} not defined`).toBe(true);
    });
  }
});

describe("kicadSchematic — content specifics", () => {
  it("uses the generic Device symbols for R/C/L and the 3-pin NMOS switch", () => {
    const doc = kicadSchematic(BUCK, "buck");
    for (const id of ["Device:R", "Device:C", "Device:L", "Device:Q_NMOS_GDS"]) {
      expect(doc).toContain(`(lib_id "${id}")`);
      expect(doc).toContain(`(symbol "${id}"`);
    }
    // connector box symbol present too
    expect(doc).toMatch(/\(lib_id "VoltForge:CONN_\d+"\)/);
  });

  it("emits a transformer symbol whose pin numbers match the netlist pins", () => {
    const doc = kicadSchematic(DAB, "dab");
    const t = DAB.components.find((c) => c.kind === "transformer");
    expect(t).toBeDefined();
    for (const pin of Object.keys(t!.pins)) {
      expect(doc).toContain(`(number "${pin}"`);
    }
    expect(doc).toMatch(/\(lib_id "VoltForge:XFMR_\d+"\)/);
  });

  it("labels the switch pins with their power nets (electrically meaningful)", () => {
    const q1 = BUCK.components.find((c) => c.ref === "Q1");
    expect(q1).toBeDefined();
    const doc = kicadSchematic(BUCK, "buck");
    // Q1 drain is VIN, source is SW1 in the sync-buck plan.
    expect(doc).toContain(`(global_label "${q1!.pins.D}"`);
    expect(doc).toContain(`(global_label "${q1!.pins.S}"`);
    // one label per pin of every component
    const labelCount = [...doc.matchAll(/\(global_label /g)].length;
    const pinCount = BUCK.components.reduce((s, c) => s + Object.keys(c.pins).length, 0);
    expect(labelCount).toBe(pinCount);
  });

  it("symbol anchors sit on the 2.54 mm grid", () => {
    const doc = kicadSchematic(BUCK, "buck");
    const anchors = [...doc.matchAll(/\(symbol \(lib_id "[^"]+"\) \(at (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) 0\)/g)];
    expect(anchors.length).toBe(BUCK.components.length);
    for (const m of anchors) {
      for (const v of [Number(m[1]), Number(m[2])]) {
        const k = v / 2.54;
        expect(Math.abs(k - Math.round(k)), `anchor ${m[0]} off 2.54 grid`).toBeLessThan(1e-6);
      }
    }
  });

  it("different titles change only title/uuid material, not determinism", () => {
    const a = kicadSchematic(BUCK, "title A");
    const b = kicadSchematic(BUCK, "title B");
    expect(a).not.toBe(b);
    expect(a).toBe(kicadSchematic(BUCK, "title A"));
  });
});
