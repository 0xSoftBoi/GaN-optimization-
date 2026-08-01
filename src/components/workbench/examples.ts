/**
 * Landing ⇄ workbench contract: example prompts, the fallback spec, the
 * sessionStorage hand-off format, and the staged-progress copy.
 *
 * Pure data + parsing (no React/DOM) so it unit-tests under node.
 */

import type { DesignSpec } from "@/lib/types";

/** sessionStorage key the landing page writes and /design reads. */
export const STORAGE_KEY = "voltforge.request.v1";

/** Exactly one of `prompt` (→ /api/copilot) or `spec` (→ /api/design). */
export interface WorkbenchRequest {
  prompt?: string;
  spec?: DesignSpec;
}

export interface ExamplePrompt {
  label: string;
  prompt: string;
}

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    label: "5 kW bidirectional 800 V → 48 V",
    prompt:
      "5kW bidirectional isolated DC-DC from 800V bus to 48V, forced air, 40C ambient",
  },
  {
    label: "600 W 48 V → 12 V sync buck",
    prompt: "600W 48V to 12V synchronous buck, natural convection, 1% ripple",
  },
  {
    label: "3 kW totem-pole PFC, 230 Vac",
    prompt: "3kW totem-pole PFC from 230Vac grid, 400V bus, forced air cooling",
  },
];

/**
 * Fallback spec when /design is opened cold: the flagship 5 kW bidirectional
 * 800 V → 48 V isolated brick (DAB territory).
 */
export const DEFAULT_SPEC: DesignSpec = {
  name: "5 kW bidirectional 800 V → 48 V",
  conversion: "dc-dc",
  vinMinV: 680,
  vinNomV: 800,
  vinMaxV: 900,
  voutV: 48,
  poutW: 5000,
  bidirectional: true,
  isolated: true,
  ambientC: 40,
  cooling: "forced-air",
};

/** Staged progress copy shown while the engine runs. */
export const PIPELINE_STAGES: string[] = [
  "Parsing specification",
  "Scoring topologies",
  "Sweeping devices × fsw",
  "Designing magnetics",
  "Iterating thermal",
  "Schematic + BOM",
  "Compliance + firmware",
];

export function encodeRequest(r: WorkbenchRequest): string {
  return JSON.stringify(r);
}

/**
 * Parse a raw sessionStorage value back into a WorkbenchRequest. Returns
 * null on anything malformed — the caller falls back to DEFAULT_SPEC.
 */
export function decodeRequest(raw: string | null | undefined): WorkbenchRequest | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.prompt === "string" && o.prompt.trim().length > 0) {
    return { prompt: o.prompt };
  }
  if (typeof o.spec === "object" && o.spec !== null && !Array.isArray(o.spec)) {
    const s = o.spec as Record<string, unknown>;
    // Light shape check only — the API re-validates authoritatively.
    if (
      typeof s.voutV === "number" &&
      typeof s.poutW === "number" &&
      typeof s.vinNomV === "number"
    ) {
      return { spec: o.spec as DesignSpec };
    }
  }
  return null;
}
