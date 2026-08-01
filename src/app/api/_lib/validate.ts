/**
 * VoltForge API — DesignSpec input validation.
 *
 * Accepts untrusted JSON, returns either a fully-typed DesignSpec rebuilt
 * field-by-field (deterministic key order → stable LRU cache keys, unknown
 * keys dropped) or a list of human-readable errors for a 400 response.
 */

import type { Cooling, DesignSpec } from "@/lib/types";

const CONVERSIONS = ["dc-dc", "ac-dc"] as const;
const COOLINGS: readonly Cooling[] = ["natural", "forced-air", "liquid", "cold-plate"];

export type SpecValidation =
  | { ok: true; spec: DesignSpec }
  | { ok: false; errors: string[] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function num(
  o: Record<string, unknown>,
  key: string,
  errors: string[],
  opts: { required?: boolean; min?: number; max?: number; minExclusive?: boolean } = {},
): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (opts.required) errors.push(`${key} is required`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push(`${key} must be a finite number`);
    return undefined;
  }
  if (opts.min !== undefined && (opts.minExclusive ? v <= opts.min : v < opts.min)) {
    errors.push(`${key} must be ${opts.minExclusive ? ">" : ">="} ${opts.min}`);
    return undefined;
  }
  if (opts.max !== undefined && v > opts.max) {
    errors.push(`${key} must be <= ${opts.max}`);
    return undefined;
  }
  return v;
}

function bool(o: Record<string, unknown>, key: string, errors: string[]): boolean | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    errors.push(`${key} is required (boolean)`);
    return undefined;
  }
  if (typeof v !== "boolean") {
    errors.push(`${key} must be a boolean`);
    return undefined;
  }
  return v;
}

function str(o: Record<string, unknown>, key: string, errors: string[]): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    errors.push(`${key} must be a string`);
    return undefined;
  }
  return v;
}

/** Validate an untrusted value as a DesignSpec. */
export function validateDesignSpec(input: unknown): SpecValidation {
  if (!isRecord(input)) return { ok: false, errors: ["spec must be a JSON object"] };
  const errors: string[] = [];

  const conversion = input.conversion;
  if (conversion !== "dc-dc" && conversion !== "ac-dc") {
    errors.push(`conversion must be one of: ${CONVERSIONS.join(", ")}`);
  }

  const vinMinV = num(input, "vinMinV", errors, { required: true, min: 0, minExclusive: true });
  const vinNomV = num(input, "vinNomV", errors, { required: true, min: 0, minExclusive: true });
  const vinMaxV = num(input, "vinMaxV", errors, { required: true, min: 0, minExclusive: true });
  const voutV = num(input, "voutV", errors, { required: true, min: 0, minExclusive: true });
  // 20 MW ceiling keeps absurd inputs (1e300 W) out of the sweep loops.
  const poutW = num(input, "poutW", errors, { required: true, min: 0, minExclusive: true, max: 20e6 });
  const ambientC = num(input, "ambientC", errors, { required: true, min: -55, max: 150 });

  if (vinMinV !== undefined && vinNomV !== undefined && vinMinV > vinNomV) {
    errors.push("vinMinV must be <= vinNomV");
  }
  if (vinNomV !== undefined && vinMaxV !== undefined && vinNomV > vinMaxV) {
    errors.push("vinNomV must be <= vinMaxV");
  }

  const bidirectional = bool(input, "bidirectional", errors);
  const isolated = bool(input, "isolated", errors);

  const cooling = input.cooling;
  if (typeof cooling !== "string" || !COOLINGS.includes(cooling as Cooling)) {
    errors.push(`cooling must be one of: ${COOLINGS.join(", ")}`);
  }

  // Optional fields.
  const name = str(input, "name", errors);
  const notes = str(input, "notes", errors);
  const fswHz = num(input, "fswHz", errors, { min: 1e3, max: 10e6 });
  const maxJunctionC = num(input, "maxJunctionC", errors, { min: 60, max: 200 });
  const rippleVoutPct = num(input, "rippleVoutPct", errors, { min: 0, minExclusive: true, max: 50 });
  const targetEfficiencyPct = num(input, "targetEfficiencyPct", errors, {
    min: 0,
    minExclusive: true,
    max: 99.9,
  });
  const costCeilingUsd = num(input, "costCeilingUsd", errors, { min: 0, minExclusive: true });
  const heightLimitMm = num(input, "heightLimitMm", errors, { min: 0, minExclusive: true });
  const gridVacRms = num(input, "gridVacRms", errors, { min: 0, minExclusive: true, max: 1000 });

  if (errors.length) return { ok: false, errors };

  // Rebuild with a fixed key order; omit absent optionals entirely.
  const spec: DesignSpec = {
    ...(name !== undefined ? { name } : {}),
    conversion: conversion as DesignSpec["conversion"],
    vinMinV: vinMinV as number,
    vinNomV: vinNomV as number,
    vinMaxV: vinMaxV as number,
    voutV: voutV as number,
    poutW: poutW as number,
    bidirectional: bidirectional as boolean,
    isolated: isolated as boolean,
    ...(fswHz !== undefined ? { fswHz } : {}),
    ambientC: ambientC as number,
    ...(maxJunctionC !== undefined ? { maxJunctionC } : {}),
    cooling: cooling as Cooling,
    ...(rippleVoutPct !== undefined ? { rippleVoutPct } : {}),
    ...(targetEfficiencyPct !== undefined ? { targetEfficiencyPct } : {}),
    ...(costCeilingUsd !== undefined ? { costCeilingUsd } : {}),
    ...(heightLimitMm !== undefined ? { heightLimitMm } : {}),
    ...(gridVacRms !== undefined ? { gridVacRms } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
  return { ok: true, spec };
}

/**
 * Pull `{spec}` out of a parsed request body and validate it.
 * Shared by /api/design, /api/optimize, /api/firmware, /api/spice.
 */
export function specFromBody(body: unknown): SpecValidation {
  if (!isRecord(body)) return { ok: false, errors: ["body must be a JSON object: {spec: DesignSpec}"] };
  if (!("spec" in body)) return { ok: false, errors: ["body.spec is required"] };
  return validateDesignSpec(body.spec);
}
