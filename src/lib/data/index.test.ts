import { describe, expect, it } from "vitest";
import {
  CAPACITORS,
  CONTROLLERS,
  GATE_DRIVERS,
  HEATSINKS,
  SWITCH_DEVICES,
  findSwitches,
  getSwitch,
} from "./index";

describe("data module public API", () => {
  it("re-exports all catalogs and lookups per MODULES.md", () => {
    expect(SWITCH_DEVICES.length).toBeGreaterThanOrEqual(40);
    expect(GATE_DRIVERS.length).toBeGreaterThanOrEqual(8);
    expect(CONTROLLERS.length).toBeGreaterThanOrEqual(6);
    expect(CAPACITORS.length).toBeGreaterThanOrEqual(12);
    expect(HEATSINKS.length).toBeGreaterThanOrEqual(8);
    expect(typeof findSwitches).toBe("function");
    expect(typeof getSwitch).toBe("function");
    expect(getSwitch(SWITCH_DEVICES[0].id)).toBe(SWITCH_DEVICES[0]);
  });

  it("ids are unique across the whole component database", () => {
    const all = [
      ...SWITCH_DEVICES.map((x) => x.id),
      ...GATE_DRIVERS.map((x) => x.id),
      ...CONTROLLERS.map((x) => x.id),
      ...CAPACITORS.map((x) => x.id),
      ...HEATSINKS.map((x) => x.id),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
