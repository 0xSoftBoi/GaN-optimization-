/**
 * PCB layout guidance: stackup, quantified routing rules (loop areas scaled
 * from fsw and working voltage), critical-loop table, and a placement
 * floorplan SVG in the VoltForge dark/cyan style.
 *
 * Method notes:
 *  - Loop-area limits follow the parasitic-inductance budget of hard-switched
 *    GaN: at >500 kHz the power commutation loop must stay <20 mm² (≈2 nH)
 *    and the gate loop <10 mm². Limits scale ~1/fsw, clamped to practical
 *    bounds; soft-switched topologies (LLC/DAB/PSFB) get a 1.5x relaxation.
 *  - Creepage/clearance from an IEC 62368-1-style table (pollution degree 2,
 *    material group II), linear interpolation between table rows.
 */

import type { DesignSpec, LayoutGuidance, TopologyId } from "@/lib/types";
import { clamp, interp1, roundSig, siFormat } from "@/lib/util";

const SOFT_SWITCHED: ReadonlySet<TopologyId> = new Set<TopologyId>([
  "llc-half-bridge",
  "llc-full-bridge",
  "psfb",
  "dab",
]);

const ISOLATED_TOPOLOGIES: ReadonlySet<TopologyId> = new Set<TopologyId>([
  "llc-half-bridge",
  "llc-full-bridge",
  "psfb",
  "dab",
  "flyback",
  "forward-active-clamp",
]);

/** Max power-commutation-loop area, mm². Tightens with fsw; ZVS relaxes 1.5x. */
export function powerLoopLimitMm2(fswHz: number, softSwitched: boolean): number {
  const base = clamp(1e7 / Math.max(fswHz, 1), 5, 50);
  return roundSig(softSwitched ? base * 1.5 : base, 3);
}

/** Max gate-drive-loop area, mm². <10 mm² above 500 kHz. */
export function gateLoopLimitMm2(fswHz: number): number {
  return roundSig(clamp(5e6 / Math.max(fswHz, 1), 2, 20), 3);
}

/** Creepage, mm (IEC 62368-1-style, PD2, MG II). */
export function creepageMm(workingV: number, reinforced = false): number {
  const basic = interp1(
    [50, 100, 150, 300, 600, 800, 1000],
    [0.6, 1.0, 1.6, 3.2, 6.3, 8.0, 10.0],
    Math.max(workingV, 0),
  );
  return roundSig(reinforced ? Math.max(2 * basic, 5.5) : basic, 3);
}

/** Clearance (through air), mm. */
export function clearanceMm(workingV: number): number {
  return roundSig(
    interp1([50, 100, 150, 300, 600, 800, 1000], [0.2, 0.5, 0.8, 1.9, 4.0, 5.5, 7.5], Math.max(workingV, 0)),
    3,
  );
}

export function layoutGuidance(id: TopologyId, spec: DesignSpec, fswHz: number): LayoutGuidance {
  const soft = SOFT_SWITCHED.has(id);
  const isolated = spec.isolated || ISOLATED_TOPOLOGIES.has(id);
  const workingV = Math.max(spec.vinMaxV, spec.voutV, (spec.gridVacRms ?? 0) * Math.SQRT2);
  const pLoop = powerLoopLimitMm2(fswHz, soft);
  const gLoop = gateLoopLimitMm2(fswHz);
  const creep = creepageMm(workingV);
  const clear = clearanceMm(workingV);
  const creepReinforced = creepageMm(workingV, true);
  const iMax = Math.max(spec.poutW / Math.max(spec.voutV, 1e-3), spec.poutW / Math.max(spec.vinMinV, 1e-3));
  const layers = spec.poutW > 1000 ? 6 : 4;
  const ozOuter = iMax > 30 ? 3 : 2;
  const ozInner = layers === 6 ? 2 : 1;
  const viaCount = Math.round(clamp(9 + spec.poutW / 100, 9, 36));

  const stackup =
    layers === 6
      ? [
          `L1 (top, ${ozOuter} oz Cu): power stage, SW nodes, gate loops — all HF current stays here`,
          `L2 (${ozInner} oz): unbroken PGND return plane, ≤0.15 mm prepreg below L1 (vertical loop-area control)`,
          `L3 (${ozInner} oz): VIN / VOUT power pours`,
          `L4 (${ozInner} oz): signal + gate returns (kelvin routes)`,
          `L5 (${ozInner} oz): second GND / return plane`,
          `L6 (bottom, ${ozOuter} oz): thermal spreading copper, controller signals, stitching vias`,
        ]
      : [
          `L1 (top, ${ozOuter} oz Cu): power stage, SW nodes, gate loops — all HF current stays here`,
          `L2 (${ozInner} oz): unbroken PGND return plane, ≤0.15 mm prepreg below L1 (vertical loop-area control)`,
          `L3 (${ozInner} oz): VIN / VOUT power pours + signal`,
          `L4 (bottom, ${ozOuter} oz): thermal spreading copper, controller signals, stitching vias`,
        ];

  const rules: string[] = [
    `Power commutation loop ≤ ${pLoop} mm² at ${siFormat(fswHz, "Hz")}${
      soft
        ? " (soft-switched topology: 1.5x relaxation applied, still route as a vertical loop through the L2 plane)"
        : fswHz > 500e3
          ? " (hard-switched GaN above 500 kHz: keep <20 mm²; use vertical loop through the L2 plane, ≈2 nH budget)"
          : " (route bridge + DC-link decoupling as a vertical loop through the L2 plane)"
    }`,
    `Gate drive loop ≤ ${gLoop} mm²: driver within 5 mm of the gate pin, gate return on the adjacent layer directly under the gate trace`,
    `Kelvin-source routing: return every gate driver to the device kelvin/source sense pin; never share the power source-current path (common-source inductance ≪ 1 nH)`,
    `Creepage ≥ ${creep} mm and clearance ≥ ${clear} mm for ${roundSig(workingV, 3)} V working voltage (IEC 62368-1 style, pollution degree 2, material group II)`,
    `Thermal via array under every power pad: ≥${viaCount} vias, 0.3 mm drill, 1.0 mm pitch, filled/capped, tied to the ${layers === 6 ? "L2/L5 planes" : "L2 plane"} and bottom spreading copper`,
    `Place 100 nF X7R + 1 µF decoupling within 3 mm of every half-bridge; DC-link bulk caps directly at the bridge, not across the board`,
    `Keep SW-node copper area <100 mm² per node (dv/dt source — EMI and CM current scale with SW-node capacitance)`,
    `No plane splits under the power loop or gate loops; stitch GND planes with vias every 5 mm around the power stage perimeter`,
  ];
  if (isolated) {
    rules.push(
      `Reinforced isolation barrier: ≥ ${creepReinforced} mm creepage primary↔secondary across the transformer/optocoupler zone; slot the PCB (≥1 mm routed slot) where creepage falls short`,
    );
  }
  if (id === "totem-pole-pfc") {
    rules.push(
      `Line-frequency (slow) leg may use wider spacing; keep the fast GaN leg loop to the ${pLoop} mm² budget and the AC traces ≥ ${creep} mm from SELV circuitry`,
    );
  }

  const criticalLoops: LayoutGuidance["criticalLoops"] = [
    {
      name: "power commutation loop (per half-bridge leg)",
      maxAreaMm2: pLoop,
      note: soft
        ? "ZVS reduces di/dt stress; limit relaxed 1.5x but keep the vertical-loop construction"
        : "highest di/dt path: bridge devices + ceramic DC-link caps; overshoot = Lloop x di/dt",
    },
    { name: "HS gate loop", maxAreaMm2: gLoop, note: "driver → gate → kelvin-source return, adjacent-layer return plane" },
    { name: "LS gate loop", maxAreaMm2: gLoop, note: "driver → gate → kelvin-source return, adjacent-layer return plane" },
    {
      name: "current-sense kelvin loop",
      maxAreaMm2: 5,
      note: "differential pair over solid plane from shunt to controller ADC",
    },
  ];
  if (soft) {
    criticalLoops.push({
      name: "resonant tank loop",
      maxAreaMm2: roundSig(4 * pLoop, 3),
      note: "sinusoidal current — loop area matters for radiated EMI, not overshoot",
    });
  }
  if (id === "totem-pole-pfc") {
    criticalLoops.push({
      name: "line-frequency return loop",
      maxAreaMm2: 2000,
      note: "50/60 Hz path through slow leg and EMI filter; area non-critical, spacing critical",
    });
  }

  const placementSvg = renderFloorplan(id, spec, pLoop, gLoop, isolated, creepReinforced);

  return { stackup, placementSvg, rules, criticalLoops };
}

// ---------------------------------------------------------------------------
// Floorplan SVG (self-contained; VoltForge dark/cyan style)
// ---------------------------------------------------------------------------

const BG = "#0a0e14";
const ACCENT = "#22d3ee";
const TEXT = "#e2f4ff";
const MUTED = "#8fb8c9";
const FILL = "#101826";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function block(x: number, y: number, w: number, h: number, title: string, sub: string[]): string {
  const cx = x + w / 2;
  const lines = sub
    .map(
      (s, i) =>
        `<text x="${cx}" y="${y + 38 + i * 15}" fill="${MUTED}" font-size="12" text-anchor="middle">${esc(s)}</text>`,
    )
    .join("");
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${FILL}" stroke="${ACCENT}" stroke-width="1.5"/>` +
    `<text x="${cx}" y="${y + 20}" fill="${TEXT}" font-size="13" font-weight="bold" text-anchor="middle">${esc(title)}</text>` +
    lines
  );
}

function arrow(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ACCENT}" stroke-width="1.8" marker-end="url(#larr)"/>`;
}

const BRIDGE_TITLE: Record<TopologyId, string> = {
  buck: "Switch + diode",
  "sync-buck": "Half-bridge",
  "interleaved-sync-buck": "Interleaved legs",
  boost: "Boost leg",
  "llc-half-bridge": "LLC half-bridge",
  "llc-full-bridge": "LLC full-bridge",
  psfb: "Phase-shift bridge",
  dab: "Primary + secondary bridges",
  "totem-pole-pfc": "Totem-pole bridge",
  flyback: "Primary switch",
  "forward-active-clamp": "Primary + clamp",
};

function renderFloorplan(
  id: TopologyId,
  spec: DesignSpec,
  pLoop: number,
  gLoop: number,
  isolated: boolean,
  creepReinforced: number,
): string {
  const W = 940;
  const H = 430;
  const y = 110;
  const h = 120;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace">`,
    `<defs><marker id="larr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${ACCENT}"/></marker></defs>`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="${BG}"/>`,
    `<text x="24" y="28" fill="${TEXT}" font-size="16" font-weight="bold">${esc(`${spec.name ?? "VoltForge"} — ${id} placement floorplan`)}</text>`,
    `<text x="24" y="46" fill="${MUTED}" font-size="12">${esc(
      `power flow left → right; power loop ≤ ${pLoop} mm², gate loop ≤ ${gLoop} mm²`,
    )}</text>`,
  );

  // thermal / airflow zone behind power stage + magnetics
  parts.push(
    `<rect x="240" y="${y - 24}" width="470" height="${h + 48}" rx="10" fill="none" stroke="${MUTED}" stroke-width="1.2" stroke-dasharray="6 5"/>`,
    `<text x="475" y="${y - 32}" fill="${MUTED}" font-size="12" text-anchor="middle">thermal zone — heatsink / airflow (${esc(
      spec.cooling,
    )})</text>`,
  );

  parts.push(block(24, y, 80, h, "J1 IN", ["input", "connector"]));
  parts.push(block(128, y, 100, h, "EMI + Cin", ["input filter", "DC-link caps", "bulk close to", "bridge"]));
  parts.push(block(252, y, 190, h, BRIDGE_TITLE[id], ["GaN/SiC devices", "gate drivers <5 mm", `loop ≤ ${pLoop} mm²`, "kelvin-source"]));
  parts.push(block(466, y, 130, h, "Magnetics", ["inductor /", "transformer", "keep SW copper", "small"]));
  parts.push(block(620, y, 110, h, "Cout bank", ["output caps", "low-ESL first", "then bulk"]));
  parts.push(block(754, y, 80, h, "J2 OUT", ["output", "connector"]));
  parts.push(block(128, 280, 220, 80, "Controller", ["quiet zone: ADC + FB", "over solid GND, away", "from SW nodes"]));
  parts.push(block(400, 280, 250, 80, "Sense + protection", ["shunt kelvin pair", "OCP/OVP comparators", "gate-driver supplies"]));

  const my = y + h / 2;
  parts.push(arrow(104, my, 128, my));
  parts.push(arrow(228, my, 252, my));
  parts.push(arrow(442, my, 466, my));
  parts.push(arrow(596, my, 620, my));
  parts.push(arrow(730, my, 754, my));
  parts.push(arrow(238, 320, 252, y + h)); // controller → bridge (gate signals)
  parts.push(arrow(525, 280, 525, y + h)); // sense ← power row

  if (isolated) {
    parts.push(
      `<line x1="610" y1="60" x2="610" y2="${H - 40}" stroke="${ACCENT}" stroke-width="1.4" stroke-dasharray="3 6"/>`,
      `<text x="618" y="${H - 46}" fill="${ACCENT}" font-size="12">isolation barrier ≥ ${creepReinforced} mm creepage</text>`,
    );
  }

  parts.push("</svg>");
  return parts.join("\n");
}
