/**
 * POST /api/export — {spec: DesignSpec, format: "kicad" | "ltspice"}
 *   -> text/plain EDA export of the winning design's schematic.
 *
 * Full design run (shared LRU) → the export module renders either a KiCad 8
 * s-expression schematic (.kicad_sch) or an LTspice netlist (.net).
 */

import { cachedDesign } from "@/app/api/_lib/cache";
import { engineError, jsonError, readJsonBody } from "@/app/api/_lib/http";
import { specFromBody } from "@/app/api/_lib/validate";
import { kicadSchematic, ltspiceNetlist } from "@/lib/export";

export const maxDuration = 60;

const FORMATS = ["kicad", "ltspice"] as const;
type ExportFormat = (typeof FORMATS)[number];

function formatFromBody(body: unknown): ExportFormat | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const f = (body as Record<string, unknown>).format;
  return f === "kicad" || f === "ltspice" ? f : undefined;
}

export async function POST(req: Request): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;

  const format = formatFromBody(parsed.body);
  if (!format) return jsonError(400, `format must be one of: ${FORMATS.join(", ")}`);

  const v = specFromBody(parsed.body);
  if (!v.ok) return jsonError(400, "Invalid design spec", v.errors);

  try {
    const r = cachedDesign(v.spec);
    const title = `${v.spec.name ?? "VoltForge design"} — ${r.topology.name}`;
    const text =
      format === "kicad" ? kicadSchematic(r.schematic, title) : ltspiceNetlist(r.schematic, title);
    const ext = format === "kicad" ? "kicad_sch" : "net";
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="voltforge-${r.topology.id}.${ext}"`,
      },
    });
  } catch (err) {
    return engineError(err);
  }
}
