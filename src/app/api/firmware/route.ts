/**
 * POST /api/firmware — {spec: DesignSpec, target?: "STM32G474" | "TMS320F280049"}
 *   -> FirmwarePackage
 *
 * Runs (or re-uses, via the shared LRU) the full design to get the chosen
 * topology, switching frequency, and compensator, then emits the firmware
 * package for the requested control target. Defaults to STM32G474 — the
 * target the optimizer itself bundles into DesignResult.firmware.
 */

import { cachedDesign } from "@/app/api/_lib/cache";
import { engineError, jsonError, jsonResponse, readJsonBody } from "@/app/api/_lib/http";
import { specFromBody } from "@/app/api/_lib/validate";
import { generateFirmware } from "@/lib/firmware";
import type { FirmwarePackage } from "@/lib/types";

export const maxDuration = 60;

const TARGETS: readonly FirmwarePackage["target"][] = ["STM32G474", "TMS320F280049"];

export async function POST(req: Request): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;

  const body = parsed.body;
  const v = specFromBody(body);
  if (!v.ok) return jsonError(400, "Invalid design spec", v.errors);

  const targetRaw = (body as Record<string, unknown>).target;
  let target: FirmwarePackage["target"] = "STM32G474";
  if (targetRaw !== undefined && targetRaw !== null) {
    if (typeof targetRaw !== "string" || !TARGETS.includes(targetRaw as FirmwarePackage["target"])) {
      return jsonError(400, `target must be one of: ${TARGETS.join(", ")}`);
    }
    target = targetRaw as FirmwarePackage["target"];
  }

  try {
    const r = cachedDesign(v.spec);
    if (r.firmware && r.firmware.target === target) return jsonResponse(r.firmware);
    if (!r.compensator) {
      return jsonError(
        422,
        `No compensator available for topology "${r.topology.id}" — firmware generation needs a control design`,
      );
    }
    // r.spec is the optimizer's effective spec (defaults resolved) — use it so
    // the firmware constants match the design the engine actually produced.
    return jsonResponse(generateFirmware(target, r.topology.id, r.spec, r.fswHz, r.compensator));
  } catch (err) {
    return engineError(err);
  }
}
