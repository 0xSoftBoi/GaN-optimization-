/**
 * VoltForge thermal engine.
 *
 * Model: lumped Rth ladder per switch position sharing one heatsink.
 *
 *   Tsink = Tamb + Pdev,total · RthSA
 *   Tj    = Tsink + Ppos · (RthJC + RthCS) / nParallel
 *
 * where Ppos is the dissipation of one switch position (all paralleled dies
 * on that position combined), and paralleled dies divide the junction-to-sink
 * resistance because each die has its own case + TIM path into the shared sink.
 *
 * Heatsink selection: cheapest catalog entry whose worst-node junction margin
 * is >= SELECTION_MARGIN_C below spec.maxJunctionC for the given cooling mode.
 * Forced-air uses rthSaCPerWForced when the sink is rated for it. Liquid and
 * cold-plate cooling bypass the catalog with a low fixed sink resistance
 * (typical machined cold plate: 0.05–0.15 °C/W).
 *
 * Magnetics/capacitor/overhead losses are assumed NOT to flow through the
 * device heatsink (board- or chassis-cooled) and are reported in notes only.
 */
import type {
  Cooling,
  DesignSpec,
  Heatsink,
  LossBreakdown,
  ThermalNode,
  ThermalReport,
} from "@/lib/types";
import { roundSig, sum } from "@/lib/util";

/** Case-to-sink interface (TIM pad + mounting), per device. */
export const RTH_CS_C_PER_W = 0.5;
/** Default junction limit when spec.maxJunctionC is absent. */
export const DEFAULT_TJ_MAX_C = 125;
/** Design margin required below maxJunctionC when picking a heatsink. */
export const SELECTION_MARGIN_C = 15;
/** Liquid / cold-plate sink-to-coolant resistance (mid of 0.05–0.15 °C/W). */
export const COLD_PLATE_RTH_SA_C_PER_W = 0.08;

/**
 * Internal fallback catalog — small set of generic extrusions spanning
 * ~1.8–12 °C/W natural. Callers normally inject HEATSINKS from the data
 * module; this list only guarantees the solver is self-contained.
 */
export const FALLBACK_HEATSINKS: Heatsink[] = [
  {
    id: "HS-EXT-15",
    mfr: "Generic",
    rthSaCPerWNatural: 12.0,
    rthSaCPerWForced: 4.8,
    heightMm: 15,
    footprintMm: [30, 30],
    priceUsd: 0.9,
  },
  {
    id: "HS-EXT-25",
    mfr: "Generic",
    rthSaCPerWNatural: 8.5,
    rthSaCPerWForced: 3.3,
    heightMm: 25,
    footprintMm: [40, 40],
    priceUsd: 1.6,
  },
  {
    id: "HS-EXT-37",
    mfr: "Generic",
    rthSaCPerWNatural: 5.6,
    rthSaCPerWForced: 2.1,
    heightMm: 37,
    footprintMm: [60, 45],
    priceUsd: 3.2,
  },
  {
    id: "HS-CHAN-50",
    mfr: "Generic",
    rthSaCPerWNatural: 3.2,
    rthSaCPerWForced: 1.2,
    heightMm: 50,
    footprintMm: [80, 60],
    priceUsd: 6.4,
  },
  {
    id: "HS-CHAN-84",
    mfr: "Generic",
    rthSaCPerWNatural: 1.8,
    rthSaCPerWForced: 0.65,
    heightMm: 84,
    footprintMm: [120, 80],
    priceUsd: 14.0,
  },
];

/** Effective sink-to-ambient resistance of a catalog sink in a cooling mode. */
export function sinkRthSa(hs: Heatsink, cooling: Cooling): number {
  if (cooling === "forced-air" && hs.rthSaCPerWForced !== undefined) {
    return hs.rthSaCPerWForced;
  }
  return hs.rthSaCPerWNatural;
}

function totalDeviceW(losses: LossBreakdown): number {
  return sum(losses.devices.map((d) => d.totalW));
}

/** Build per-position junction nodes for a given sink-to-ambient resistance. */
function solveNodes(
  losses: LossBreakdown,
  spec: DesignSpec,
  rthSaCPerW: number,
): ThermalNode[] {
  const limitC = spec.maxJunctionC ?? DEFAULT_TJ_MAX_C;
  const tSinkC = spec.ambientC + totalDeviceW(losses) * rthSaCPerW;
  return losses.devices.map((d) => {
    const positions = Math.max(1, d.positions);
    const nPar = Math.max(1, d.parallelPerPosition);
    const pPosW = d.totalW / positions;
    // Parallel dies split current AND thermal paths into the shared sink.
    const rthJsCPerW = (d.device.rthJCcPerW + RTH_CS_C_PER_W) / nPar;
    const tjC = tSinkC + pPosW * rthJsCPerW;
    return {
      name:
        `${d.role} (${d.device.id}` +
        (positions > 1 ? ` ×${positions}` : "") +
        (nPar > 1 ? `, ${nPar}∥` : "") +
        ")",
      dissipationW: roundSig(pPosW, 4),
      tjC: roundSig(tjC, 4),
      limitC,
      marginC: roundSig(limitC - tjC, 4),
    };
  });
}

function worstMargin(nodes: ThermalNode[], spec: DesignSpec): number {
  if (nodes.length === 0) {
    return (spec.maxJunctionC ?? DEFAULT_TJ_MAX_C) - spec.ambientC;
  }
  return Math.min(...nodes.map((n) => n.marginC));
}

/**
 * Solve steady-state junction temperatures and pick a heatsink.
 *
 * Selection: cheapest sink (within spec.heightLimitMm when given) whose worst
 * junction margin is >= SELECTION_MARGIN_C. If none qualifies, the
 * best-performing sink is used and the report explains the shortfall.
 */
export function solveThermal(
  losses: LossBreakdown,
  spec: DesignSpec,
  heatsinks?: Heatsink[],
): ThermalReport {
  const notes: string[] = [];
  const pDevW = totalDeviceW(losses);
  const pOtherW =
    losses.magneticsCoreW +
    losses.magneticsCopperW +
    losses.capacitorW +
    losses.overheadW;
  notes.push(
    `Device dissipation on sink: ${roundSig(pDevW, 3)} W; ` +
      `magnetics/caps/overhead (${roundSig(pOtherW, 3)} W) board-cooled.`,
  );

  // ---- liquid / cold-plate: fixed low RthSA, no catalog sink -------------
  if (spec.cooling === "liquid" || spec.cooling === "cold-plate") {
    const nodes = solveNodes(losses, spec, COLD_PLATE_RTH_SA_C_PER_W);
    const worstMarginC = roundSig(worstMargin(nodes, spec), 4);
    notes.push(
      `${spec.cooling} cooling: cold plate RthSA = ` +
        `${COLD_PLATE_RTH_SA_C_PER_W} °C/W assumed (no air heatsink).`,
    );
    return {
      ambientC: spec.ambientC,
      cooling: spec.cooling,
      heatsink: undefined,
      nodes,
      worstMarginC,
      ok: worstMarginC >= 0,
      notes,
    };
  }

  // ---- natural / forced-air: pick from injected (or fallback) catalog ----
  let catalog = (heatsinks?.length ? heatsinks : FALLBACK_HEATSINKS).slice();
  if (spec.heightLimitMm !== undefined) {
    const fitting = catalog.filter((h) => h.heightMm <= spec.heightLimitMm!);
    if (fitting.length > 0) {
      catalog = fitting;
    } else {
      notes.push(
        `No catalog heatsink fits height limit ${spec.heightLimitMm} mm; ` +
          `limit ignored for selection.`,
      );
    }
  }
  catalog.sort((a, b) => a.priceUsd - b.priceUsd);

  let chosen: Heatsink | undefined;
  let chosenNodes: ThermalNode[] | undefined;
  for (const hs of catalog) {
    const nodes = solveNodes(losses, spec, sinkRthSa(hs, spec.cooling));
    if (worstMargin(nodes, spec) >= SELECTION_MARGIN_C) {
      chosen = hs;
      chosenNodes = nodes;
      break; // sorted by price: first hit is the cheapest qualifying sink
    }
  }
  if (!chosen) {
    // No sink meets the margin: fall back to the best performer (lowest Rth).
    chosen = catalog.reduce((best, h) =>
      sinkRthSa(h, spec.cooling) < sinkRthSa(best, spec.cooling) ? h : best,
    );
    chosenNodes = solveNodes(losses, spec, sinkRthSa(chosen, spec.cooling));
    notes.push(
      `No catalog heatsink meets Tj limit with ${SELECTION_MARGIN_C} °C ` +
        `margin; using best available (${chosen.id}).`,
    );
  }

  const rthSa = sinkRthSa(chosen, spec.cooling);
  const worstMarginC = roundSig(worstMargin(chosenNodes!, spec), 4);
  notes.push(
    `Heatsink ${chosen.id}: RthSA = ${rthSa} °C/W (${spec.cooling}` +
      (spec.cooling === "forced-air" && chosen.rthSaCPerWForced === undefined
        ? ", natural rating used — no forced rating"
        : "") +
      `), sink temp ${roundSig(spec.ambientC + pDevW * rthSa, 4)} °C, ` +
      `$${chosen.priceUsd}.`,
  );
  if (worstMarginC >= 0 && worstMarginC < SELECTION_MARGIN_C) {
    notes.push(
      `Worst Tj margin ${roundSig(worstMarginC, 3)} °C is below the ` +
        `${SELECTION_MARGIN_C} °C design margin.`,
    );
  }

  return {
    ambientC: spec.ambientC,
    cooling: spec.cooling,
    heatsink: chosen,
    nodes: chosenNodes!,
    worstMarginC,
    ok: worstMarginC >= 0,
    notes,
  };
}

/**
 * Electro-thermal fixed point: losses depend on Tj (Rds(on) tempco), Tj
 * depends on losses. Re-evaluate losses at the solved worst-node Tj until
 * |ΔTj| < 1 °C, capped at 10 re-evaluations.
 */
export function iterateThermal(
  spec: DesignSpec,
  evalLossesAtTj: (tjC: number) => LossBreakdown,
  heatsinks?: Heatsink[],
): { losses: LossBreakdown; thermal: ThermalReport } {
  const limitC = spec.maxJunctionC ?? DEFAULT_TJ_MAX_C;
  let tjGuessC = Math.min(spec.ambientC + 30, limitC);
  let losses = evalLossesAtTj(tjGuessC);
  let thermal = solveThermal(losses, spec, heatsinks);

  for (let i = 0; i < 10; i++) {
    const tjSolvedC =
      thermal.nodes.length > 0
        ? Math.max(...thermal.nodes.map((n) => n.tjC))
        : spec.ambientC;
    if (Math.abs(tjSolvedC - tjGuessC) < 1) break;
    tjGuessC = tjSolvedC;
    losses = evalLossesAtTj(tjGuessC);
    thermal = solveThermal(losses, spec, heatsinks);
  }
  return { losses, thermal };
}
