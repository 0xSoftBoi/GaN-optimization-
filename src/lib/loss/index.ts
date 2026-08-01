/** VoltForge loss engine — public API (see src/lib/MODULES.md). */

export {
  deviceLoss,
  pickParallelCount,
  rdsOnAtTj,
  dynamicRonFactor,
  gateTimings,
  zvsResolve,
  qNodeCoulombs,
  eCapHardJ,
  vsdV,
  eossAtVoltageJ,
  reverseDropV,
  switchTransitionTimeS,
  gateDriveCurrentA,
  packageDissipationLimitW,
} from "./device";
export type { GateTimings, ZvsResult, DeviceLossOptions } from "./device";

export {
  coreLossW,
  acResistanceFactor,
  capacitorLossW,
  skinDepthCuM,
  RHO_CU_100C,
} from "./passives";
