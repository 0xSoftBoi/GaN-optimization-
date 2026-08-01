import { describe, expect, it } from "vitest";
import { BUCK_SPEC, ISO_SPEC, postJson, postRaw } from "../_lib/test-fixtures";
import { POST } from "./route";

describe("POST /api/export — validation", () => {
  it("400 on malformed JSON", async () => {
    expect((await POST(postRaw("(kicad_sch"))).status).toBe(400);
  });

  it("400 when format is missing or unknown", async () => {
    const missing = await POST(postJson({ spec: BUCK_SPEC }));
    expect(missing.status).toBe(400);
    const bad = await POST(postJson({ spec: BUCK_SPEC, format: "altium" }));
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string };
    expect(body.error).toContain("format");
  });

  it("400 on a bad spec, as JSON not plain text", async () => {
    const res = await POST(postJson({ spec: { ...BUCK_SPEC, voutV: 0 }, format: "kicad" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("POST /api/export — kicad", () => {
  it("returns a balanced .kicad_sch s-expression as text/plain", async () => {
    const res = await POST(postJson({ spec: BUCK_SPEC, format: "kicad" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("content-disposition")).toContain(".kicad_sch");
    const text = await res.text();
    expect(text.startsWith("(kicad_sch")).toBe(true);
    expect(text).toContain("(version 20231120)");
    expect(text).toContain('(generator "voltforge")');
    expect(text).toContain("(global_label ");
    const stripped = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const open = (stripped.match(/\(/g) ?? []).length;
    const close = (stripped.match(/\)/g) ?? []).length;
    expect(open).toBe(close);
  });

  it("is deterministic for the same spec", async () => {
    const a = await (await POST(postJson({ spec: BUCK_SPEC, format: "kicad" }))).text();
    const b = await (await POST(postJson({ spec: BUCK_SPEC, format: "kicad" }))).text();
    expect(a).toBe(b);
  });
});

describe("POST /api/export — ltspice", () => {
  it("returns a .net deck with .tran and .end", async () => {
    const res = await POST(postJson({ spec: BUCK_SPEC, format: "ltspice" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("content-disposition")).toContain(".net");
    const text = await res.text();
    expect(text).toContain(".tran");
    expect(text.trimEnd().endsWith(".end")).toBe(true);
    expect(text).toContain("LTspice netlist");
  });

  it("different specs yield different exports", async () => {
    const a = await (await POST(postJson({ spec: BUCK_SPEC, format: "ltspice" }))).text();
    const b = await (await POST(postJson({ spec: ISO_SPEC, format: "ltspice" }))).text();
    expect(a).not.toEqual(b);
  });
});
