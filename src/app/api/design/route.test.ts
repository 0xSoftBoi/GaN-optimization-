import { describe, expect, it } from "vitest";
import type { DesignResult } from "@/lib/types";
import { BUCK_SPEC, postJson, postRaw } from "../_lib/test-fixtures";
import { POST } from "./route";

describe("POST /api/design — input validation", () => {
  it("400 on a non-JSON body", async () => {
    const res = await POST(postRaw("this is not json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/JSON/i);
  });

  it("400 on an empty body", async () => {
    const res = await POST(postRaw(""));
    expect(res.status).toBe(400);
  });

  it("400 when body.spec is missing", async () => {
    const res = await POST(postJson({ notSpec: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.join(" ")).toMatch(/spec/);
  });

  it("400 on missing required fields, naming them", async () => {
    const res = await POST(postJson({ spec: { conversion: "dc-dc" } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    const all = body.details.join(" ");
    expect(all).toMatch(/poutW/);
    expect(all).toMatch(/voutV/);
    expect(all).toMatch(/cooling/);
  });

  it("400 on an inverted input-voltage range", async () => {
    const res = await POST(postJson({ spec: { ...BUCK_SPEC, vinMinV: 100, vinNomV: 48 } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.join(" ")).toMatch(/vinMinV/);
  });

  it("400 on negative power and bogus cooling", async () => {
    const res = await POST(
      postJson({ spec: { ...BUCK_SPEC, poutW: -5, cooling: "magic" } }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    const all = body.details.join(" ");
    expect(all).toMatch(/poutW/);
    expect(all).toMatch(/cooling/);
  });

  it("400 on non-numeric voltage", async () => {
    const res = await POST(postJson({ spec: { ...BUCK_SPEC, voutV: "twelve" } }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/design — happy path", () => {
  it("returns a complete DesignResult with plausible physics", async () => {
    const res = await POST(postJson({ spec: BUCK_SPEC }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const r = (await res.json()) as DesignResult;

    // Structure
    expect(r.spec.poutW).toBe(BUCK_SPEC.poutW);
    expect(typeof r.topology.id).toBe("string");
    expect(r.topologyRationale.length).toBeGreaterThan(0);
    expect(r.devices.length).toBeGreaterThan(0);
    expect(r.bom.length).toBeGreaterThan(0);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.schematic.spiceNetlist).toContain(".tran");
    expect(r.efficiencyCurve.length).toBeGreaterThan(2);

    // Physics sanity
    expect(r.fswHz).toBeGreaterThan(20e3);
    expect(r.fswHz).toBeLessThan(5e6);
    expect(r.efficiencyPct).toBeGreaterThan(80);
    expect(r.efficiencyPct).toBeLessThan(99.9);
    expect(r.losses.totalW).toBeGreaterThan(0);
    expect(r.bomCostUsd).toBeGreaterThan(1);
    expect(r.bomCostUsd).toBeLessThan(10_000);
    // A 48→12 V non-isolated spec must not pick an isolated topology.
    expect(r.topology.isolated).toBe(false);
  });

  it("ignores unknown spec keys instead of failing", async () => {
    const res = await POST(postJson({ spec: { ...BUCK_SPEC, hovercraft: "full of eels" } }));
    expect(res.status).toBe(200);
    const r = (await res.json()) as DesignResult;
    expect((r.spec as unknown as Record<string, unknown>).hovercraft).toBeUndefined();
  });

  it("serves the identical result from cache on a repeat call", async () => {
    const a = (await (await POST(postJson({ spec: BUCK_SPEC }))).json()) as DesignResult;
    const b = (await (await POST(postJson({ spec: BUCK_SPEC }))).json()) as DesignResult;
    expect(b).toEqual(a);
  });
});
