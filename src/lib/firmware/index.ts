/** VoltForge firmware module — public API (see MODULES.md). */
export {
  generateFirmware,
  hrtimTiming,
  epwmTiming,
  cFloat9,
  STM32_HRTIM_FCLK_HZ,
  STM32_HRTIM_HIRES_MULT,
  STM32_HRTIM_PER_MAX,
  STM32_HRTIM_PER_MIN,
  STM32_HRTIM_DT_LSB_PS,
  C2000_EPWM_CLK_HZ,
} from "./generate";
export type { HrtimTiming, EpwmTiming } from "./generate";
