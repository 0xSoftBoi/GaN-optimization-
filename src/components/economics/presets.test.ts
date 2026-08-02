import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESET_ID,
  PRESETS,
  presetById,
  promptFromSession,
  specFromSession,
} from "./presets";

describe("PRESETS", () => {
  it("has 3 distinct, physically sane example converters", () => {
    expect(PRESETS).toHaveLength(3);
    const ids = new Set(PRESETS.map((p) => p.id));
    expect(ids.size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
      const s = p.spec;
      expect(s.poutW).toBeGreaterThan(0);
      expect(s.voutV).toBeGreaterThan(0);
      expect(s.vinMinV).toBeLessThanOrEqual(s.vinNomV);
      expect(s.vinNomV).toBeLessThanOrEqual(s.vinMaxV);
      expect(["dc-dc", "ac-dc"]).toContain(s.conversion);
    }
  });

  it("covers a spread of power levels (small POL through multi-kW)", () => {
    const pows = PRESETS.map((p) => p.spec.poutW).sort((a, b) => a - b);
    expect(pows[0]).toBeLessThan(1000);
    expect(pows[pows.length - 1]).toBeGreaterThanOrEqual(3000);
  });

  it("the ac-dc preset carries gridVacRms and a rectified-bus vin range around it", () => {
    const pfc = PRESETS.find((p) => p.spec.conversion === "ac-dc");
    expect(pfc).toBeDefined();
    expect(pfc?.spec.gridVacRms).toBe(230);
    // Rectified peak of 230 Vac is ~325 V.
    expect(pfc?.spec.vinNomV).toBeGreaterThan(300);
    expect(pfc?.spec.vinNomV).toBeLessThan(360);
  });
});

describe("presetById / DEFAULT_PRESET_ID", () => {
  it("DEFAULT_PRESET_ID resolves to the first preset", () => {
    expect(presetById(DEFAULT_PRESET_ID)).toBe(PRESETS[0]);
  });

  it("returns undefined for an unknown id", () => {
    expect(presetById("nope")).toBeUndefined();
  });
});

describe("session hand-off (no sessionStorage in this test environment)", () => {
  it("specFromSession/promptFromSession fail closed to null instead of throwing", () => {
    expect(() => specFromSession()).not.toThrow();
    expect(() => promptFromSession()).not.toThrow();
    expect(specFromSession()).toBeNull();
    expect(promptFromSession()).toBeNull();
  });
});
