/**
 * VoltForge component database — heatsinks.
 *
 * Rth(sink-ambient) at natural convection and (where rated) 400 LFM forced
 * air. Spans TO-220 clip-ons through 150 mm extrusions. Unit prices (not 1k).
 */

import type { Heatsink } from "@/lib/types";

export const HEATSINKS: Heatsink[] = [
  {
    id: "577002B00000G",
    mfr: "Boyd (Aavid)",
    rthSaCPerWNatural: 24,
    rthSaCPerWForced: 11,
    heightMm: 12.7,
    footprintMm: [19, 13],
    priceUsd: 0.48,
    // TO-220 clip-on, black anodized
  },
  {
    id: "507302B00000G",
    mfr: "Boyd (Aavid)",
    rthSaCPerWNatural: 17,
    rthSaCPerWForced: 8,
    heightMm: 25.4,
    footprintMm: [35, 13],
    priceUsd: 0.62,
  },
  {
    id: "SK104-25.4",
    mfr: "Fischer Elektronik",
    rthSaCPerWNatural: 12,
    rthSaCPerWForced: 5.5,
    heightMm: 25.4,
    footprintMm: [38, 35],
    priceUsd: 1.1,
  },
  {
    id: "657-15ABPE",
    mfr: "Wakefield-Vette",
    rthSaCPerWNatural: 10.2,
    rthSaCPerWForced: 4.4,
    heightMm: 38,
    footprintMm: [42, 25],
    priceUsd: 1.9,
  },
  {
    id: "ATS-1040-C2-R0",
    mfr: "Advanced Thermal Solutions",
    rthSaCPerWNatural: 8.6,
    rthSaCPerWForced: 3.2,
    heightMm: 12,
    footprintMm: [40, 40],
    priceUsd: 2.8,
    // maxiFLOW spread-fin — forced-air optimized
  },
  {
    id: "65605",
    mfr: "Boyd (Aavid)",
    rthSaCPerWNatural: 4.5,
    rthSaCPerWForced: 1.9,
    heightMm: 37,
    footprintMm: [75, 60],
    priceUsd: 6.5,
  },
  {
    id: "LAM-4-100",
    mfr: "Fischer Elektronik",
    rthSaCPerWNatural: 7.5,
    rthSaCPerWForced: 1.3,
    heightMm: 44,
    footprintMm: [100, 41],
    priceUsd: 12.5,
    // hollow-fin extrusion designed for an axial fan push-through
  },
  {
    id: "SK92-100",
    mfr: "Fischer Elektronik",
    rthSaCPerWNatural: 2.8,
    rthSaCPerWForced: 1.2,
    heightMm: 40,
    footprintMm: [100, 92],
    priceUsd: 9.8,
  },
  {
    id: "OS515-150",
    mfr: "Boyd (Aavid)",
    rthSaCPerWNatural: 1.6,
    rthSaCPerWForced: 0.65,
    heightMm: 40,
    footprintMm: [150, 125],
    priceUsd: 16.0,
    // 150 mm extrusion, multi-device baseplate
  },
];

/** Look up a heatsink by exact part number. */
export function getHeatsink(id: string): Heatsink | undefined {
  return HEATSINKS.find((h) => h.id === id);
}
