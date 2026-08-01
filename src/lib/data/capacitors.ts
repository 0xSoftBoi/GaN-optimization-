/**
 * VoltForge component database — capacitors.
 *
 * ESR values are at the frequency that matters for each family: ~1 MHz for
 * MLCC (C0G/X7R), 10-100 kHz for film/polymer, 100 kHz for electrolytics
 * (low-Z series). Ripple ratings are datasheet RMS at 100 kHz / 105 °C where
 * applicable. Prices at 1k volume.
 */

import type { CapacitorPart } from "@/lib/types";

const DK = "Digi-Key";
const MO = "Mouser";
const AR = "Arrow";
const AV = "Avnet";

export const CAPACITORS: CapacitorPart[] = [
  // --- C0G / NP0 — resonant tanks, snubbers (no DC bias derating) ----------
  {
    id: "C3216C0G2J103J",
    mfr: "TDK",
    dielectric: "C0G",
    capUf: 0.01,
    voltageV: 630,
    esrMohm: 9,
    iRmsA: 2.5,
    priceUsd1k: 0.18,
    suppliers: [DK, MO, AR],
  },
  {
    id: "CGA9N4C0G2J104J",
    mfr: "TDK",
    dielectric: "C0G",
    capUf: 0.1,
    voltageV: 630,
    esrMohm: 4,
    iRmsA: 6,
    priceUsd1k: 0.95,
    suppliers: [DK, MO],
  },
  {
    id: "C1210C104KBGAC",
    mfr: "KEMET",
    dielectric: "C0G",
    capUf: 0.1,
    voltageV: 500,
    esrMohm: 5,
    iRmsA: 5,
    priceUsd1k: 0.65,
    suppliers: [DK, MO, AV],
  },
  // --- X7R MLCC — DC-link decoupling, output banks -------------------------
  {
    id: "GRM32ER72A106KA35",
    mfr: "Murata",
    dielectric: "X7R",
    capUf: 10,
    voltageV: 100,
    esrMohm: 3,
    iRmsA: 5,
    priceUsd1k: 0.42,
    suppliers: [DK, MO, AR, AV],
  },
  {
    id: "C5750X7R2A475K",
    mfr: "TDK",
    dielectric: "X7R",
    capUf: 4.7,
    voltageV: 100,
    esrMohm: 4,
    iRmsA: 3.5,
    priceUsd1k: 0.55,
    suppliers: [DK, MO, AR],
  },
  {
    id: "GRM31CR71H475KA12",
    mfr: "Murata",
    dielectric: "X7R",
    capUf: 4.7,
    voltageV: 50,
    esrMohm: 5,
    iRmsA: 2.5,
    priceUsd1k: 0.12,
    suppliers: [DK, MO, AR, AV],
  },
  // --- Film — DC link / PFC output -----------------------------------------
  {
    id: "C4AQCBW5300A3MJ",
    mfr: "KEMET",
    dielectric: "film",
    capUf: 30,
    voltageV: 450,
    esrMohm: 4.5,
    iRmsA: 14,
    priceUsd1k: 3.9,
    suppliers: [DK, MO, AV],
  },
  {
    id: "B32778G4306",
    mfr: "TDK-EPCOS",
    dielectric: "film",
    capUf: 30,
    voltageV: 450,
    esrMohm: 5,
    iRmsA: 15.5,
    priceUsd1k: 4.2,
    suppliers: [DK, MO, AR],
  },
  {
    id: "MKP1848C54050JP",
    mfr: "Vishay",
    dielectric: "film",
    capUf: 40,
    voltageV: 500,
    esrMohm: 4.8,
    iRmsA: 16,
    priceUsd1k: 5.1,
    suppliers: [DK, MO, AR, AV],
  },
  // --- Aluminum electrolytic — bulk energy ---------------------------------
  {
    id: "UCY2G331MHD",
    mfr: "Nichicon",
    dielectric: "electrolytic",
    capUf: 330,
    voltageV: 400,
    esrMohm: 320,
    iRmsA: 2.1,
    priceUsd1k: 2.4,
    suppliers: [DK, MO, AR],
  },
  {
    id: "EEU-FC1H222",
    mfr: "Panasonic",
    dielectric: "electrolytic",
    capUf: 2200,
    voltageV: 50,
    esrMohm: 24,
    iRmsA: 3.1,
    priceUsd1k: 0.95,
    suppliers: [DK, MO, AV],
  },
  {
    id: "63ZLH1000MEFC",
    mfr: "Rubycon",
    dielectric: "electrolytic",
    capUf: 1000,
    voltageV: 63,
    esrMohm: 38,
    iRmsA: 2.5,
    priceUsd1k: 0.6,
    suppliers: [DK, MO],
  },
  // --- Polymer / hybrid — low-ESR output banks -----------------------------
  {
    id: "25SVPF330M",
    mfr: "Panasonic",
    dielectric: "polymer",
    capUf: 330,
    voltageV: 25,
    esrMohm: 10,
    iRmsA: 4.4,
    priceUsd1k: 0.68,
    suppliers: [DK, MO, AR],
  },
  {
    id: "EEH-ZC1H331P",
    mfr: "Panasonic",
    dielectric: "polymer",
    capUf: 330,
    voltageV: 50,
    esrMohm: 20,
    iRmsA: 3.2,
    priceUsd1k: 1.1,
    suppliers: [DK, MO, AV],
  },
];

/** Look up a capacitor by exact part number. */
export function getCapacitor(id: string): CapacitorPart | undefined {
  return CAPACITORS.find((c) => c.id === id);
}
