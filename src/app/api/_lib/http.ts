/** VoltForge API — small JSON request/response helpers shared by routes. */

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function jsonError(status: number, error: string, details?: string[]): Response {
  return jsonResponse(details && details.length ? { error, details } : { error }, status);
}

/**
 * Read and parse a JSON request body. Returns a discriminated result so the
 * caller can early-return the 400 on malformed input.
 */
export async function readJsonBody(
  req: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, res: jsonError(400, "Unable to read request body") };
  }
  if (!text.trim()) return { ok: false, res: jsonError(400, "Request body is empty; expected JSON") };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, res: jsonError(400, "Request body is not valid JSON") };
  }
}

/** Uniform 500 wrapper for engine failures so routes never leak stack traces. */
export function engineError(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  return jsonError(500, `Design engine error: ${message}`);
}
