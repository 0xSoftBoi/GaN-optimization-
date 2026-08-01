import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPEC,
  EXAMPLE_PROMPTS,
  PIPELINE_STAGES,
  decodeRequest,
  encodeRequest,
} from "./examples";

describe("DEFAULT_SPEC", () => {
  it("is the 5 kW 800→48 V bidirectional isolated brick", () => {
    expect(DEFAULT_SPEC.poutW).toBe(5000);
    expect(DEFAULT_SPEC.vinNomV).toBe(800);
    expect(DEFAULT_SPEC.voutV).toBe(48);
    expect(DEFAULT_SPEC.bidirectional).toBe(true);
    expect(DEFAULT_SPEC.isolated).toBe(true);
  });

  it("has physically consistent voltage ordering and ratio", () => {
    expect(DEFAULT_SPEC.vinMinV).toBeLessThanOrEqual(DEFAULT_SPEC.vinNomV);
    expect(DEFAULT_SPEC.vinNomV).toBeLessThanOrEqual(DEFAULT_SPEC.vinMaxV);
    const ratio = DEFAULT_SPEC.vinNomV / DEFAULT_SPEC.voutV;
    // ~16.7:1 — deep step-down that mandates an isolated topology.
    expect(ratio).toBeGreaterThan(10);
    expect(ratio).toBeLessThan(25);
    expect(DEFAULT_SPEC.ambientC).toBeGreaterThanOrEqual(-40);
    expect(DEFAULT_SPEC.ambientC).toBeLessThanOrEqual(85);
  });
});

describe("EXAMPLE_PROMPTS", () => {
  it("ships the three canonical demos with parseable numbers", () => {
    expect(EXAMPLE_PROMPTS.length).toBe(3);
    const all = EXAMPLE_PROMPTS.map((e) => e.prompt).join(" | ");
    expect(all).toMatch(/5\s?kW/i);
    expect(all).toMatch(/800V/i);
    expect(all).toMatch(/600W/i);
    expect(all).toMatch(/totem-pole/i);
    expect(all).toMatch(/230Vac/i);
    for (const e of EXAMPLE_PROMPTS) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.prompt.length).toBeGreaterThan(10);
    }
  });
});

describe("request round-trip", () => {
  it("prompt requests survive encode/decode", () => {
    const r = decodeRequest(encodeRequest({ prompt: "5kW 800V to 48V" }));
    expect(r).toEqual({ prompt: "5kW 800V to 48V" });
  });

  it("spec requests survive encode/decode", () => {
    const r = decodeRequest(encodeRequest({ spec: DEFAULT_SPEC }));
    expect(r?.spec?.poutW).toBe(5000);
    expect(r?.prompt).toBeUndefined();
  });

  it("rejects malformed payloads", () => {
    expect(decodeRequest(null)).toBeNull();
    expect(decodeRequest("")).toBeNull();
    expect(decodeRequest("not json {")).toBeNull();
    expect(decodeRequest("[1,2]")).toBeNull();
    expect(decodeRequest('{"prompt":""}')).toBeNull();
    expect(decodeRequest('{"spec":{"foo":1}}')).toBeNull();
  });
});

describe("PIPELINE_STAGES", () => {
  it("has a plausible multi-stage story ending in compliance/firmware", () => {
    expect(PIPELINE_STAGES.length).toBeGreaterThanOrEqual(5);
    expect(PIPELINE_STAGES[0].toLowerCase()).toContain("pars");
    expect(PIPELINE_STAGES[PIPELINE_STAGES.length - 1].toLowerCase()).toContain("firmware");
  });
});
