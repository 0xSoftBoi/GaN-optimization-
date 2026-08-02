/**
 * /economics preset converters — three example specs a trader/professional
 * can price out without touching the engineering form, plus the sessionStorage
 * hand-off (same contract the landing page and /design use, so a design run
 * elsewhere on the site can be priced here without re-entering it).
 *
 * Pure data + parsing (no React/DOM) so it unit-tests under node.
 */

import type { DesignSpec } from "@/lib/types";
import {
  DEFAULT_SPEC as WORKBENCH_DEFAULT_SPEC,
  STORAGE_KEY,
  decodeRequest,
} from "@/components/workbench/examples";

/** Re-exported so callers don't need to know it lives in the workbench module. */
export { STORAGE_KEY };

export interface EconomicsPreset {
  id: string;
  label: string;
  /** One line of context — who runs this converter and where. */
  blurb: string;
  spec: DesignSpec;
}

export const PRESETS: EconomicsPreset[] = [
  {
    id: "dab-5kw",
    label: "5 kW bidirectional 800 V → 48 V",
    blurb: "Datacenter DC bus tap — bidirectional isolated DAB",
    spec: WORKBENCH_DEFAULT_SPEC,
  },
  {
    id: "pfc-3kw",
    label: "3 kW totem-pole PFC, 230 Vac",
    blurb: "Grid-tied AC front end feeding a 400 V bus",
    spec: {
      name: "3 kW totem-pole PFC, 230 Vac",
      conversion: "ac-dc",
      vinMinV: 276,
      vinNomV: 325,
      vinMaxV: 358,
      voutV: 400,
      poutW: 3000,
      bidirectional: false,
      isolated: false,
      ambientC: 40,
      cooling: "forced-air",
      gridVacRms: 230,
    },
  },
  {
    id: "buck-600w",
    label: "600 W 48 V → 12 V sync buck",
    blurb: "Point-of-load / IBC step-down, natural convection",
    spec: {
      name: "600 W 48 V → 12 V sync buck",
      conversion: "dc-dc",
      vinMinV: 40,
      vinNomV: 48,
      vinMaxV: 56,
      voutV: 12,
      poutW: 600,
      bidirectional: false,
      isolated: false,
      ambientC: 35,
      cooling: "natural",
      rippleVoutPct: 1,
    },
  },
];

export const DEFAULT_PRESET_ID = PRESETS[0].id;

export function presetById(id: string): EconomicsPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/**
 * A spec pulled from sessionStorage — a design run on the landing page,
 * /design, or /optimize — labeled distinctly from the fixed presets. Only
 * the `{spec}` shape is usable directly; a `{prompt}` hand-off needs
 * /api/copilot to resolve first (the caller's job, see the page component).
 */
export function specFromSession(): DesignSpec | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  const req = decodeRequest(raw);
  return req?.spec ?? null;
}

export function promptFromSession(): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  const req = decodeRequest(raw);
  return req?.prompt ?? null;
}
