/**
 * POST /api/copilot — {prompt: string} -> {parse: CopilotParse, result: DesignResult}
 *
 * Natural-language front door: deterministic prompt parser → full design run.
 * The parse (assumptions, confidence, unrecognized fragments) rides along so
 * the UI can show what the copilot inferred versus what the user said.
 */

import { cachedDesign } from "@/app/api/_lib/cache";
import { engineError, jsonError, jsonResponse, readJsonBody } from "@/app/api/_lib/http";
import { parsePrompt } from "@/lib/copilot";

export const maxDuration = 60;

const MAX_PROMPT_CHARS = 4000;

export async function POST(req: Request): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;

  const body = parsed.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError(400, "body must be a JSON object: {prompt: string}");
  }
  const prompt = (body as Record<string, unknown>).prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return jsonError(400, "body.prompt must be a non-empty string");
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return jsonError(400, `body.prompt must be <= ${MAX_PROMPT_CHARS} characters`);
  }

  try {
    const parse = parsePrompt(prompt);
    const result = cachedDesign(parse.spec);
    return jsonResponse({ parse, result });
  } catch (err) {
    return engineError(err);
  }
}
