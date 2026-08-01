/**
 * VoltForge component database — control ICs / MCUs.
 *
 * Digital parts list real core clocks and high-resolution PWM step sizes
 * (STM32G4 HRTIM 184 ps, C2000 HRPWM ~150 ps). Analog PWM controllers have
 * effectively continuous modulators: coreMhz = 0, pwmResolutionPs = 0,
 * adcBits = 0 by convention. Prices at 1k volume.
 */

import type { ControllerPart } from "@/lib/types";

const DK = "Digi-Key";
const MO = "Mouser";
const AR = "Arrow";
const AV = "Avnet";

export const CONTROLLERS: ControllerPart[] = [
  {
    id: "STM32G474RET6",
    mfr: "ST",
    family: "STM32G4",
    coreMhz: 170,
    pwmResolutionPs: 184, // HRTIM
    adcBits: 12,
    priceUsd1k: 4.9,
    suppliers: [DK, MO, AR, AV],
    notes: "Cortex-M4F + HRTIM (6x2 ch), 5x 12-bit ADC 4 MSPS, CORDIC/FMAC",
  },
  {
    id: "STM32G431CBT6",
    mfr: "ST",
    family: "STM32G4",
    coreMhz: 170,
    pwmResolutionPs: 5882, // 170 MHz advanced timer, no HRTIM
    adcBits: 12,
    priceUsd1k: 2.8,
    suppliers: [DK, MO, AR],
    notes: "Cost-entry G4; standard TIM1/TIM8 PWM only",
  },
  {
    id: "TMS320F280049C",
    mfr: "TI",
    family: "C2000",
    coreMhz: 100,
    pwmResolutionPs: 150, // HRPWM MEP step
    adcBits: 12,
    priceUsd1k: 6.5,
    suppliers: [DK, MO, AR, AV],
    notes: "C2000 Piccolo: 16 HRPWM ch, 3x 12-bit ADC, CLA co-processor, CLB",
  },
  {
    id: "TMS320F280025C",
    mfr: "TI",
    family: "C2000",
    coreMhz: 100,
    pwmResolutionPs: 150,
    adcBits: 12,
    priceUsd1k: 3.9,
    suppliers: [DK, MO, AR],
    notes: "Entry C2000 with HRPWM; single-core 100 MHz",
  },
  {
    id: "UCC28951",
    mfr: "TI",
    family: "analog-pwm",
    coreMhz: 0,
    pwmResolutionPs: 0, // analog modulator — continuous
    adcBits: 0,
    priceUsd1k: 1.95,
    suppliers: [DK, MO, AR, AV],
    notes: "Phase-shifted full-bridge controller w/ adaptive ZVS delays + SR outputs",
  },
  {
    id: "UCC28070",
    mfr: "TI",
    family: "analog-pwm",
    coreMhz: 0,
    pwmResolutionPs: 0,
    adcBits: 0,
    priceUsd1k: 2.3,
    suppliers: [DK, MO, AR],
    notes: "Two-phase interleaved CCM PFC controller",
  },
  {
    id: "ADP1055",
    mfr: "ADI",
    family: "digital-pwm",
    coreMhz: 48, // internal digital engine clock
    pwmResolutionPs: 156,
    adcBits: 12,
    priceUsd1k: 5.8,
    suppliers: [DK, MO, AV],
    notes: "Digital secondary-side controller, PMBus, 6 PWM outputs",
  },
  {
    id: "dsPIC33CK256MP505",
    mfr: "Microchip",
    family: "digital-pwm",
    coreMhz: 100,
    pwmResolutionPs: 250,
    adcBits: 12,
    priceUsd1k: 3.4,
    suppliers: [DK, MO, AR],
    notes: "DSC with 250 ps high-res PWM, 3.5 MSPS ADC cores",
  },
];

/** Look up a controller by exact part number. */
export function getController(id: string): ControllerPart | undefined {
  return CONTROLLERS.find((c) => c.id === id);
}
