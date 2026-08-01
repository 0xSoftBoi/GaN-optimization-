"use client";

/**
 * <Term k="zvs">ZVS</Term> — inline glossary term with an accessible tooltip.
 *
 * Renders a dotted-underline span. The one-sentence plain-English definition
 * comes from GLOSSARY and is exposed three ways:
 *   1. native `title` attribute (works everywhere, zero JS),
 *   2. a hover/focus popover (styled, keyboard reachable via tabIndex=0,
 *      dismissable with Escape per WCAG 1.4.13),
 *   3. `aria-describedby` pointing at the popover text for screen readers.
 *
 * No portals, no dependencies — pure span + Tailwind group-hover/focus-within.
 * Keys are typed (GlossaryKey), so a typo fails typecheck instead of shipping
 * an empty tooltip.
 */

import { useId } from "react";

/**
 * Plain-English, one-sentence definitions of the power-electronics and
 * business terms used across VoltForge. Written for a commercial reader
 * first; precise enough that an engineer won't wince.
 */
export const GLOSSARY = {
  // --- switching & semiconductors -----------------------------------------
  zvs: "Zero-voltage switching: the transistor turns on only when the voltage across it is already near zero, all but eliminating switching loss.",
  "rds-on":
    "On-resistance Rds(on): how much a transistor resists current when fully on — lower means less energy wasted as heat.",
  coss: "Output capacitance of a transistor; the energy stored in it is thrown away every switching cycle unless the circuit recycles it (see ZVS).",
  qg: "Gate charge: the charge the driver must pump in to switch the transistor — lower means faster, cleaner, cheaper switching.",
  qrr: "Reverse-recovery charge a silicon diode dumps every time it turns off, wasted as heat; GaN devices have essentially none.",
  fsw: "Switching frequency: how many times per second the transistors switch — higher shrinks the magnetics but increases switching loss.",
  gan: "Gallium nitride: a wide-bandgap semiconductor that switches far faster and cleaner than silicon, enabling smaller, more efficient converters.",
  sic: "Silicon carbide: a wide-bandgap semiconductor that excels at high voltage (650 V and up) and high temperature.",
  fom: "Figure of merit: one number to rank switches — here Rds(on) × Qg, where lower means less conduction and switching loss at once.",
  "dead-time":
    "The brief safety gap when both transistors in a leg are off; too long and current burns extra energy in the body diode.",
  "gate-driver":
    "The small amplifier chip that slams a power transistor's gate on and off fast and cleanly on command.",
  cmti: "Common-mode transient immunity: how fast a voltage jump (in V/ns) a gate driver's isolation barrier can ride out without glitching.",
  tj: "Junction temperature: the temperature of the semiconductor die itself — the number that actually limits power and lifetime.",
  derating:
    "Deliberately running a part below its maximum rating (e.g. at 80% of rated voltage) to buy reliability margin.",
  "thermal-margin":
    "Headroom between the predicted junction temperature and its limit; more margin means cooler parts and longer life.",

  // --- topologies ---------------------------------------------------------
  dab: "Dual active bridge: an isolated converter that moves power in either direction — the workhorse for batteries, EVs and grid interfaces.",
  llc: "A resonant converter topology that switches softly for very high efficiency; ubiquitous in server and consumer power supplies.",
  psfb: "Phase-shifted full bridge: a proven isolated topology for mid-to-high power with soft switching on the primary side.",
  "totem-pole-pfc":
    "A bridgeless AC front end that draws clean, low-distortion current from the grid (power-factor correction) with fewer lossy diodes.",
  ccm: "Continuous conduction mode: the inductor current never falls to zero within a cycle — the standard operating assumption for power stages.",
  isolated:
    "Galvanically isolated: no direct wire between input and output — energy crosses through a transformer, required by safety standards in many uses.",
  bidirectional:
    "Power can flow both ways through the converter — for example charging a battery and later feeding it back to the bus.",

  // --- magnetics & passives -----------------------------------------------
  steinmetz:
    "An empirical curve-fit that predicts magnetic-core loss from switching frequency and flux swing — the standard core-loss model.",
  igse: "Improved generalized Steinmetz equation: extends the core-loss fit to the non-sinusoidal waveforms real converters actually produce.",
  dowell:
    "A classical analysis of how high-frequency current crowds to the surface of transformer windings, multiplying effective copper resistance.",
  magnetics:
    "The inductors and transformers in a converter — usually its largest, hottest and most custom-built components.",
  ripple:
    "The small residual up-and-down wiggle left on a supposedly steady voltage or current.",
  creepage:
    "The shortest path along an insulating surface between two conductors; safety standards dictate minimum distances per working voltage.",
  emi: "Electromagnetic interference: unwanted electrical noise a converter radiates or conducts; regulations set hard limits on it.",

  // --- system & architecture ----------------------------------------------
  ibc: "Intermediate bus converter: the stage that steps a distribution bus (typically 48 V) down to feed the point-of-load regulators.",
  vrm: "Voltage regulator module: the final conversion stage feeding a CPU or GPU at around 1 V and hundreds of amps.",
  "power-density":
    "How much power fits in a given volume (W/L or kW/L) — higher density means smaller, lighter hardware for the same output.",
  "efficiency-curve":
    "Efficiency plotted across the load range; real fleets spend most hours at partial load, which is exactly where designs differ most.",
  spice:
    "The industry-standard circuit-simulation format; an exported netlist lets any engineer verify this design in their own tools.",

  // --- commercial ---------------------------------------------------------
  bom: "Bill of materials: the priced list of every component in the product — BOM cost is the per-unit hardware cost.",
  nre: "Non-recurring engineering: the one-time design and development cost, as opposed to the per-unit cost of building each one.",
  tco: "Total cost of ownership: purchase price plus lifetime electricity, cooling and maintenance — the number efficiency actually moves.",
  payback:
    "How long the energy savings of a more efficient design take to repay its higher upfront cost.",
  pareto:
    "The set of designs where nothing else is better on every metric at once — the true frontier of available trade-offs.",
  fit: "Failures in time: expected failures per billion device-hours — the standard currency of hardware reliability.",
} as const satisfies Record<string, string>;

/** Every valid glossary key (typo-safe at compile time). */
export type GlossaryKey = keyof typeof GLOSSARY;

export interface TermProps {
  /** Glossary key, e.g. "zvs", "rds-on", "tco". */
  k: GlossaryKey;
  /** The visible text, e.g. the abbreviation as used in the sentence. */
  children: React.ReactNode;
  /** Extra classes for the visible (underlined) text span. */
  className?: string;
}

/**
 * Inline term with dotted underline + tooltip. Usage:
 *
 *   <Term k="zvs">ZVS</Term>
 *   <Term k="tco">total cost of ownership</Term>
 */
export function Term({ k, children, className = "" }: TermProps) {
  const tipId = useId();
  const def = GLOSSARY[k];
  return (
    <span className="group relative inline-block">
      <span
        tabIndex={0}
        title={def}
        aria-describedby={tipId}
        onKeyDown={(e) => {
          // WCAG 1.4.13 — tooltip content must be dismissable.
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        className={`cursor-help underline decoration-slate-500 decoration-dotted underline-offset-2 outline-none transition-colors focus-visible:decoration-volt focus-visible:text-volt group-hover:decoration-volt/70 ${className}`}
      >
        {children}
      </span>
      <span
        id={tipId}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-[18rem] -translate-x-1/2 rounded-md border border-ink-600 bg-ink-950 px-2.5 py-1.5 text-left text-xs font-normal normal-case tracking-normal text-slate-300 opacity-0 shadow-lg transition-opacity duration-100 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {def}
      </span>
    </span>
  );
}

export default Term;
