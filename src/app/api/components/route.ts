/**
 * GET /api/components?kind=switch|driver|controller|capacitor|heatsink|core
 *                    &tech=&minVdsV=&maxRdsOnMohm=&q=
 * -> filtered catalog array (JSON)
 *
 * tech / minVdsV / maxRdsOnMohm apply to kind=switch (the only catalog with
 * those axes); q is a case-insensitive free-text match over string fields
 * (part id, manufacturer, package, notes, ...) for every kind.
 */

import { jsonError, jsonResponse } from "@/app/api/_lib/http";
import { CAPACITORS, CONTROLLERS, findSwitches, GATE_DRIVERS, HEATSINKS } from "@/lib/data";
import { CORES } from "@/lib/data/magnetics";
import type { SwitchTech } from "@/lib/types";

const KINDS = ["switch", "driver", "controller", "capacitor", "heatsink", "core"] as const;
type Kind = (typeof KINDS)[number];
const TECHS: readonly SwitchTech[] = ["GaN", "SiC", "Si"];

/** Case-insensitive match of q against every string (and string[]) field. */
function textMatch(item: object, q: string): boolean {
  const needle = q.toLowerCase();
  for (const v of Object.values(item)) {
    if (typeof v === "string" && v.toLowerCase().includes(needle)) return true;
    if (Array.isArray(v)) {
      for (const s of v) {
        if (typeof s === "string" && s.toLowerCase().includes(needle)) return true;
      }
    }
  }
  return false;
}

function parsePositiveNumber(
  params: URLSearchParams,
  key: string,
  errors: string[],
): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw === "") return undefined;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) {
    errors.push(`${key} must be a positive number, got "${raw}"`);
    return undefined;
  }
  return v;
}

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const errors: string[] = [];

  const kindRaw = params.get("kind");
  if (kindRaw === null || !KINDS.includes(kindRaw as Kind)) {
    errors.push(`kind is required and must be one of: ${KINDS.join(", ")}`);
  }
  const kind = kindRaw as Kind;

  const techRaw = params.get("tech");
  let tech: SwitchTech | undefined;
  if (techRaw !== null && techRaw !== "") {
    if (TECHS.includes(techRaw as SwitchTech)) tech = techRaw as SwitchTech;
    else errors.push(`tech must be one of: ${TECHS.join(", ")}`);
  }

  const minVdsV = parsePositiveNumber(params, "minVdsV", errors);
  const maxRdsOnMohm = parsePositiveNumber(params, "maxRdsOnMohm", errors);
  const q = params.get("q") ?? undefined;

  if (errors.length) return jsonError(400, "Invalid component query", errors);

  let items: object[];
  switch (kind) {
    case "switch":
      items = findSwitches({ tech, minVdsV, maxRdsOnMohm });
      break;
    case "driver":
      items = GATE_DRIVERS;
      break;
    case "controller":
      items = CONTROLLERS;
      break;
    case "capacitor":
      items = CAPACITORS;
      break;
    case "heatsink":
      items = HEATSINKS;
      break;
    case "core":
      items = CORES;
      break;
  }

  if (q !== undefined && q !== "") items = items.filter((it) => textMatch(it, q));

  return jsonResponse(items);
}
