/**
 * Schematic generator: per-topology netlist with consistent power/gate nets,
 * a dark-theme SVG one-line diagram, and a SPICE (.cir) netlist a SPICE
 * engine can parse (voltage-controlled-switch subckts, PULSE gate drive,
 * .tran directive).
 *
 * BOM hand-off contract (documented design choice, see MODULES.md `bom`):
 * `NetlistComponent` is frozen, so every component emitted here carries an
 * extra structural `meta` field ({ mfr, description, unitPriceUsd, suppliers })
 * — `AnnotatedNetlistComponent` below. `buildBom` (src/lib/bom) reads that
 * field when present and falls back to a per-kind price table otherwise. The
 * frozen shared types stay untouched.
 *
 * SPICE conventions: net `PGND` maps to SPICE node 0; an isolated secondary
 * ground `SGND` is referenced to node 0 through a 1 MΩ tie resistor.
 */

import type {
  CapacitorPart,
  ControllerPart,
  DesignSpec,
  DeviceLoss,
  GateDriver,
  MagneticDesign,
  NetlistComponent,
  Schematic,
  SwitchDevice,
  TopologyId,
} from "@/lib/types";
import { clamp, roundSig, siFormat } from "@/lib/util";
import { renderDiagram, type DiagramBlock, type DiagramWire } from "./svg";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PartMeta {
  mfr: string;
  description: string;
  unitPriceUsd: number;
  suppliers: string[];
}

/** NetlistComponent + pricing metadata used by the BOM builder. */
export interface AnnotatedNetlistComponent extends NetlistComponent {
  meta: PartMeta;
}

export interface SchematicParts {
  switches: DeviceLoss[];
  magnetics: MagneticDesign[];
  driver: GateDriver;
  controller: ControllerPart;
  caps: { part: CapacitorPart; qty: number }[];
}

// ---------------------------------------------------------------------------
// Internal plumbing
// ---------------------------------------------------------------------------

type Phase = "main" | "comp" | "shift" | "shiftComp" | "line" | "lineComp";

interface SwitchPos {
  d: string;
  s: string;
  g: string;
  role: string;
  phase: Phase;
}

interface Stage {
  title: string;
  lines: string[];
  /** Indices into plan.positions whose switch refs are listed in this block. */
  posIdx?: number[];
}

interface TopoPlan {
  positions: SwitchPos[];
  duty: number;
  shiftFrac: number;
  vinNet: string; // "VIN" or "ACL"
  outGnd: string; // "PGND" or "SGND"
  inCapNets: [string, string];
  outCapNets: [string, string];
  stages: Stage[];
  /** Wire labels between power blocks; length = stages.length + 1. */
  stageNets: string[];
  acInput: boolean;
  isolated: boolean;
}

interface Ctx {
  comps: AnnotatedNetlistComponent[];
  spice: string[]; // element cards for passives (L/C/R/K/D)
  counters: Record<string, number>;
  hasDiode: boolean;
}

function newCtx(): Ctx {
  return { comps: [], spice: [], counters: {}, hasDiode: false };
}

function nextRef(ctx: Ctx, prefix: string): string {
  ctx.counters[prefix] = (ctx.counters[prefix] ?? 0) + 1;
  return `${prefix}${ctx.counters[prefix]}`;
}

const node = (net: string): string => (net === "PGND" ? "0" : net);
const eng = (x: number): string => (x === 0 ? "0" : x.toExponential(3));
const san = (id: string): string => id.replace(/[^A-Za-z0-9]/g, "_");

// ---------------------------------------------------------------------------
// Component emitters (each also pushes its SPICE element card)
// ---------------------------------------------------------------------------

function magPriceUsd(m: MagneticDesign): number {
  // core + winding labor + copper by length (0.15 USD/m wound litz/solid)
  const lenM = ((m.turnsPrimary + (m.turnsSecondary ?? 0)) * m.core.mltMm) / 1000;
  return roundSig(m.core.priceUsd + 1.2 + 0.15 * lenM, 3);
}

function addInductor(
  ctx: Ctx,
  n1: string,
  n2: string,
  m: MagneticDesign | undefined,
  fallbackUh: number,
  label: string,
): string {
  const ref = nextRef(ctx, "L");
  const uH = m?.inductanceUh ?? fallbackUh;
  ctx.comps.push({
    ref,
    kind: "inductor",
    value: `${siFormat(uH * 1e-6, "H")} ${label}`,
    partId: m ? `MAG-${m.role}-${m.core.id}` : undefined,
    pins: { "1": n1, "2": n2 },
    meta: {
      mfr: m ? m.core.mfr : "custom-wound",
      description: m
        ? `${label}: ${m.core.id} ${m.material.id}, ${m.turnsPrimary} t, ${siFormat(uH * 1e-6, "H")}`
        : `${label}, ${siFormat(uH * 1e-6, "H")}`,
      unitPriceUsd: m ? magPriceUsd(m) : 2.4,
      suppliers: m ? [m.core.mfr] : [],
    },
  });
  ctx.spice.push(`${ref} ${node(n1)} ${node(n2)} ${eng(uH * 1e-6)}`);
  return ref;
}

function addTransformer(
  ctx: Ctx,
  pins: Record<string, string>,
  m: MagneticDesign | undefined,
  fallbackRatio: number,
  fallbackLmagUh: number,
  centerTapped: boolean,
): string {
  const ref = nextRef(ctx, "T");
  const lmagUh = m?.inductanceUh ?? fallbackLmagUh;
  const n = m ? m.turnsPrimary / Math.max(1, m.turnsSecondary ?? 1) : fallbackRatio;
  const lsUh = lmagUh / Math.max(n * n, 1e-6);
  ctx.comps.push({
    ref,
    kind: "transformer",
    value: `${roundSig(n, 3)}:1 transformer, Lmag ${siFormat(lmagUh * 1e-6, "H")}${centerTapped ? ", CT sec" : ""}`,
    partId: m ? `MAG-${m.role}-${m.core.id}` : undefined,
    pins,
    meta: {
      mfr: m ? m.core.mfr : "custom-wound",
      description: m
        ? `transformer ${m.core.id} ${m.material.id}, ${m.turnsPrimary}:${m.turnsSecondary ?? 1}`
        : `transformer ${roundSig(n, 3)}:1`,
      unitPriceUsd: m ? magPriceUsd(m) : 6.5,
      suppliers: m ? [m.core.mfr] : [],
    },
  });
  // Coupled-inductor SPICE model (K coupling)
  const p1 = node(pins.P1);
  const p2 = node(pins.P2);
  ctx.spice.push(`L${ref}P ${p1} ${p2} ${eng(lmagUh * 1e-6)}`);
  if (centerTapped) {
    ctx.spice.push(`L${ref}SA ${node(pins.S1)} ${node(pins.CT)} ${eng(lsUh * 1e-6)}`);
    ctx.spice.push(`L${ref}SB ${node(pins.CT)} ${node(pins.S2)} ${eng(lsUh * 1e-6)}`);
    ctx.spice.push(`K${ref} L${ref}P L${ref}SA L${ref}SB 0.995`);
  } else {
    ctx.spice.push(`L${ref}S ${node(pins.S1)} ${node(pins.S2)} ${eng(lsUh * 1e-6)}`);
    ctx.spice.push(`K${ref} L${ref}P L${ref}S 0.995`);
  }
  return ref;
}

function addGenericCap(ctx: Ctx, n1: string, n2: string, capF: number, label: string, priceUsd: number): string {
  const ref = nextRef(ctx, "C");
  ctx.comps.push({
    ref,
    kind: "capacitor",
    value: `${siFormat(capF, "F")} ${label}`,
    pins: { "1": n1, "2": n2 },
    meta: { mfr: "generic", description: `${label}, ${siFormat(capF, "F")}`, unitPriceUsd: priceUsd, suppliers: [] },
  });
  ctx.spice.push(`${ref} ${node(n1)} ${node(n2)} ${eng(capF)}`);
  return ref;
}

function addCapBank(ctx: Ctx, part: CapacitorPart, qty: number, n1: string, n2: string, label: string): string[] {
  const refs: string[] = [];
  for (let i = 0; i < Math.max(1, qty); i++) {
    const ref = nextRef(ctx, "C");
    ctx.comps.push({
      ref,
      kind: "capacitor",
      value: `${siFormat(part.capUf * 1e-6, "F")} ${part.voltageV} V ${part.dielectric}`,
      partId: part.id,
      pins: { "1": n1, "2": n2 },
      meta: {
        mfr: part.mfr,
        description: `${label} cap: ${siFormat(part.capUf * 1e-6, "F")} ${part.voltageV} V ${part.dielectric}`,
        unitPriceUsd: part.priceUsd1k,
        suppliers: part.suppliers,
      },
    });
    ctx.spice.push(`${ref} ${node(n1)} ${node(n2)} ${eng(part.capUf * 1e-6)}`);
    refs.push(ref);
  }
  return refs;
}

function addResistor(ctx: Ctx, n1: string, n2: string, ohms: number, label: string): string {
  const ref = nextRef(ctx, "R");
  ctx.comps.push({
    ref,
    kind: "resistor",
    value: `${siFormat(ohms, "Ω")} ${label}`,
    pins: { "1": n1, "2": n2 },
    meta: { mfr: "generic", description: `${label}, ${siFormat(ohms, "Ω")}`, unitPriceUsd: 0.02, suppliers: [] },
  });
  ctx.spice.push(`${ref} ${node(n1)} ${node(n2)} ${roundSig(ohms, 5)}`);
  return ref;
}

function addDiode(ctx: Ctx, anode: string, cathode: string, label: string): string {
  const ref = nextRef(ctx, "D");
  ctx.hasDiode = true;
  ctx.comps.push({
    ref,
    kind: "diode",
    value: label,
    pins: { A: anode, K: cathode },
    meta: { mfr: "generic", description: label, unitPriceUsd: 0.28, suppliers: [] },
  });
  ctx.spice.push(`${ref} ${node(anode)} ${node(cathode)} DGEN`);
  return ref;
}

function magByRole(mags: MagneticDesign[], role: MagneticDesign["role"]): MagneticDesign | undefined {
  return mags.find((m) => m.role === role);
}

// ---------------------------------------------------------------------------
// Per-topology plans
// ---------------------------------------------------------------------------

type Builder = (spec: DesignSpec, fsw: number, mags: MagneticDesign[], ctx: Ctx, nSlots: number) => TopoPlan;

const syncBuckB: Builder = (spec, fsw, mags, ctx) => {
  const vin = spec.vinNomV;
  const vout = spec.voutV;
  const iout = spec.poutW / Math.max(vout, 1e-3);
  const duty = clamp(vout / Math.max(vin, 1e-6), 0.05, 0.95);
  const m = magByRole(mags, "output-inductor") ?? mags[0];
  const fallbackUh = clamp(((vout * (1 - duty)) / (0.3 * Math.max(iout, 0.1) * fsw)) * 1e6, 0.1, 1000);
  const lRef = addInductor(ctx, "SW1", "VOUT", m, fallbackUh, "output inductor");
  return {
    positions: [
      { d: "VIN", s: "SW1", g: "G1", role: "high-side", phase: "main" },
      { d: "SW1", s: "PGND", g: "G2", role: "low-side SR", phase: "comp" },
    ],
    duty,
    shiftFrac: 0,
    vinNet: "VIN",
    outGnd: "PGND",
    inCapNets: ["VIN", "PGND"],
    outCapNets: ["VOUT", "PGND"],
    stages: [
      { title: "Half-bridge leg", lines: [], posIdx: [0, 1] },
      { title: "Output filter", lines: [lRef] },
    ],
    stageNets: ["VIN", "SW1", "VOUT"],
    acInput: false,
    isolated: false,
  };
};

const boostB: Builder = (spec, fsw, mags, ctx) => {
  const vin = spec.vinNomV;
  const vout = spec.voutV;
  const iin = spec.poutW / Math.max(vin, 1e-3);
  const duty = clamp(1 - vin / Math.max(vout, 1e-6), 0.05, 0.95);
  const m = magByRole(mags, "pfc-inductor") ?? magByRole(mags, "output-inductor") ?? mags[0];
  const fallbackUh = clamp(((vin * duty) / (0.3 * Math.max(iin, 0.1) * fsw)) * 1e6, 0.1, 2000);
  const lRef = addInductor(ctx, "VIN", "SW1", m, fallbackUh, "boost inductor");
  return {
    positions: [
      { d: "SW1", s: "PGND", g: "G1", role: "boost switch", phase: "main" },
      { d: "VOUT", s: "SW1", g: "G2", role: "sync rectifier", phase: "comp" },
    ],
    duty,
    shiftFrac: 0,
    vinNet: "VIN",
    outGnd: "PGND",
    inCapNets: ["VIN", "PGND"],
    outCapNets: ["VOUT", "PGND"],
    stages: [
      { title: "Boost choke", lines: [lRef] },
      { title: "Half-bridge leg", lines: [], posIdx: [0, 1] },
    ],
    stageNets: ["VIN", "SW1", "VOUT"],
    acInput: false,
    isolated: false,
  };
};

const totemPoleB: Builder = (spec, fsw, mags, ctx) => {
  const vac = spec.gridVacRms ?? 230;
  const vpk = vac * Math.SQRT2;
  const vbus = Math.max(spec.voutV, vpk * 1.05);
  const iacPk = (Math.SQRT2 * spec.poutW) / Math.max(vac, 1);
  const duty = clamp(1 - vpk / vbus, 0.05, 0.95);
  const m = magByRole(mags, "pfc-inductor") ?? mags[0];
  const fallbackUh = clamp(((vpk * duty) / (0.25 * Math.max(iacPk, 0.1) * fsw)) * 1e6, 5, 3000);
  const lRef = addInductor(ctx, "ACL", "SW1", m, fallbackUh, "PFC choke");
  return {
    positions: [
      { d: "VOUT", s: "SW1", g: "G1", role: "fast leg HS (GaN)", phase: "main" },
      { d: "SW1", s: "PGND", g: "G2", role: "fast leg LS (GaN)", phase: "comp" },
      { d: "VOUT", s: "ACN", g: "G3", role: "slow leg HS (line)", phase: "line" },
      { d: "ACN", s: "PGND", g: "G4", role: "slow leg LS (line)", phase: "lineComp" },
    ],
    duty,
    shiftFrac: 0,
    vinNet: "ACL",
    outGnd: "PGND",
    inCapNets: ["ACL", "ACN"],
    outCapNets: ["VOUT", "PGND"],
    stages: [
      { title: "PFC choke", lines: [lRef] },
      { title: "Totem-pole bridge", lines: ["fast leg @ fsw", "slow leg @ 2x line"], posIdx: [0, 1, 2, 3] },
    ],
    stageNets: ["ACL", "SW1", "VOUT"],
    acInput: true,
    isolated: false,
  };
};

const dabB: Builder = (spec, fsw, mags, ctx) => {
  const vin = spec.vinNomV;
  const vout = spec.voutV;
  const n = Math.max(vin / Math.max(vout, 1e-3), 0.1);
  const phi = 0.25;
  // P = n·V1·V2·φ(1−φ)/(fsw·L)  (phase-shift power-flow, per-unit φ)
  const fallbackLUh = clamp(((n * vin * vout * phi * (1 - phi)) / (fsw * Math.max(spec.poutW, 1))) * 1e6, 0.5, 500);
  const mL = magByRole(mags, "resonant-inductor") ?? magByRole(mags, "coupled-inductor");
  const mT = magByRole(mags, "transformer");
  const lRef = addInductor(ctx, "SW1", "LK1", mL, fallbackLUh, "DAB series inductor");
  const tRef = addTransformer(
    ctx,
    { P1: "LK1", P2: "SW2", S1: "SW3", S2: "SW4" },
    mT,
    n,
    clamp(((vin * vin * 0.2) / (Math.max(spec.poutW, 1) * fsw)) * 1e6, 10, 2000),
    false,
  );
  return {
    positions: [
      { d: "VIN", s: "SW1", g: "G1", role: "primary A-HS", phase: "main" },
      { d: "SW1", s: "PGND", g: "G2", role: "primary A-LS", phase: "comp" },
      { d: "VIN", s: "SW2", g: "G3", role: "primary B-HS", phase: "comp" },
      { d: "SW2", s: "PGND", g: "G4", role: "primary B-LS", phase: "main" },
      { d: "VOUT", s: "SW3", g: "G5", role: "secondary A-HS", phase: "shift" },
      { d: "SW3", s: "SGND", g: "G6", role: "secondary A-LS", phase: "shiftComp" },
      { d: "VOUT", s: "SW4", g: "G7", role: "secondary B-HS", phase: "shiftComp" },
      { d: "SW4", s: "SGND", g: "G8", role: "secondary B-LS", phase: "shift" },
    ],
    duty: 0.5,
    shiftFrac: phi,
    vinNet: "VIN",
    outGnd: "SGND",
    inCapNets: ["VIN", "PGND"],
    outCapNets: ["VOUT", "SGND"],
    stages: [
      { title: "Primary bridge", lines: [], posIdx: [0, 1, 2, 3] },
      { title: "DAB tank", lines: [`${lRef} + ${tRef}`] },
      { title: "Secondary bridge", lines: [], posIdx: [4, 5, 6, 7] },
    ],
    stageNets: ["VIN", "SW1/SW2", "SW3/SW4", "VOUT"],
    acInput: false,
    isolated: true,
  };
};

function llcPlan(spec: DesignSpec, fsw: number, mags: MagneticDesign[], ctx: Ctx, fullBridge: boolean): TopoPlan {
  const vin = spec.vinNomV;
  const vout = spec.voutV;
  const nRatio = Math.max((fullBridge ? vin : vin / 2) / Math.max(vout, 1e-3), 0.1);
  const rl = (vout * vout) / Math.max(spec.poutW, 1);
  const re = (8 * nRatio * nRatio * rl) / (Math.PI * Math.PI); // FHA reflected load
  const mLr = magByRole(mags, "resonant-inductor");
  const lrUh = mLr?.inductanceUh ?? clamp(((0.4 * re) / (2 * Math.PI * fsw)) * 1e6, 0.5, 500);
  const crF = 1 / (Math.pow(2 * Math.PI * fsw, 2) * lrUh * 1e-6); // series-resonant at fsw
  const crRef = addGenericCap(ctx, "SW1", "CR1", crF, "C0G/film resonant cap", 0.9);
  const lrRef = addInductor(ctx, "CR1", "PR1", mLr, lrUh, "resonant inductor");
  const mT = magByRole(mags, "transformer");
  const tRef = addTransformer(
    ctx,
    { P1: "PR1", P2: fullBridge ? "SW2" : "PGND", S1: "SEC_A", S2: "SEC_B", CT: "VOUT" },
    mT,
    nRatio,
    clamp(5 * lrUh, 20, 2000),
    true,
  );
  const positions: SwitchPos[] = fullBridge
    ? [
        { d: "VIN", s: "SW1", g: "G1", role: "primary A-HS", phase: "main" },
        { d: "SW1", s: "PGND", g: "G2", role: "primary A-LS", phase: "comp" },
        { d: "VIN", s: "SW2", g: "G3", role: "primary B-HS", phase: "comp" },
        { d: "SW2", s: "PGND", g: "G4", role: "primary B-LS", phase: "main" },
      ]
    : [
        { d: "VIN", s: "SW1", g: "G1", role: "primary HS", phase: "main" },
        { d: "SW1", s: "PGND", g: "G2", role: "primary LS", phase: "comp" },
      ];
  const srBase = positions.length;
  positions.push(
    { d: "SEC_A", s: "SGND", g: `G${srBase + 1}`, role: "SR A", phase: "comp" },
    { d: "SEC_B", s: "SGND", g: `G${srBase + 2}`, role: "SR B", phase: "main" },
  );
  return {
    positions,
    duty: 0.5,
    shiftFrac: 0,
    vinNet: "VIN",
    outGnd: "SGND",
    inCapNets: ["VIN", "PGND"],
    outCapNets: ["VOUT", "SGND"],
    stages: [
      { title: fullBridge ? "Full bridge" : "Half bridge", lines: [], posIdx: positions.slice(0, srBase).map((_, i) => i) },
      { title: "Resonant tank", lines: [`${crRef} ${lrRef} ${tRef}`] },
      { title: "Sync rectifier", lines: [], posIdx: [srBase, srBase + 1] },
    ],
    stageNets: ["VIN", fullBridge ? "SW1/SW2" : "SW1", "SEC_A/SEC_B", "VOUT"],
    acInput: false,
    isolated: true,
  };
}

const llcHalfB: Builder = (spec, fsw, mags, ctx) => llcPlan(spec, fsw, mags, ctx, false);
const llcFullB: Builder = (spec, fsw, mags, ctx) => llcPlan(spec, fsw, mags, ctx, true);

const psfbB: Builder = (spec, fsw, mags, ctx) => {
  const vin = spec.vinNomV;
  const vout = spec.voutV;
  const iout = spec.poutW / Math.max(vout, 1e-3);
  const nRatio = Math.max((vin * 0.8) / Math.max(vout, 1e-3), 0.1);
  const iPri = spec.poutW / Math.max(0.85 * vin, 1);
  const mLr = magByRole(mags, "resonant-inductor");
  const lrUh = mLr?.inductanceUh ?? clamp(((vin * 0.05) / (Math.max(iPri, 0.1) * fsw)) * 1e6, 0.3, 100);
  const lrRef = addInductor(ctx, "SW1", "PR1", mLr, lrUh, "ZVS shim inductor");
  const mT = magByRole(mags, "transformer");
  const tRef = addTransformer(
    ctx,
    { P1: "PR1", P2: "SW2", S1: "SEC_A", S2: "SEC_B", CT: "CT" },
    mT,
    nRatio,
    clamp(((vin * vin * 0.2) / (Math.max(spec.poutW, 1) * fsw)) * 1e6, 10, 2000),
    true,
  );
  const mLo = magByRole(mags, "output-inductor");
  const loUh = mLo?.inductanceUh ?? clamp(((vout * 0.2) / (0.3 * Math.max(iout, 0.1) * fsw)) * 1e6, 0.5, 500);
  const loRef = addInductor(ctx, "CT", "VOUT", mLo, loUh, "output inductor");
  return {
    positions: [
      { d: "VIN", s: "SW1", g: "G1", role: "leading leg HS", phase: "main" },
      { d: "SW1", s: "PGND", g: "G2", role: "leading leg LS", phase: "comp" },
      { d: "VIN", s: "SW2", g: "G3", role: "lagging leg HS", phase: "shift" },
      { d: "SW2", s: "PGND", g: "G4", role: "lagging leg LS", phase: "shiftComp" },
      { d: "SEC_A", s: "SGND", g: "G5", role: "SR A", phase: "comp" },
      { d: "SEC_B", s: "SGND", g: "G6", role: "SR B", phase: "main" },
    ],
    duty: 0.5,
    shiftFrac: 0.15,
    vinNet: "VIN",
    outGnd: "SGND",
    inCapNets: ["VIN", "PGND"],
    outCapNets: ["VOUT", "SGND"],
    stages: [
      { title: "Phase-shift bridge", lines: [], posIdx: [0, 1, 2, 3] },
      { title: "Transformer", lines: [`${lrRef} + ${tRef}`] },
      { title: "SR + filter", lines: [loRef], posIdx: [4, 5] },
    ],
    stageNets: ["VIN", "SW1/SW2", "SEC_A/SEC_B", "VOUT"],
    acInput: false,
    isolated: true,
  };
};

/** Generic hard-switched bridge for topologies without a bespoke arrangement. */
const genericB: Builder = (spec, fsw, mags, ctx, nSlots) => {
  const vin = spec.vinNomV;
  const vout = spec.voutV;
  const iout = spec.poutW / Math.max(vout, 1e-3);
  const iso = spec.isolated;
  const n = Math.max(1, Math.min(nSlots || 2, 4));
  const positions: SwitchPos[] = [];
  if (n === 1) {
    positions.push({ d: "SW1", s: "PGND", g: "G1", role: "primary switch", phase: "main" });
  } else {
    const legs = Math.ceil(n / 2);
    for (let i = 0; i < legs; i++) {
      const mid = `SW${i + 1}`;
      positions.push({ d: "VIN", s: mid, g: `G${positions.length + 1}`, role: "high-side", phase: "main" });
      if (positions.length < n)
        positions.push({ d: mid, s: "PGND", g: `G${positions.length + 1}`, role: "low-side", phase: "comp" });
    }
  }
  const duty = iso ? 0.45 : clamp(vout / Math.max(vin, 1e-6), 0.05, 0.95);
  const magLines: string[] = [];
  let stageNets: string[];
  let outGnd = "PGND";
  const stages: Stage[] = [{ title: "Bridge legs", lines: [], posIdx: positions.map((_, i) => i) }];
  if (iso) {
    outGnd = "SGND";
    const mT = magByRole(mags, "transformer") ?? mags[0];
    const priHigh = n === 1 ? "VIN" : "SW1";
    const priLow = n === 1 ? "SW1" : positions.length > 2 ? "SW2" : "PGND";
    const tRef = addTransformer(
      ctx,
      { P1: priHigh, P2: priLow, S1: "SEC_A", S2: "SGND" },
      mT,
      Math.max((vin * duty) / Math.max(vout, 1e-3), 0.1),
      clamp(((vin * vin * 0.2) / (Math.max(spec.poutW, 1) * fsw)) * 1e6, 10, 2000),
      false,
    );
    magLines.push(tRef);
    const dRef = addDiode(ctx, "SEC_A", "VOUT", "output rectifier");
    stages.push({ title: "Magnetics", lines: magLines });
    stages.push({ title: "Rectifier", lines: [dRef] });
    stageNets = ["VIN", "SW1", "SEC_A", "VOUT"];
  } else {
    const legs = Math.max(1, Math.ceil(n / 2));
    const inductorMags = mags.filter((m) => m.role.includes("inductor"));
    const fallbackUh = clamp(((vout * (1 - duty)) / (0.3 * Math.max(iout, 0.1) * fsw)) * 1e6, 0.1, 1000);
    for (let i = 0; i < (n === 1 ? 1 : legs); i++) {
      const m = inductorMags[i % Math.max(1, inductorMags.length)] ?? mags[0];
      magLines.push(addInductor(ctx, `SW${i + 1}`, "VOUT", m, fallbackUh, `phase ${i + 1} inductor`));
    }
    if (n === 1) addDiode(ctx, "PGND", "SW1", "freewheel diode");
    stages.push({ title: "Magnetics", lines: magLines });
    stageNets = ["VIN", "SW1", "VOUT"];
  }
  return {
    positions,
    duty,
    shiftFrac: 0,
    vinNet: "VIN",
    outGnd,
    inCapNets: ["VIN", "PGND"],
    outCapNets: ["VOUT", outGnd],
    stages,
    stageNets,
    acInput: false,
    isolated: iso,
  };
};

const BUILDERS: Record<TopologyId, Builder> = {
  buck: genericB,
  "sync-buck": syncBuckB,
  "interleaved-sync-buck": genericB,
  boost: boostB,
  "llc-half-bridge": llcHalfB,
  "llc-full-bridge": llcFullB,
  psfb: psfbB,
  dab: dabB,
  "totem-pole-pfc": totemPoleB,
  flyback: genericB,
  "forward-active-clamp": genericB,
};

// ---------------------------------------------------------------------------
// Switch slots
// ---------------------------------------------------------------------------

interface Slot {
  device: SwitchDevice;
  parallel: number;
  role: string;
}

const FALLBACK_DEVICE: SwitchDevice = {
  id: "GEN-GAN-650",
  mfr: "generic",
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
  rthJCcPerW: 1,
  pkg: "PQFN",
  priceUsd1k: 3.5,
  suppliers: [],
};

function flattenSlots(switches: DeviceLoss[]): Slot[] {
  const out: Slot[] = [];
  for (const d of switches) {
    const positions = Math.max(1, Math.round(d.positions));
    const parallel = Math.max(1, Math.round(d.parallelPerPosition || 1));
    for (let i = 0; i < positions; i++) out.push({ device: d.device, parallel, role: d.role });
  }
  return out;
}

// ---------------------------------------------------------------------------
// SPICE generation
// ---------------------------------------------------------------------------

function gateTiming(
  phase: Phase,
  T: number,
  ton: number,
  dt: number,
  shiftFrac: number,
): { td: number; w: number; period: number } {
  const Tl = 0.02; // 50 Hz line half-bridge
  const dtl = 2e-4;
  switch (phase) {
    case "main":
      return { td: 0, w: Math.max(ton - dt, 0.02 * T), period: T };
    case "comp":
      return { td: ton + dt, w: Math.max(T - ton - 2 * dt, 0.02 * T), period: T };
    case "shift":
      return { td: shiftFrac * T, w: Math.max(ton - dt, 0.02 * T), period: T };
    case "shiftComp":
      return { td: shiftFrac * T + ton + dt, w: Math.max(T - ton - 2 * dt, 0.02 * T), period: T };
    case "line":
      return { td: 0, w: Tl / 2 - dtl, period: Tl };
    case "lineComp":
      return { td: Tl / 2, w: Tl / 2 - dtl, period: Tl };
  }
}

function switchSubckt(dev: SwitchDevice): string[] {
  const id = san(dev.id);
  return [
    `.subckt SW_${id} D G S`,
    `S1 D S G S SMOD_${id}`,
    `.model SMOD_${id} SW(Ron=${roundSig(dev.rdsOnMohm25 * 1e-3, 4)} Roff=1e6 Vt=${roundSig(Math.max(dev.vthV * 0.8, 0.5), 3)} Vh=${roundSig(Math.max(dev.vthV * 0.15, 0.1), 3)})`,
    `.ends SW_${id}`,
  ];
}

// ---------------------------------------------------------------------------
// buildSchematic
// ---------------------------------------------------------------------------

export function buildSchematic(id: TopologyId, spec: DesignSpec, parts: SchematicParts): Schematic {
  const fsw = spec.fswHz ?? 200e3;
  const ctx = newCtx();
  const slots = flattenSlots(parts.switches);
  const plan = BUILDERS[id](spec, fsw, parts.magnetics ?? [], ctx, slots.length);

  // --- switches -----------------------------------------------------------
  const posRefs: string[][] = plan.positions.map(() => []);
  const posDevices: SwitchDevice[] = [];
  plan.positions.forEach((p, i) => {
    const slot = slots.length ? slots[Math.min(i, slots.length - 1)] : { device: FALLBACK_DEVICE, parallel: 1, role: p.role };
    posDevices.push(slot.device);
    for (let k = 0; k < slot.parallel; k++) {
      const ref = nextRef(ctx, "Q");
      const dev = slot.device;
      ctx.comps.push({
        ref,
        kind: "switch",
        value: `${dev.tech} ${dev.vdsMaxV} V ${dev.rdsOnMohm25} mΩ (${p.role})`,
        partId: dev.id,
        pins: { D: p.d, G: p.g, S: p.s },
        meta: {
          mfr: dev.mfr,
          description: `${dev.tech} FET ${dev.vdsMaxV} V / ${dev.idMaxA} A, ${dev.rdsOnMohm25} mΩ, ${dev.pkg}`,
          unitPriceUsd: dev.priceUsd1k,
          suppliers: dev.suppliers,
        },
      });
      ctx.spice.push(`X${ref} ${node(p.d)} ${node(p.g)} ${node(p.s)} SW_${san(dev.id)}`);
      posRefs[i].push(ref);
    }
  });

  // --- capacitor banks ----------------------------------------------------
  const capEntries = parts.caps ?? [];
  let inCapRefs: string[] = [];
  let outCapRefs: string[] = [];
  if (capEntries.length >= 2) {
    inCapRefs = addCapBank(ctx, capEntries[0].part, capEntries[0].qty, plan.inCapNets[0], plan.inCapNets[1], "input");
    for (const e of capEntries.slice(1))
      outCapRefs = outCapRefs.concat(addCapBank(ctx, e.part, e.qty, plan.outCapNets[0], plan.outCapNets[1], "output"));
  } else if (capEntries.length === 1) {
    const q = Math.max(2, capEntries[0].qty);
    const inQ = Math.max(1, Math.floor(q / 2));
    inCapRefs = addCapBank(ctx, capEntries[0].part, inQ, plan.inCapNets[0], plan.inCapNets[1], "input");
    outCapRefs = addCapBank(ctx, capEntries[0].part, q - inQ, plan.outCapNets[0], plan.outCapNets[1], "output");
  } else {
    const iout = spec.poutW / Math.max(spec.voutV, 1e-3);
    const cout = clamp(iout / (8 * fsw * Math.max(spec.voutV * 0.01, 1e-3)), 1e-6, 5e-3);
    inCapRefs = [addGenericCap(ctx, plan.inCapNets[0], plan.inCapNets[1], 1e-5, "input cap", 0.6)];
    outCapRefs = [addGenericCap(ctx, plan.outCapNets[0], plan.outCapNets[1], cout, "output cap", 0.6)];
  }

  // --- feedback divider ---------------------------------------------------
  const r2 = 10_000;
  const r1 = Math.max(1_000, roundSig((spec.voutV / 2.5 - 1) * r2, 3));
  addResistor(ctx, "VOUT", "FB", r1, "FB divider top");
  addResistor(ctx, "FB", plan.outGnd, r2, "FB divider bottom");

  // --- controller ---------------------------------------------------------
  const ctlRef = nextRef(ctx, "U");
  const ctlPins: Record<string, string> = { VDD: "VCC", GND: plan.outGnd, FB: "FB" };
  plan.positions.forEach((_, i) => (ctlPins[`PWM${i + 1}`] = `PWM${i + 1}`));
  ctx.comps.push({
    ref: ctlRef,
    kind: "controller",
    value: `${parts.controller.family} digital controller`,
    partId: parts.controller.id,
    pins: ctlPins,
    meta: {
      mfr: parts.controller.mfr,
      description: `${parts.controller.family} controller, ${parts.controller.coreMhz} MHz, ${parts.controller.adcBits}-bit ADC`,
      unitPriceUsd: parts.controller.priceUsd1k,
      suppliers: parts.controller.suppliers,
    },
  });

  // --- gate drivers (one dual-channel driver per half-bridge leg) ---------
  const drvRefs: string[] = [];
  for (let j = 0; j * 2 < plan.positions.length; j++) {
    const hi = plan.positions[2 * j];
    const lo = plan.positions[2 * j + 1];
    const ref = nextRef(ctx, "U");
    const pins: Record<string, string> = {
      VDD: "VCC",
      GND: (lo ?? hi).s,
      INA: `PWM${2 * j + 1}`,
      OUTA: hi.g,
    };
    if (lo) {
      pins.INB = `PWM${2 * j + 2}`;
      pins.OUTB = lo.g;
    }
    ctx.comps.push({
      ref,
      kind: "driver",
      value: `${parts.driver.channels}-ch gate driver, ${parts.driver.peakSourceA}/${parts.driver.peakSinkA} A`,
      partId: parts.driver.id,
      pins,
      meta: {
        mfr: parts.driver.mfr,
        description: `gate driver ${parts.driver.id}, CMTI ${parts.driver.cmtiVPerNs} V/ns${parts.driver.isolated ? ", isolated" : ""}`,
        unitPriceUsd: parts.driver.priceUsd1k,
        suppliers: parts.driver.suppliers,
      },
    });
    drvRefs.push(ref);
  }

  // --- connectors ---------------------------------------------------------
  const j1 = nextRef(ctx, "J");
  ctx.comps.push({
    ref: j1,
    kind: "connector",
    value: plan.acInput ? "AC input connector" : "DC input connector",
    pins: { "1": plan.vinNet, "2": plan.acInput ? "ACN" : "PGND" },
    meta: { mfr: "generic", description: "input power connector", unitPriceUsd: 1.4, suppliers: [] },
  });
  const j2 = nextRef(ctx, "J");
  ctx.comps.push({
    ref: j2,
    kind: "connector",
    value: "DC output connector",
    pins: { "1": "VOUT", "2": plan.outGnd },
    meta: { mfr: "generic", description: "output power connector", unitPriceUsd: 1.4, suppliers: [] },
  });

  // --- nets ---------------------------------------------------------------
  const netSet = new Set<string>();
  for (const c of ctx.comps) for (const netName of Object.values(c.pins)) netSet.add(netName);
  const prio = (n: string): number =>
    n === "VIN" || n === "ACL" ? 0
    : n === "ACN" ? 1
    : n === "PGND" ? 2
    : /^SW\d+$/.test(n) ? 3
    : n === "VOUT" ? 4
    : n === "SGND" ? 5
    : /^G\d+$/.test(n) ? 6
    : /^PWM\d+$/.test(n) ? 7
    : 8;
  const nets = [...netSet].sort((a, b) => prio(a) - prio(b) || a.localeCompare(b, undefined, { numeric: true }));

  // --- SPICE --------------------------------------------------------------
  const T = 1 / fsw;
  const dt = Math.max(20e-9, 0.02 * T);
  const ton = clamp(plan.duty, 0.05, 0.95) * T;
  const spice: string[] = [];
  spice.push(`* VoltForge ${id} — auto-generated SPICE netlist (${spec.name ?? "design"})`);
  spice.push(`* fsw=${siFormat(fsw, "Hz")}, duty=${roundSig(plan.duty, 3)}. Net PGND is SPICE node 0.`);
  if (plan.acInput) {
    const vpk = (spec.gridVacRms ?? 230) * Math.SQRT2;
    spice.push(`VAC ACL ACN SIN(0 ${roundSig(vpk, 4)} 50)`);
  } else {
    spice.push(`VDC VIN 0 DC ${roundSig(spec.vinNomV, 4)}`);
  }
  const vgsMax = Math.max(...posDevices.map((d) => d.vgsDriveV), 5);
  spice.push(`VAUX VCC 0 DC ${roundSig(vgsMax, 3)}`);
  spice.push(`RVCC VCC 0 1000`);
  plan.positions.forEach((p, i) => {
    const tm = gateTiming(p.phase, T, ton, dt, plan.shiftFrac);
    const vgs = roundSig(posDevices[i].vgsDriveV, 3);
    spice.push(`VG${i + 1} ${node(p.g)} ${node(p.s)} PULSE(0 ${vgs} ${eng(tm.td)} 5.000e-9 5.000e-9 ${eng(tm.w)} ${eng(tm.period)})`);
    spice.push(`VP${i + 1} PWM${i + 1} 0 PULSE(0 3.3 ${eng(tm.td)} 5.000e-9 5.000e-9 ${eng(tm.w)} ${eng(tm.period)})`);
  });
  spice.push(...ctx.spice);
  spice.push(`RLOAD VOUT ${node(plan.outGnd)} ${roundSig((spec.voutV * spec.voutV) / Math.max(spec.poutW, 1e-3), 5)}`);
  if (plan.outGnd === "SGND") spice.push(`RTIE SGND 0 1e6`);
  if (ctx.hasDiode) spice.push(`.model DGEN D(Is=1e-9 N=1.8)`);
  const seen = new Set<string>();
  for (const dev of posDevices) {
    if (seen.has(dev.id)) continue;
    seen.add(dev.id);
    spice.push(...switchSubckt(dev));
  }
  const stop = plan.acInput ? 0.04 : 20 * T;
  const step = plan.acInput ? 1e-6 : T / 200;
  spice.push(`.tran ${eng(step)} ${eng(stop)}`);
  spice.push(`.end`);

  // --- SVG ----------------------------------------------------------------
  const svg = buildSvg(id, spec, fsw, plan, ctx.comps, posRefs, posDevices, inCapRefs, outCapRefs, drvRefs, ctlRef, parts, nets);

  return { nets, components: ctx.comps, svg, spiceNetlist: spice.join("\n") };
}

// ---------------------------------------------------------------------------
// SVG one-line diagram
// ---------------------------------------------------------------------------

function rangeLabel(refs: string[]): string {
  if (refs.length === 0) return "";
  if (refs.length <= 3) return refs.join(" ");
  return `${refs[0]}…${refs[refs.length - 1]}`;
}

function chunkLine(prefix: string, items: string[], per: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length; i += per) {
    out.push((i === 0 ? prefix : "      ") + items.slice(i, i + per).join(" "));
  }
  return out.length ? out : [prefix];
}

function buildSvg(
  id: TopologyId,
  spec: DesignSpec,
  fsw: number,
  plan: TopoPlan,
  comps: AnnotatedNetlistComponent[],
  posRefs: string[][],
  posDevices: SwitchDevice[],
  inCapRefs: string[],
  outCapRefs: string[],
  drvRefs: string[],
  ctlRef: string,
  parts: SchematicParts,
  nets: string[],
): string {
  const width = 940;
  const gap = 44;
  const x0 = 24;
  const portW = 92;
  const y = 64;
  const h = 100;
  const nStages = plan.stages.length;
  const stageW = clamp(Math.floor((width - 2 * x0 - 2 * portW - gap * (nStages + 1)) / nStages), 120, 230);

  const blocks: DiagramBlock[] = [];
  const wires: DiagramWire[] = [];
  let x = x0;
  blocks.push({
    id: "in",
    x,
    y,
    w: portW,
    h,
    title: plan.acInput ? "AC IN" : "DC IN",
    lines: ["J1", rangeLabel(inCapRefs), plan.acInput ? "ACL / ACN" : `${plan.vinNet} / PGND`],
  });
  x += portW + gap;
  const stageIds: string[] = [];
  plan.stages.forEach((st, si) => {
    const bid = `s${si}`;
    stageIds.push(bid);
    const lines: string[] = [];
    if (st.posIdx && st.posIdx.length) {
      const refs = st.posIdx.flatMap((i) => posRefs[i]);
      const dev = posDevices[st.posIdx[0]];
      lines.push(`${rangeLabel(refs)} ${dev ? dev.id : ""}`.trim());
    }
    lines.push(...st.lines);
    blocks.push({ id: bid, x, y, w: stageW, h, title: st.title, lines });
    x += stageW + gap;
  });
  blocks.push({
    id: "out",
    x,
    y,
    w: portW,
    h,
    title: "OUTPUT",
    lines: ["J2", rangeLabel(outCapRefs), `VOUT / ${plan.outGnd}`],
  });

  const rowIds = ["in", ...stageIds, "out"];
  for (let i = 0; i < rowIds.length - 1; i++) {
    wires.push({ from: rowIds[i], to: rowIds[i + 1], label: plan.stageNets[i] });
  }

  // control row
  const firstSwitchStage = plan.stages.findIndex((s) => s.posIdx && s.posIdx.length);
  const bridgeBlock = blocks.find((b) => b.id === `s${firstSwitchStage}`) ?? blocks[1];
  const y2 = y + h + 56;
  const h2 = 68;
  const drvX = Math.min(bridgeBlock.x, width - 24 - 200 - 70 - 220);
  blocks.push({
    id: "drv",
    x: drvX,
    y: y2,
    w: 200,
    h: h2,
    title: "Gate drive",
    lines: [`${rangeLabel(drvRefs)} ${parts.driver.id}`, `${drvRefs.length}x half-bridge driver`],
  });
  blocks.push({
    id: "ctl",
    x: drvX + 200 + 70,
    y: y2,
    w: 220,
    h: h2,
    title: "Controller",
    lines: [`${ctlRef} ${parts.controller.id}`, "FB: R1 / R2 divider"],
  });
  wires.push({ from: "ctl", to: "drv", label: `PWM1..${plan.positions.length}`, dashed: true });
  plan.stages.forEach((st, si) => {
    if (st.posIdx && st.posIdx.length) {
      const gates = st.posIdx.map((i) => plan.positions[i].g);
      wires.push({ from: "drv", to: `s${si}`, label: rangeLabel(gates), dashed: true });
    }
  });
  wires.push({ from: "out", to: "ctl", label: "FB", dashed: true });

  const footer = [
    ...chunkLine("REFS: ", comps.map((c) => c.ref), 18),
    ...chunkLine("NETS: ", nets, 14),
  ];
  const height = y2 + h2 + 40 + footer.length * 16 + 12;

  return renderDiagram({
    width,
    height,
    title: `${spec.name ?? "VoltForge"} — ${id} one-line diagram`,
    subtitle: `${roundSig(spec.vinNomV, 4)} V → ${roundSig(spec.voutV, 4)} V, ${siFormat(spec.poutW, "W")}, fsw ${siFormat(fsw, "Hz")}`,
    blocks,
    wires,
    footer,
  });
}
