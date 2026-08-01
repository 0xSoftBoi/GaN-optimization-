/**
 * Inline test fixtures shared by the schematic/bom test suites.
 * Deliberately self-contained: no import of the data module (sibling agents
 * own it) — plausible datasheet-grade numbers hand-written here.
 */

import type {
  CapacitorPart,
  ControllerPart,
  CoreMaterial,
  CoreShape,
  DesignSpec,
  DeviceLoss,
  GateDriver,
  MagneticDesign,
  MagneticRole,
  SwitchDevice,
  WireSpec,
} from "@/lib/types";
import type { SchematicParts } from "./build";

export const GAN100: SwitchDevice = {
  id: "EPC2218",
  mfr: "EPC",
  tech: "GaN",
  vdsMaxV: 100,
  idMaxA: 60,
  rdsOnMohm25: 3.2,
  rdsOnTempco: 0.01,
  qgNc: 15,
  qossNc: 60,
  eossUj: 8,
  qrrNc: 0,
  vgsDriveV: 5,
  vthV: 1.4,
  rthJCcPerW: 0.5,
  pkg: "BGA",
  priceUsd1k: 3.9,
  suppliers: ["Digi-Key", "Mouser"],
};

export const GAN650: SwitchDevice = {
  id: "NV6128",
  mfr: "Navitas",
  tech: "GaN",
  vdsMaxV: 650,
  idMaxA: 22,
  rdsOnMohm25: 55,
  rdsOnTempco: 0.011,
  qgNc: 6,
  qossNc: 62,
  eossUj: 9,
  qrrNc: 0,
  vgsDriveV: 6,
  vthV: 1.7,
  rthJCcPerW: 1.1,
  pkg: "PQFN 6x8",
  priceUsd1k: 4.6,
  suppliers: ["Digi-Key"],
};

export const DRIVER: GateDriver = {
  id: "LM5113",
  mfr: "TI",
  channels: 2,
  isolated: false,
  peakSourceA: 1.2,
  peakSinkA: 5,
  cmtiVPerNs: 50,
  propDelayNs: 28,
  priceUsd1k: 1.05,
  suppliers: ["Digi-Key"],
};

export const CTRL: ControllerPart = {
  id: "STM32G474RE",
  mfr: "ST",
  family: "STM32G4",
  coreMhz: 170,
  pwmResolutionPs: 184,
  adcBits: 12,
  priceUsd1k: 4.1,
  suppliers: ["Digi-Key", "Mouser"],
};

export const CAP_CERAMIC: CapacitorPart = {
  id: "C3216X7R2A105K",
  mfr: "TDK",
  dielectric: "X7R",
  capUf: 1,
  voltageV: 100,
  esrMohm: 8,
  iRmsA: 2.5,
  priceUsd1k: 0.12,
  suppliers: ["Digi-Key"],
};

export const CAP_BULK: CapacitorPart = {
  id: "EEH-ZC1H101P",
  mfr: "Panasonic",
  dielectric: "polymer",
  capUf: 100,
  voltageV: 50,
  esrMohm: 20,
  iRmsA: 2,
  priceUsd1k: 0.85,
  suppliers: ["Mouser"],
};

const MAT: CoreMaterial = {
  id: "3C97",
  mfr: "Ferroxcube",
  steinmetzK: 2e-5,
  steinmetzAlpha: 1.8,
  steinmetzBeta: 2.5,
  bsatT: 0.41,
  muR: 2300,
  maxTempC: 140,
};

const CORE: CoreShape = {
  id: "PQ32/20",
  mfr: "Ferroxcube",
  materialId: "3C97",
  aeMm2: 169,
  awMm2: 60,
  veMm3: 9440,
  leMm: 55.9,
  mltMm: 66,
  priceUsd: 1.8,
};

const WIRE: WireSpec = {
  id: "litz-105x40",
  type: "litz",
  copperAreaMm2: 0.526,
  strandCount: 105,
  strandDiaMm: 0.0799,
  rdcMohmPerM: 32.8,
};

export function mkMag(role: MagneticRole, uH: number, turnsP: number, turnsS?: number): MagneticDesign {
  return {
    role,
    core: CORE,
    material: MAT,
    turnsPrimary: turnsP,
    turnsSecondary: turnsS,
    airGapMm: 0.4,
    wirePrimary: WIRE,
    wireSecondary: turnsS !== undefined ? WIRE : undefined,
    inductanceUh: uH,
    bPeakT: 0.12,
    coreLossW: 0.8,
    copperLossW: 1.1,
    tempRiseC: 28,
    windowUtilization: 0.32,
  };
}

export function mkDl(dev: SwitchDevice, role: string, positions: number, parallel = 1): DeviceLoss {
  return {
    role,
    device: dev,
    positions,
    parallelPerPosition: parallel,
    conductionW: 1.2,
    switchingW: 0.8,
    cossW: 0.3,
    gateW: 0.1,
    deadTimeW: 0.2,
    totalW: 2.6 * positions * parallel,
    tjC: 88,
  };
}

export function mkParts(switches: DeviceLoss[], mags: MagneticDesign[] = []): SchematicParts {
  return {
    switches,
    magnetics: mags,
    driver: DRIVER,
    controller: CTRL,
    caps: [
      { part: CAP_CERAMIC, qty: 4 },
      { part: CAP_BULK, qty: 3 },
    ],
  };
}

export const SPEC_BUCK: DesignSpec = {
  name: "POL buck",
  conversion: "dc-dc",
  vinMinV: 40,
  vinNomV: 48,
  vinMaxV: 60,
  voutV: 12,
  poutW: 300,
  bidirectional: false,
  isolated: false,
  fswHz: 500e3,
  ambientC: 40,
  cooling: "forced-air",
};

export const SPEC_DAB: DesignSpec = {
  name: "DAB brick",
  conversion: "dc-dc",
  vinMinV: 360,
  vinNomV: 400,
  vinMaxV: 440,
  voutV: 48,
  poutW: 3000,
  bidirectional: true,
  isolated: true,
  fswHz: 250e3,
  ambientC: 40,
  cooling: "forced-air",
};

export const SPEC_PFC: DesignSpec = {
  name: "TP-PFC front end",
  conversion: "ac-dc",
  vinMinV: 90,
  vinNomV: 325,
  vinMaxV: 373,
  voutV: 400,
  poutW: 3000,
  bidirectional: false,
  isolated: false,
  fswHz: 120e3,
  ambientC: 45,
  cooling: "forced-air",
  gridVacRms: 230,
};
