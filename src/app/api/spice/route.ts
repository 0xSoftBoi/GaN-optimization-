/**
 * POST /api/spice — {spec: DesignSpec} -> text/plain SPICE netlist (.cir)
 *
 * Full design run (shared LRU) → the schematic module's SPICE netlist,
 * returned as plain text so it can be piped straight into ngspice/LTspice.
 */

import { cachedDesign } from "@/app/api/_lib/cache";
import { engineError, jsonError, readJsonBody } from "@/app/api/_lib/http";
import { specFromBody } from "@/app/api/_lib/validate";

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;

  const v = specFromBody(parsed.body);
  if (!v.ok) return jsonError(400, "Invalid design spec", v.errors);

  try {
    const r = cachedDesign(v.spec);
    return new Response(r.schematic.spiceNetlist, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="voltforge-${r.topology.id}.cir"`,
      },
    });
  } catch (err) {
    return engineError(err);
  }
}
