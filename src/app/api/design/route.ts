/**
 * POST /api/design — {spec: DesignSpec} -> DesignResult
 *
 * The flagship endpoint: full optimizer run (topology scoring, device × fsw
 * sweep, losses, magnetics, thermal iteration, schematic, BOM, compliance,
 * firmware). Heavy → 60 s budget + shared LRU on the serialized spec.
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
    return jsonResponse(cachedDesign(v.spec));
  } catch (err) {
    return engineError(err);
  }
}
