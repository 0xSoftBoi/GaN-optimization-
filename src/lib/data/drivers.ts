/**
 * VoltForge component database — gate drivers.
 *
 * Peak source/sink are datasheet peak output currents; CMTI is the rated
 * common-mode transient immunity (0 for non-isolated ground-referenced
 * drivers where the spec does not apply). Prices at 1k volume.
 */

import type { GateDriver } from "@/lib/types";

const DK = "Digi-Key";
const MO = "Mouser";
const AR = "Arrow";
const AV = "Avnet";

export const GATE_DRIVERS: GateDriver[] = [
  {
    id: "UCC21520",
    mfr: "TI",
    channels: 2,
    isolated: true,
    peakSourceA: 4,
    peakSinkA: 6,
    cmtiVPerNs: 100,
    propDelayNs: 19,
    priceUsd1k: 2.1,
    suppliers: [DK, MO, AR, AV],
    notes: "5.7 kVrms dual-channel isolated; half-bridge workhorse, programmable dead time",
  },
  {
    id: "UCC21222",
    mfr: "TI",
    channels: 2,
    isolated: true,
    peakSourceA: 4,
    peakSinkA: 6,
    cmtiVPerNs: 150,
    propDelayNs: 28,
    priceUsd1k: 1.65,
    suppliers: [DK, MO, AR],
    notes: "3 kVrms dual isolated, 5 V UVLO option suits GaN Vgs rails",
  },
  {
    id: "UCC27611",
    mfr: "TI",
    channels: 1,
    isolated: false,
    peakSourceA: 4,
    peakSinkA: 6,
    cmtiVPerNs: 0, // non-isolated, ground-referenced — CMTI not applicable
    propDelayNs: 14,
    priceUsd1k: 0.85,
    suppliers: [DK, MO, AR],
    notes: "Low-side driver with 5 V regulated output clamp — made for e-mode GaN gates",
  },
  {
    id: "Si8271GB-IS",
    mfr: "Skyworks",
    channels: 1,
    isolated: true,
    peakSourceA: 1.8,
    peakSinkA: 4,
    cmtiVPerNs: 200,
    propDelayNs: 30,
    priceUsd1k: 1.9,
    suppliers: [DK, MO, AV],
    notes: "5 kVrms single isolated (ex-Silicon Labs); 200 V/ns CMTI for GaN bridges",
  },
  {
    id: "1EDN7550B",
    mfr: "Infineon",
    channels: 1,
    isolated: false,
    peakSourceA: 4,
    peakSinkA: 8,
    cmtiVPerNs: 150, // truly-differential inputs ride ±150 V ground bounce
    propDelayNs: 19,
    priceUsd1k: 1.1,
    suppliers: [DK, MO, AR],
    notes: "EiceDRIVER with truly differential inputs; GND-shift-robust GaN drive",
  },
  {
    id: "ADuM4121",
    mfr: "ADI",
    channels: 1,
    isolated: true,
    peakSourceA: 2,
    peakSinkA: 2,
    cmtiVPerNs: 150,
    propDelayNs: 38,
    priceUsd1k: 3.2,
    suppliers: [DK, MO, AR, AV],
    notes: "5 kVrms iCoupler with internal Miller clamp",
  },
  {
    id: "STGAP2S",
    mfr: "ST",
    channels: 1,
    isolated: true,
    peakSourceA: 4,
    peakSinkA: 4,
    cmtiVPerNs: 100,
    propDelayNs: 80,
    priceUsd1k: 2.6,
    suppliers: [DK, MO, AR],
    notes: "Galvanically isolated single driver, Miller clamp + desat input",
  },
  {
    id: "UCC5350",
    mfr: "TI",
    channels: 1,
    isolated: true,
    peakSourceA: 5,
    peakSinkA: 5,
    cmtiVPerNs: 100,
    propDelayNs: 60,
    priceUsd1k: 1.45,
    suppliers: [DK, MO, AV],
    notes: "3 kVrms basic isolated driver, SiC-oriented UVLO options",
  },
  {
    id: "NCP51820",
    mfr: "onsemi",
    channels: 2,
    isolated: false,
    peakSourceA: 2,
    peakSinkA: 4,
    cmtiVPerNs: 200,
    propDelayNs: 25,
    priceUsd1k: 1.75,
    suppliers: [DK, MO, AR],
    notes: "650 V level-shifted half-bridge GaN driver, split source/sink pins",
  },
  {
    id: "LM5113",
    mfr: "TI",
    channels: 2,
    isolated: false,
    peakSourceA: 1.2,
    peakSinkA: 5,
    cmtiVPerNs: 50,
    propDelayNs: 28,
    priceUsd1k: 1.6,
    suppliers: [DK, MO],
    notes: "100 V bootstrap half-bridge driver with 5.2 V bootstrap clamp for eGaN",
  },
];

/** Look up a gate driver by exact part number. */
export function getDriver(id: string): GateDriver | undefined {
  return GATE_DRIVERS.find((d) => d.id === id);
}
