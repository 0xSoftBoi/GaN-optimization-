/**
 * Topology catalog + spec-driven scoring.
 *
 * TOPOLOGIES carries honest, datasheet-grade metadata for every TopologyId in
 * the frozen contract. scoreTopologies() applies hard disqualifiers first
 * (isolation, bidirectionality, power window, conversion type, impossible
 * conversion direction) and then scores survivors 0-100 on power fit, voltage
 * ratio fit, soft-switching value at high power, and part-count economy at
 * low power.
 */

import type { DesignSpec, TopologyId, TopologyInfo, TopologyScore } from "@/lib/types";
import { clamp, roundSig } from "@/lib/util";

export const TOPOLOGIES: TopologyInfo[] = [
  {
    id: "buck",
    name: "Buck (async, diode freewheel)",
    isolated: false,
    bidirectional: false,
    softSwitching: "none",
    minPowerW: 0.5,
    maxPowerW: 300,
    switchCount: 1,
    magnetics: ["output-inductor"],
    description:
      "Single-switch step-down with a freewheel diode. Cheapest possible stage; the diode drop caps efficiency, so it only makes sense at low output current.",
  },
  {
    id: "sync-buck",
    name: "Synchronous buck",
    isolated: false,
    bidirectional: true,
    softSwitching: "partial",
    minPowerW: 1,
    maxPowerW: 4000,
    switchCount: 2,
    magnetics: ["output-inductor"],
    description:
      "Half-bridge step-down with a synchronous rectifier. Workhorse non-isolated converter; SR commutates on the body diode so its transitions are near-lossless, and it is inherently bidirectional (boost in reverse).",
  },
  {
    id: "interleaved-sync-buck",
    name: "2-phase interleaved synchronous buck",
    isolated: false,
    bidirectional: true,
    softSwitching: "partial",
    minPowerW: 300,
    maxPowerW: 15000,
    switchCount: 4,
    magnetics: ["output-inductor"],
    description:
      "Two sync-buck phases 180 deg apart. Halves per-phase current, cancels output ripple, spreads heat; standard for 48 V bus converters above a few hundred watts.",
  },
  {
    id: "boost",
    name: "Synchronous boost",
    isolated: false,
    bidirectional: false,
    softSwitching: "none",
    minPowerW: 5,
    maxPowerW: 8000,
    switchCount: 2,
    magnetics: ["output-inductor"],
    description:
      "Step-up with synchronous high-side rectifier. Hard-switched CCM; simple and dense, but carries a right-half-plane zero that limits control bandwidth.",
  },
  {
    id: "llc-half-bridge",
    name: "LLC resonant half-bridge",
    isolated: true,
    bidirectional: false,
    softSwitching: "full",
    minPowerW: 30,
    maxPowerW: 1500,
    switchCount: 4,
    magnetics: ["transformer", "resonant-inductor"],
    description:
      "Series-resonant LLC run at resonance: ZVS on the primary half-bridge, near-ZCS synchronous rectifiers. Excellent efficiency at a fixed conversion ratio; dislikes wide input range.",
  },
  {
    id: "llc-full-bridge",
    name: "LLC resonant full-bridge",
    isolated: true,
    bidirectional: false,
    softSwitching: "full",
    minPowerW: 300,
    maxPowerW: 12000,
    switchCount: 8,
    magnetics: ["transformer", "resonant-inductor"],
    description:
      "Full-bridge LLC for kW-class isolated stages: twice the tank drive of the half-bridge for the same device current, full ZVS. The go-to for high-efficiency server / EV charger DC-DC.",
  },
  {
    id: "psfb",
    name: "Phase-shifted full bridge",
    isolated: true,
    bidirectional: false,
    softSwitching: "partial",
    minPowerW: 500,
    maxPowerW: 30000,
    switchCount: 6,
    magnetics: ["transformer", "output-inductor", "resonant-inductor"],
    description:
      "Full bridge with phase-shift PWM and a buck-type output filter. ZVS on one leg from filter energy; the other leg relies on leakage energy and drops out of ZVS at light load. Proven at high power, easy wide-range regulation.",
  },
  {
    id: "dab",
    name: "Dual active bridge",
    isolated: true,
    bidirectional: true,
    softSwitching: "full",
    minPowerW: 200,
    maxPowerW: 50000,
    switchCount: 8,
    magnetics: ["transformer", "resonant-inductor"],
    description:
      "Two full bridges around a transformer plus series inductor; power flows with phase shift and reverses seamlessly. ZVS on both bridges near matched voltage. The default for bidirectional isolated conversion (ESS, V2G).",
  },
  {
    id: "totem-pole-pfc",
    name: "Totem-pole bridgeless PFC",
    isolated: false,
    bidirectional: true,
    softSwitching: "none",
    minPowerW: 300,
    maxPowerW: 11000,
    switchCount: 4,
    magnetics: ["pfc-inductor"],
    description:
      "Bridgeless AC-DC front end: a fast GaN leg hard-switched at fsw and a slow leg commutating at line frequency. Eliminates two diode drops of a classic PFC; GaN's zero Qrr makes CCM practical. Runs inverter-mode for V2G.",
  },
  {
    id: "flyback",
    name: "Flyback",
    isolated: true,
    bidirectional: false,
    softSwitching: "none",
    minPowerW: 0.5,
    maxPowerW: 150,
    switchCount: 2,
    magnetics: ["coupled-inductor"],
    description:
      "Single-switch isolated converter storing energy in a coupled inductor. Lowest part count for isolated low power (adapters, aux/bias supplies); leakage spike and hard switching cap it near 150 W.",
  },
  {
    id: "forward-active-clamp",
    name: "Active-clamp forward",
    isolated: true,
    bidirectional: false,
    softSwitching: "partial",
    minPowerW: 20,
    maxPowerW: 600,
    switchCount: 4,
    magnetics: ["transformer", "output-inductor"],
    description:
      "Forward converter with an active reset clamp: recycles magnetizing energy, gives ZVS on the main switch, allows duty beyond 0.5. Good isolated mid-power with a proper buck output filter (low output ripple).",
  },
];

const BUCK_FAMILY: TopologyId[] = ["buck", "sync-buck", "interleaved-sync-buck"];

function isBuckFamily(id: TopologyId): boolean {
  return BUCK_FAMILY.includes(id);
}

/** ln-domain position of p inside [lo, hi]: 0 at lo, 1 at hi. */
function logPosition(p: number, lo: number, hi: number): number {
  return Math.log(p / lo) / Math.log(hi / lo);
}

function scoreOne(t: TopologyInfo, spec: DesignSpec): TopologyScore {
  const rationale: string[] = [];
  const p = spec.poutW;

  // ---- hard disqualifiers -------------------------------------------------
  if (spec.conversion === "ac-dc" && t.id !== "totem-pole-pfc") {
    return {
      topology: t,
      score: 0,
      rationale: [
        `${t.name} is a DC-DC stage — an AC-DC spec needs a PFC front end (totem-pole) first.`,
      ],
      disqualified: "conversion-type: not an AC-DC/PFC topology",
    };
  }
  if (spec.conversion === "dc-dc" && t.id === "totem-pole-pfc") {
    return {
      topology: t,
      score: 0,
      rationale: ["Totem-pole PFC is a grid front end; it has no role in a DC-DC spec."],
      disqualified: "conversion-type: PFC stage on a DC-DC spec",
    };
  }
  if (spec.isolated !== t.isolated) {
    return {
      topology: t,
      score: 0,
      rationale: [
        spec.isolated
          ? `${t.name} has no galvanic barrier — the spec requires isolation.`
          : `${t.name} carries a transformer the spec doesn't need; the isolation barrier costs efficiency, size and money for nothing.`,
      ],
      disqualified: spec.isolated ? "isolation: topology is non-isolated" : "isolation: topology is isolated, spec is not",
    };
  }
  if (spec.bidirectional && !t.bidirectional) {
    return {
      topology: t,
      score: 0,
      rationale: [
        `${t.name} rectifies in one direction only (output diode/SR orientation); it cannot source power back into the input.`,
      ],
      disqualified: "bidirectional: topology is unidirectional",
    };
  }
  if (p < t.minPowerW || p > t.maxPowerW) {
    return {
      topology: t,
      score: 0,
      rationale: [
        `${roundSig(p)} W sits outside the practical ${t.name} window of ${t.minPowerW}-${t.maxPowerW} W.`,
      ],
      disqualified: `power-window: ${roundSig(p)} W outside ${t.minPowerW}-${t.maxPowerW} W`,
    };
  }
  // Impossible conversion direction (non-isolated only; isolated fixes it with turns).
  if (isBuckFamily(t.id) && spec.voutV >= spec.vinMinV) {
    return {
      topology: t,
      score: 0,
      rationale: [
        `A buck cannot regulate ${spec.voutV} V out from a ${spec.vinMinV} V input minimum — duty would exceed 1 at line low.`,
      ],
      disqualified: "voltage-ratio: buck needs vin(min) > vout",
    };
  }
  if (t.id === "boost" && spec.voutV <= spec.vinMaxV) {
    return {
      topology: t,
      score: 0,
      rationale: [
        `A boost only steps up: ${spec.voutV} V out is not above the ${spec.vinMaxV} V input maximum.`,
      ],
      disqualified: "voltage-ratio: boost needs vout > vin(max)",
    };
  }

  // ---- scoring ------------------------------------------------------------
  // Power fit: 0-35. Best in the middle (log) of the practical window.
  const x = logPosition(p, t.minPowerW, t.maxPowerW);
  const centered = 1 - 2 * Math.abs(x - 0.5);
  const powerPts = 35 * (0.35 + 0.65 * clamp(centered, 0, 1));
  if (centered > 0.6) {
    rationale.push(
      `${roundSig(p / 1000, 2)} kW lands square in the ${t.name} sweet spot (${t.minPowerW}-${t.maxPowerW} W).`,
    );
  } else {
    rationale.push(
      `${roundSig(p)} W is workable but near the edge of the ${t.name} window (${t.minPowerW}-${t.maxPowerW} W).`,
    );
  }

  // Voltage ratio fit: 0-30.
  const vinRange = spec.vinMaxV / spec.vinMinV;
  let ratioFit = 0.9;
  if (isBuckFamily(t.id)) {
    const d = spec.voutV / spec.vinNomV;
    ratioFit =
      d >= 0.12 && d <= 0.85
        ? 1
        : clamp(1 - 3 * (d < 0.12 ? 0.12 - d : d - 0.85), 0.1, 1);
    rationale.push(
      d >= 0.12 && d <= 0.85
        ? `Duty of ~${roundSig(d, 2)} at nominal is comfortable — good ripple and transient headroom.`
        : `Duty of ~${roundSig(d, 2)} is extreme; expect pulse-width and ripple penalties.`,
    );
  } else if (t.id === "boost") {
    const r = spec.voutV / spec.vinNomV;
    ratioFit = r >= 1.25 && r <= 4 ? 1 : clamp(1 - 0.4 * (r < 1.25 ? 1.25 - r : r - 4), 0.15, 1);
    rationale.push(
      r <= 4
        ? `A ${roundSig(r, 2)}x step-up is well within a single boost stage.`
        : `A ${roundSig(r, 2)}x step-up pushes a single boost hard — duty and RHP zero both suffer.`,
    );
  } else if (t.id === "llc-half-bridge" || t.id === "llc-full-bridge") {
    // LLC lives at resonance; every % of input range drags it off the resonant
    // ratio and costs circulating current.
    ratioFit = clamp(1 - 1.2 * (vinRange - 1), 0.2, 1);
    rationale.push(
      vinRange < 1.15
        ? `Narrow ${roundSig(vinRange, 2)}:1 input range lets the LLC sit at resonance where it is essentially lossless in switching.`
        : `${roundSig(vinRange, 2)}:1 input range forces the LLC away from resonance — circulating current and gain-curve headaches.`,
    );
  } else if (t.id === "dab") {
    ratioFit = clamp(1 - 0.8 * (vinRange - 1), 0.3, 1);
    const n = spec.vinNomV / spec.voutV;
    rationale.push(
      `Turns ratio ~${roundSig(n, 3)}:1 matches the bridges, so the DAB runs near unity effective ratio where ZVS range is widest.`,
    );
  } else if (t.id === "totem-pole-pfc") {
    const vac = spec.gridVacRms ?? 230;
    const boostRatio = spec.voutV / (Math.SQRT2 * vac);
    ratioFit =
      boostRatio >= 1.05 && boostRatio <= 1.6
        ? 1
        : clamp(1 - (boostRatio < 1.05 ? (1.05 - boostRatio) * 4 : (boostRatio - 1.6) * 1.5), 0.1, 1);
    rationale.push(
      boostRatio >= 1.05
        ? `${spec.voutV} V bus clears the ${roundSig(Math.SQRT2 * vac)} V line peak with sensible boost margin.`
        : `${spec.voutV} V bus does not clear the ${roundSig(Math.SQRT2 * vac)} V line peak — PFC cannot regulate through the crest.`,
    );
  } else {
    // psfb / flyback / forward-active-clamp: turns ratio absorbs the ratio,
    // wide input range only squeezes duty range.
    ratioFit = 0.95 * clamp(1 - 0.4 * (vinRange - 1), 0.4, 1);
    rationale.push(
      `Transformer turns ratio absorbs the ${roundSig(spec.vinNomV)} V -> ${roundSig(spec.voutV)} V ratio; input range ${roundSig(vinRange, 2)}:1 maps to a manageable duty span.`,
    );
  }
  const ratioPts = 30 * ratioFit;

  // Soft-switching value grows with power: 0-20.
  const softFactor = t.softSwitching === "full" ? 1 : t.softSwitching === "partial" ? 0.55 : 0;
  const wHigh = clamp(Math.log(p / 300) / Math.log(10), 0, 1); // 0 below 300 W, 1 above 3 kW
  const softPts = 20 * softFactor * wHigh;
  if (softPts > 10) {
    rationale.push(
      t.softSwitching === "full"
        ? `Full soft switching pays off handsomely at this power — switching loss would otherwise dominate the thermal budget.`
        : `Partial ZVS takes a useful bite out of switching loss at this power level.`,
    );
  } else if (wHigh > 0.5 && softFactor === 0) {
    rationale.push(`Hard switching at this power puts real stress on the thermal design.`);
  }

  // Part-count economy matters at low power: 0-15.
  const wLow = 1 - wHigh;
  const eco = clamp((12 - t.switchCount) / 11, 0, 1);
  const ecoPts = 15 * eco * wLow;
  if (ecoPts > 8) {
    rationale.push(
      `${t.switchCount} switch${t.switchCount > 1 ? "es" : ""} keeps drive, control and BOM cost minimal — exactly what this power level wants.`,
    );
  }

  const score = Math.round(clamp(powerPts + ratioPts + softPts + ecoPts, 1, 100));
  return { topology: t, score, rationale };
}

/**
 * Score every topology against a spec. Sorted best-first; disqualified entries
 * (score 0, `disqualified` set) sort last.
 */
export function scoreTopologies(spec: DesignSpec): TopologyScore[] {
  return TOPOLOGIES.map((t) => scoreOne(t, spec)).sort(
    (a, b) => b.score - a.score || a.topology.id.localeCompare(b.topology.id),
  );
}

export function getTopology(id: TopologyId): TopologyInfo {
  const t = TOPOLOGIES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown topology: ${id}`);
  return t;
}
