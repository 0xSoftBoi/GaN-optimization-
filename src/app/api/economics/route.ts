/**
 * POST /api/economics — {spec: DesignSpec, assumptions?: Partial<EconomicsAssumptions>}
 * -> {design summary, resolved assumptions, economics}
 *
 * Runs the full optimizer (via the shared design LRU, so a UI that already
 * fetched /api/design pays nothing extra), then prices the winning design
 * against user-adjustable commercial assumptions. Any assumptions omitted
 * from the request fall back to `defaultAssumptions(spec)` — the response
 * echoes the fully-resolved set so the UI can display every editable input.
 */

import { cachedDesign } from "@/app/api/_lib/cache";
import { engineError, jsonError, jsonResponse, readJsonBody } from "@/app/api/_lib/http";
import { specFromBody } from "@/app/api/_lib/validate";
import {
  defaultAssumptions,
  energyEconomics,
  type EconomicsAssumptions,
  type LoadProfilePoint,
} from "@/lib/economics";

export const maxDuration = 60;

type AssumptionsValidation =
  | { ok: true; assumptions: EconomicsAssumptions }
  | { ok: false; errors: string[] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function overrideNum(
  o: Record<string, unknown>,
  key: keyof EconomicsAssumptions & string,
  errors: string[],
  check: (v: number) => string | null,
): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push(`assumptions.${key} must be a finite number`);
    return undefined;
  }
  const bad = check(v);
  if (bad) {
    errors.push(`assumptions.${key} ${bad}`);
    return undefined;
  }
  return v;
}

function overrideProfile(o: Record<string, unknown>, errors: string[]): LoadProfilePoint[] | undefined {
  const v = o.loadProfile;
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length === 0) {
    errors.push("assumptions.loadProfile must be a non-empty array of {loadPct, weight}");
    return undefined;
  }
  const out: LoadProfilePoint[] = [];
  let weightSum = 0;
  for (const [i, p] of v.entries()) {
    if (!isRecord(p)) {
      errors.push(`assumptions.loadProfile[${i}] must be an object {loadPct, weight}`);
      return undefined;
    }
    const { loadPct, weight } = p;
    if (typeof loadPct !== "number" || !Number.isFinite(loadPct) || loadPct < 0 || loadPct > 100) {
      errors.push(`assumptions.loadProfile[${i}].loadPct must be a number in [0, 100]`);
      return undefined;
    }
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      errors.push(`assumptions.loadProfile[${i}].weight must be a number >= 0`);
      return undefined;
    }
    weightSum += weight;
    out.push({ loadPct, weight });
  }
  if (weightSum <= 0) {
    errors.push("assumptions.loadProfile weights must sum to > 0");
    return undefined;
  }
  return out;
}

/** Merge a partial, untrusted assumptions object over the spec's defaults. */
function assumptionsFromBody(body: unknown, defaults: EconomicsAssumptions): AssumptionsValidation {
  if (!isRecord(body)) return { ok: true, assumptions: defaults }; // body already validated as record upstream
  const raw = body.assumptions;
  if (raw === undefined || raw === null) return { ok: true, assumptions: defaults };
  if (!isRecord(raw)) return { ok: false, errors: ["assumptions must be a JSON object"] };

  const errors: string[] = [];
  const pricePerMwhUsd = overrideNum(raw, "pricePerMwhUsd", errors, (v) =>
    v < 0 ? "must be >= 0" : null,
  );
  const hoursPerYear = overrideNum(raw, "hoursPerYear", errors, (v) =>
    v <= 0 || v > 8784 ? "must be in (0, 8784]" : null,
  );
  const baselineEfficiencyPct = overrideNum(raw, "baselineEfficiencyPct", errors, (v) =>
    v <= 0 || v > 100 ? "must be in (0, 100]" : null,
  );
  const fleetUnits = overrideNum(raw, "fleetUnits", errors, (v) => (v < 1 ? "must be >= 1" : null));
  const horizonYears = overrideNum(raw, "horizonYears", errors, (v) =>
    v <= 0 || v > 50 ? "must be in (0, 50]" : null,
  );
  const carbonKgPerMwh = overrideNum(raw, "carbonKgPerMwh", errors, (v) =>
    v < 0 ? "must be >= 0" : null,
  );
  const loadProfile = overrideProfile(raw, errors);

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    assumptions: {
      ...defaults,
      ...(pricePerMwhUsd !== undefined ? { pricePerMwhUsd } : {}),
      ...(hoursPerYear !== undefined ? { hoursPerYear } : {}),
      ...(loadProfile !== undefined ? { loadProfile } : {}),
      ...(baselineEfficiencyPct !== undefined ? { baselineEfficiencyPct } : {}),
      ...(fleetUnits !== undefined ? { fleetUnits } : {}),
      ...(horizonYears !== undefined ? { horizonYears } : {}),
      ...(carbonKgPerMwh !== undefined ? { carbonKgPerMwh } : {}),
    },
  };
}

export async function POST(req: Request): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;

  const v = specFromBody(parsed.body);
  if (!v.ok) return jsonError(400, "Invalid design spec", v.errors);

  const a = assumptionsFromBody(parsed.body, defaultAssumptions(v.spec));
  if (!a.ok) return jsonError(400, "Invalid economics assumptions", a.errors);

  try {
    const result = cachedDesign(v.spec);
    const economics = energyEconomics(result, a.assumptions);
    return jsonResponse({
      design: {
        ...(v.spec.name !== undefined ? { name: v.spec.name } : {}),
        topologyId: result.topology.id,
        fswHz: result.fswHz,
        poutW: result.spec.poutW,
        efficiencyPct: result.efficiencyPct,
        bomCostUsd: result.bomCostUsd,
      },
      assumptions: a.assumptions,
      economics,
    });
  } catch (err) {
    return engineError(err);
  }
}
