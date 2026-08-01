/**
 * KiCad 8 schematic export (.kicad_sch, s-expression version 20231120).
 *
 * The generated document embeds a minimal generic symbol library
 * (Device:R/C/L/D, Device:Q_NMOS_GDS, plus VoltForge box symbols for
 * transformers, drivers, controllers and connectors), places one symbol
 * instance per netlist component on a 2.54 mm grid grouped by kind, and
 * attaches a global_label with the net name at every pin — so opening the
 * file in KiCad yields an electrically meaningful (label-connected)
 * netlist even though placement is coarse.
 *
 * Determinism contract: no randomness anywhere. Every uuid is derived
 * from a stable key (component ref, pin name, net name, sheet title) via
 * FNV-1a, formatted 8-4-4-4-12. Two calls with the same inputs produce
 * byte-identical output.
 */

import type { NetlistComponent, Schematic } from "@/lib/types";

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const UUID_SEEDS = [0x811c9dc5, 0x9747b28c, 0x1b873593, 0xcc9e2d51];

/** Stable uuid derived from a key string — 8-4-4-4-12 hex, no randomness. */
export function deterministicUuid(key: string): string {
  const hex = UUID_SEEDS.map((s) => fnv1a(key, s).toString(16).padStart(8, "0")).join("");
  const c = hex.split("");
  c[12] = "4"; // version nibble
  c[16] = "8"; // variant nibble
  const h = c.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Small s-expression / formatting helpers
// ---------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** mm with float noise removed (2 decimals is exact for 1.27 multiples). */
const mm = (x: number): string => {
  const r = Math.round(x * 100) / 100;
  return String(r === 0 ? 0 : r);
};

/** Indented s-expression writer: parens balanced by construction. */
class Sx {
  private readonly lines: string[] = [];
  private depth = 0;

  open(head: string): void {
    this.lines.push(`${"\t".repeat(this.depth)}(${head}`);
    this.depth++;
  }

  close(): void {
    this.depth--;
    this.lines.push(`${"\t".repeat(this.depth)})`);
  }

  leaf(body: string): void {
    this.lines.push(`${"\t".repeat(this.depth)}(${body})`);
  }

  toString(): string {
    return this.lines.join("\n") + "\n";
  }
}

// ---------------------------------------------------------------------------
// Symbol definitions
// ---------------------------------------------------------------------------

/**
 * Pin geometry in symbol coordinates (y up, mm). `num` is the KiCad pin
 * number and MUST equal the netlist pin name of the component so labels
 * and netlist stay in sync. `angle` points from the connection point
 * toward the symbol body.
 */
interface PinDef {
  num: string;
  x: number;
  y: number;
  angle: number;
  len: number;
}

interface SymDef {
  libId: string;
  refPrefix: string;
  pins: PinDef[];
  /** Single-line s-expr graphic fragments for the `_0_1` unit. */
  graphics: string[];
  /** Vertical extent above/below the anchor, for column stacking. */
  halfHeightMm: number;
}

const STROKE = "(stroke (width 0.254) (type default)) (fill (type none))";

function twoPinVertical(libId: string, refPrefix: string, nums: [string, string], graphics: string[]): SymDef {
  return {
    libId,
    refPrefix,
    pins: [
      { num: nums[0], x: 0, y: 3.81, angle: 270, len: 1.27 },
      { num: nums[1], x: 0, y: -3.81, angle: 90, len: 1.27 },
    ],
    graphics,
    halfHeightMm: 3.81,
  };
}

const SYM_R = twoPinVertical("Device:R", "R", ["1", "2"], [
  `(rectangle (start -1.016 2.54) (end 1.016 -2.54) ${STROKE})`,
]);

const SYM_C = twoPinVertical("Device:C", "C", ["1", "2"], [
  `(polyline (pts (xy -2.032 1.016) (xy 2.032 1.016)) ${STROKE})`,
  `(polyline (pts (xy -2.032 -1.016) (xy 2.032 -1.016)) ${STROKE})`,
]);

const SYM_L = twoPinVertical("Device:L", "L", ["1", "2"], [
  `(polyline (pts (xy 0 2.54) (xy 1.016 1.905) (xy 0 1.27) (xy 1.016 0.635) (xy 0 0) (xy 1.016 -0.635) (xy 0 -1.27) (xy 1.016 -1.905) (xy 0 -2.54)) ${STROKE})`,
]);

const SYM_D = twoPinVertical("Device:D", "D", ["A", "K"], [
  `(polyline (pts (xy -1.27 1.27) (xy 1.27 1.27) (xy 0 -1.27) (xy -1.27 1.27)) ${STROKE})`,
  `(polyline (pts (xy -1.27 -1.27) (xy 1.27 -1.27)) ${STROKE})`,
]);

/** Generic 3-pin N-FET: gate left, drain top, source bottom. */
const SYM_NMOS: SymDef = {
  libId: "Device:Q_NMOS_GDS",
  refPrefix: "Q",
  pins: [
    { num: "G", x: -5.08, y: 0, angle: 0, len: 2.54 },
    { num: "D", x: 2.54, y: 5.08, angle: 270, len: 2.54 },
    { num: "S", x: 2.54, y: -5.08, angle: 90, len: 2.54 },
  ],
  graphics: [
    `(polyline (pts (xy -2.54 1.905) (xy -2.54 -1.905)) ${STROKE})`,
    `(polyline (pts (xy -1.27 2.54) (xy -1.27 -2.54)) ${STROKE})`,
    `(polyline (pts (xy 2.54 2.54) (xy -1.27 2.54)) ${STROKE})`,
    `(polyline (pts (xy 2.54 -2.54) (xy -1.27 -2.54)) ${STROKE})`,
  ],
  halfHeightMm: 5.08,
};

const FIXED_BY_KIND: Partial<Record<NetlistComponent["kind"], SymDef>> = {
  resistor: SYM_R,
  capacitor: SYM_C,
  inductor: SYM_L,
  diode: SYM_D,
  switch: SYM_NMOS,
};

const BOX_PREFIX: Record<string, { name: string; refPrefix: string }> = {
  transformer: { name: "XFMR", refPrefix: "T" },
  driver: { name: "DRV", refPrefix: "U" },
  controller: { name: "CTRL", refPrefix: "U" },
  connector: { name: "CONN", refPrefix: "J" },
  // Fallbacks for fixed kinds whose instance pins do not match the generic
  // symbol (defensive — buildSchematic never produces these today).
  switch: { name: "SW", refPrefix: "Q" },
  diode: { name: "DIODE", refPrefix: "D" },
  inductor: { name: "IND", refPrefix: "L" },
  capacitor: { name: "CAP", refPrefix: "C" },
  resistor: { name: "RES", refPrefix: "R" },
};

/** Rectangular box symbol: first half of the pins on the left, rest right. */
function boxSymbol(libId: string, refPrefix: string, pinNames: string[]): SymDef {
  const nL = Math.ceil(pinNames.length / 2);
  const left = pinNames.slice(0, nL);
  const right = pinNames.slice(nL);
  const pins: PinDef[] = [];
  const colY = (rows: number, i: number): number => ((rows - 1) * 2.54) / 2 - i * 2.54;
  left.forEach((num, i) => pins.push({ num, x: -10.16, y: colY(left.length, i), angle: 0, len: 2.54 }));
  right.forEach((num, i) => pins.push({ num, x: 10.16, y: colY(right.length, i), angle: 180, len: 2.54 }));
  const maxY = pins.reduce((m, p) => Math.max(m, Math.abs(p.y)), 1.27);
  const half = maxY + 1.27;
  return {
    libId,
    refPrefix,
    pins,
    graphics: [`(rectangle (start -7.62 ${mm(half)}) (end 7.62 ${mm(-half)}) ${STROKE})`],
    halfHeightMm: half,
  };
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const FONT = "(effects (font (size 1.27 1.27)))";
const FONT_HIDE = "(effects (font (size 1.27 1.27)) hide)";

function emitLibSymbol(sx: Sx, def: SymDef): void {
  const name = def.libId.split(":").pop() as string;
  sx.open(`symbol "${esc(def.libId)}" (pin_numbers hide) (pin_names (offset 0.508)) (exclude_from_sim no) (in_bom yes) (on_board yes)`);
  sx.leaf(`property "Reference" "${def.refPrefix}" (at 0 0 0) ${FONT}`);
  sx.leaf(`property "Value" "${esc(name)}" (at 0 0 0) ${FONT}`);
  sx.leaf(`property "Footprint" "" (at 0 0 0) ${FONT_HIDE}`);
  sx.leaf(`property "Datasheet" "~" (at 0 0 0) ${FONT_HIDE}`);
  sx.open(`symbol "${esc(name)}_0_1"`);
  for (const g of def.graphics) sx.leaf(g.slice(1, -1));
  sx.close();
  sx.open(`symbol "${esc(name)}_1_1"`);
  for (const p of def.pins) {
    sx.open(`pin passive line (at ${mm(p.x)} ${mm(p.y)} ${p.angle}) (length ${mm(p.len)})`);
    sx.leaf(`name "${esc(p.num)}" ${FONT}`);
    sx.leaf(`number "${esc(p.num)}" ${FONT}`);
    sx.close();
  }
  sx.close();
  sx.close();
}

interface Placed {
  comp: NetlistComponent;
  def: SymDef;
  x: number;
  y: number;
}

const KIND_ORDER: NetlistComponent["kind"][] = [
  "connector",
  "switch",
  "diode",
  "inductor",
  "transformer",
  "capacitor",
  "resistor",
  "driver",
  "controller",
];

const GRID = 2.54;
const X0 = 25.4; // first column anchor
const Y0 = 30.48; // column top
const COL_PITCH = 45.72; // 18 × 2.54
const Y_WRAP = 236.22; // wrap a column past this anchor (A3 is 297 mm tall)

const snapUp = (x: number): number => Math.ceil(x / GRID - 1e-9) * GRID;

/**
 * Generate a KiCad 8/9 `.kicad_sch` document from a VoltForge Schematic.
 * Symbols are grouped by component kind into columns; every pin carries a
 * global_label with its net name, so the drawing's netlist matches
 * `sch.components` exactly. Output is deterministic.
 */
export function kicadSchematic(sch: Schematic, title: string): string {
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  const rootUuid = deterministicUuid(`sheet:${cleanTitle}`);

  // --- resolve a symbol definition per component --------------------------
  const libDefs = new Map<string, SymDef>(); // libId -> def (emission order)
  const boxCache = new Map<string, SymDef>(); // kind|pins -> def
  const usedLibIds = new Set<string>();

  const resolve = (c: NetlistComponent): SymDef => {
    const pinNames = Object.keys(c.pins);
    const fixed = FIXED_BY_KIND[c.kind];
    if (fixed && pinNames.length === fixed.pins.length && fixed.pins.every((p) => p.num in c.pins)) {
      libDefs.set(fixed.libId, fixed);
      return fixed;
    }
    const key = `${c.kind}|${pinNames.join(" ")}`;
    const hit = boxCache.get(key);
    if (hit) return hit;
    const meta = BOX_PREFIX[c.kind] ?? { name: "GEN", refPrefix: "U" };
    let libId = `VoltForge:${meta.name}_${pinNames.length}`;
    for (let i = 2; usedLibIds.has(libId); i++) libId = `VoltForge:${meta.name}_${pinNames.length}_${i}`;
    usedLibIds.add(libId);
    const def = boxSymbol(libId, meta.refPrefix, pinNames);
    boxCache.set(key, def);
    libDefs.set(libId, def);
    return def;
  };

  // --- place components: one column (or more) per kind ---------------------
  const rank = (k: NetlistComponent["kind"]): number => {
    const i = KIND_ORDER.indexOf(k);
    return i === -1 ? KIND_ORDER.length : i;
  };
  const ordered = [...sch.components].sort((a, b) => rank(a.kind) - rank(b.kind));

  const placed: Placed[] = [];
  let col = -1;
  let y = Y0;
  let prevKind: NetlistComponent["kind"] | null = null;
  for (const comp of ordered) {
    const def = resolve(comp);
    if (comp.kind !== prevKind) {
      col++;
      y = Y0;
      prevKind = comp.kind;
    }
    const margin = snapUp(def.halfHeightMm + GRID);
    let anchorY = y + margin;
    if (anchorY > Y_WRAP) {
      col++;
      y = Y0;
      anchorY = y + margin;
    }
    placed.push({ comp, def, x: X0 + col * COL_PITCH, y: anchorY });
    y = anchorY + margin;
  }

  // --- emit ----------------------------------------------------------------
  const sx = new Sx();
  sx.open("kicad_sch");
  sx.leaf("version 20231120");
  sx.leaf(`generator "voltforge"`);
  sx.leaf(`generator_version "8.0"`);
  sx.leaf(`uuid "${rootUuid}"`);
  sx.leaf(`paper "A3"`);
  sx.open("title_block");
  sx.leaf(`title "${esc(cleanTitle)}"`);
  sx.leaf(`rev "1"`);
  sx.leaf(`company "VoltForge"`);
  sx.leaf(`comment 1 "Deterministic export — global labels carry the netlist; placement is grouped by kind"`);
  sx.close();

  sx.open("lib_symbols");
  const defsSorted = [...libDefs.values()].sort((a, b) => a.libId.localeCompare(b.libId));
  for (const def of defsSorted) emitLibSymbol(sx, def);
  sx.close();

  // Symbol instances.
  for (const { comp, def, x, y: ay } of placed) {
    const uid = deterministicUuid(`sym:${comp.ref}`);
    sx.open(`symbol (lib_id "${esc(def.libId)}") (at ${mm(x)} ${mm(ay)} 0) (unit 1)`);
    sx.leaf("exclude_from_sim no");
    sx.leaf("in_bom yes");
    sx.leaf("on_board yes");
    sx.leaf("dnp no");
    sx.leaf(`uuid "${uid}"`);
    const refY = ay - def.halfHeightMm - GRID;
    const valY = ay + def.halfHeightMm + GRID;
    sx.leaf(`property "Reference" "${esc(comp.ref)}" (at ${mm(x)} ${mm(refY)} 0) ${FONT}`);
    sx.leaf(`property "Value" "${esc(comp.value)}" (at ${mm(x)} ${mm(valY)} 0) ${FONT}`);
    sx.leaf(`property "Footprint" "" (at ${mm(x)} ${mm(ay)} 0) ${FONT_HIDE}`);
    sx.leaf(`property "Datasheet" "~" (at ${mm(x)} ${mm(ay)} 0) ${FONT_HIDE}`);
    if (comp.partId) sx.leaf(`property "MPN" "${esc(comp.partId)}" (at ${mm(x)} ${mm(ay)} 0) ${FONT_HIDE}`);
    for (const p of def.pins) {
      sx.leaf(`pin "${esc(p.num)}" (uuid "${deterministicUuid(`pin:${comp.ref}:${p.num}`)}")`);
    }
    sx.open("instances");
    sx.open(`project "voltforge"`);
    sx.leaf(`path "/${rootUuid}" (reference "${esc(comp.ref)}") (unit 1)`);
    sx.close();
    sx.close();
    sx.close();
  }

  // Global labels: one per pin, at the pin's connection point (symbol y is
  // inverted relative to sheet y), carrying the pin's net name.
  for (const { comp, def, x, y: ay } of placed) {
    for (const p of def.pins) {
      const net = comp.pins[p.num];
      if (net === undefined) continue;
      const lx = x + p.x;
      const ly = ay - p.y;
      const angle = (p.angle + 180) % 360;
      const justify = angle === 0 || angle === 90 ? "left" : "right";
      sx.open(`global_label "${esc(net)}" (shape passive) (at ${mm(lx)} ${mm(ly)} ${angle})`);
      sx.leaf(`effects (font (size 1.27 1.27)) (justify ${justify})`);
      sx.leaf(`uuid "${deterministicUuid(`lbl:${comp.ref}:${p.num}:${net}`)}"`);
      sx.close();
    }
  }

  sx.open("sheet_instances");
  sx.leaf(`path "/" (page "1")`);
  sx.close();

  sx.close();
  return sx.toString();
}
