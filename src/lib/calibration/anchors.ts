/**
 * VoltForge calibration anchor fixtures (TECHPLAN §U44).
 *
 * Each anchor represents a published, measured reference design from a vendor
 * (TI, Infineon, Navitas, etc.). We reproduce each via designConverter() and
 * verify efficiency within ±0.5 % of the published value.
 *
 * Anchors establish physics credibility: no public accuracy claims until all
 * anchor cases pass. See PHYSICS.md §A for sourced specifications and measured
 * efficiency numbers.
 *
 * IMPORTANT: These are not design targets — they are reverse-engineered specs
 * from published designs. The published efficiency is ground truth; our model
 * must reproduce it, not predict it independently.
 */

import type { DesignSpec } from "@/lib/types";

/**
 * One calibration anchor: published design + measured efficiency.
 * The spec is reverse-engineered from the vendor's schematic/datasheet;
 * efficiency is the measured or simulated value from the reference design.
 */
export interface CalibrationAnchor {
  readonly id: string; // e.g. "ti-pmp23126"
  readonly name: string; // human-readable design name
  readonly source: string; // vendor + part number, e.g. "TI PMP23126"
  readonly refUrl?: string; // link to published design (app note, datasheet)
  readonly spec: DesignSpec; // reverse-engineered spec
  readonly publishedEfficiencyPct: number; // measured or simulated value from vendor
  readonly nominalLoadPct: number; // at what load the published efficiency is stated (e.g. 100)
  readonly notes: string; // any caveats or modeling notes
}

// ---------------------------------------------------------------------------
// Anchor A1: TI PMP23126 (3 kW OBC, ±400 V isolated bidirectional DAB)
// ---------------------------------------------------------------------------
// Reference: https://www.ti.com/lit/pdf/slup342
// A 3 kW bidirectional on-board charger: 400 V battery ↔ 12 V load, DAB topology.
// Typical efficiency at 100% load: ~96.5% (measured in TI app note).
export const A1_TI_PMP23126: CalibrationAnchor = {
  id: "a1-ti-pmp23126",
  name: "TI PMP23126 3 kW OBC",
  source: "TI PMP23126",
  refUrl: "https://www.ti.com/lit/pdf/slup342",
  spec: {
    name: "TI PMP23126 reverse-engineered",
    conversion: "dc-dc",
    vinMinV: 360,
    vinNomV: 400,
    vinMaxV: 440,
    voutV: 12,
    poutW: 3000,
    bidirectional: true,
    isolated: true,
    ambientC: 50, // thermal test chamber
    cooling: "forced-air",
    rippleVoutPct: 1,
  },
  publishedEfficiencyPct: 96.5, // @ 100% load, forward direction
  nominalLoadPct: 100,
  notes: "OBC bidirectional DAB; TI app note reports forward-path 96.5 %; model must reproduce ±0.5 %.",
};

// ---------------------------------------------------------------------------
// Future anchors (stub entries for calibration harness structure)
// ---------------------------------------------------------------------------

// A2: Infineon 3 kW class (e.g., AURIX-based CoolSET PFC + LLC)
// A3: Navitas Ruby-class design (GaN-native chipset, ~5 kW, high efficiency)
// Add as known/measured reference designs become available.

export const ALL_ANCHORS: CalibrationAnchor[] = [
  A1_TI_PMP23126,
  // A2_INFINEON_3KW,
  // A3_NAVITAS_RUBY,
];
