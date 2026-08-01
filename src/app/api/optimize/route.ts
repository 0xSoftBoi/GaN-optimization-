/**
 * POST /api/optimize — {spec: DesignSpec} ->
 *   {candidates: DesignCandidateSummary[],
 *    bestSummary: {topologyId, efficiencyPct, bomCostUsd, fswHz, deviceId}}
 *
 * The Pareto-explorer endpoint: same engine run as /api/design (shared LRU,
 * so design → optimize on the same spec computes once) but returns only the
 * candidate space and a compact winner summary — no heavy DesignResult.
 */

import { cachedDesign } from "@/app/api/_lib/cache";
import { engineError, jsonError, jsonResponse, readJsonBody } from "@/app/api/_lib/http";
import { specFromBody } from "@/app/api/_lib/validate";

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;

  const v = specFromBody(parsed.body);
  if (!v.ok) return jsonError(400, "Invalid design spec", v.errors);

  try {
    const r = cachedDesign(v.spec);
    // The winning candidate matches the chosen topology + fsw; fall back to
    // the primary switch position's device if the sweep summary lacks it.
    const winner = r.candidates.find(
      (c) => c.topologyId === r.topology.id && c.fswHz === r.fswHz && c.feasible,
    );
    const bestSummary = {
      topologyId: r.topology.id,
      efficiencyPct: r.efficiencyPct,
      bomCostUsd: r.bomCostUsd,
      fswHz: r.fswHz,
      deviceId: winner?.deviceId ?? r.devices[0]?.device.id ?? "",
    };
    return jsonResponse({ candidates: r.candidates, bestSummary });
  } catch (err) {
    return engineError(err);
  }
}
