/**
 * Shared fixtures/helpers for API route tests. Not a route file — imported
 * only from *.test.ts, so it never ships in a handler bundle.
 */

import type { DesignSpec } from "@/lib/types";

/** Small non-isolated point-of-load spec — fast through the optimizer. */
export const BUCK_SPEC: DesignSpec = {
  name: "test-buck",
  conversion: "dc-dc",
  vinMinV: 40,
  vinNomV: 48,
  vinMaxV: 60,
  voutV: 12,
  poutW: 240,
  bidirectional: false,
  isolated: false,
  ambientC: 35,
  cooling: "natural",
};

/** Isolated mid-power spec (exercises transformer topologies). */
export const ISO_SPEC: DesignSpec = {
  name: "test-iso",
  conversion: "dc-dc",
  vinMinV: 360,
  vinNomV: 400,
  vinMaxV: 420,
  voutV: 48,
  poutW: 1500,
  bidirectional: false,
  isolated: true,
  ambientC: 40,
  cooling: "forced-air",
};

/** Build a POST Request with a JSON body against a fake origin. */
export function postJson(body: unknown, path = "/api/test"): Request {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Build a POST Request with a raw (possibly malformed) body. */
export function postRaw(body: string, path = "/api/test"): Request {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}
