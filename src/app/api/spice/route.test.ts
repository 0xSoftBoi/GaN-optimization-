import { describe, expect, it } from "vitest";
import { BUCK_SPEC, ISO_SPEC, postJson, postRaw } from "../_lib/test-fixtures";
import { POST } from "./route";

describe("POST /api/spice — validation", () => {
  it("400 on malformed JSON", async () => {
    expect((await POST(postRaw("* not a spec"))).status).toBe(400);
  });

  it("400 on a bad spec, as JSON not plain text", async () => {
    const res = await POST(postJson({ spec: { ...BUCK_SPEC, voutV: 0 } }));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("POST /api/spice — happy path", () => {
  it("returns a runnable SPICE netlist as text/plain", async () => {
    const res = await POST(postJson({ spec: BUCK_SPEC }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain(".tran");
    expect(text.trimEnd().endsWith(".end")).toBe(true);
    // A netlist, not a JSON blob.
    expect(text.trim().startsWith("{")).toBe(false);
    expect(text.split("\n").length).toBeGreaterThan(10);
  });

  it("different specs yield different netlists", async () => {
    const a = await (await POST(postJson({ spec: BUCK_SPEC }))).text();
    const b = await (await POST(postJson({ spec: ISO_SPEC }))).text();
    expect(a).not.toEqual(b);
  });
});
