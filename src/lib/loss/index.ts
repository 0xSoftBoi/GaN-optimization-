/** VoltForge loss engine — public API (see src/lib/MODULES.md). */

export {
  deviceLoss,
  pickParallelCount,
  rdsOnAtTj,
  eossAtVoltageJ,
  reverseDropV,
  switchTransitionTimeS,
  gateDriveCurrentA,
  packageDissipationLimitW,
} from "./device";

export {
  coreLossW,
  acResistanceFactor,
  capacitorLossW,
  skinDepthCuM,
  RHO_CU_100C,
} from "./passives";
