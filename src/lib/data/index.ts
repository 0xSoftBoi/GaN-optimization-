/**
 * VoltForge component database — public API (see MODULES.md "data").
 *
 * Magnetics tables (CORE_MATERIALS, CORES, WIRES) are owned by the magnetics
 * module owner and exported directly from `@/lib/data/magnetics` per
 * MODULES.md — they are intentionally not re-exported here.
 */

export { SWITCH_DEVICES, findSwitches, getSwitch } from "./devices";
export type { SwitchFilter } from "./devices";
export { GATE_DRIVERS, getDriver } from "./drivers";
export { CONTROLLERS, getController } from "./controllers";
export { CAPACITORS, getCapacitor } from "./capacitors";
export { HEATSINKS, getHeatsink } from "./heatsinks";
