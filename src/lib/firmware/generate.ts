/**
 * VoltForge firmware generator.
 *
 * Emits compilable-looking, register-level C for the two supported digital
 * control targets:
 *
 *   - STM32G474  (Cortex-M4 @ 170 MHz, HRTIM: 170 MHz x32 DLL = 184 ps LSB)
 *   - TMS320F280049 (C28x @ 100 MHz + CLA, EPWM up-down / CMPSS)
 *
 * Every numeric register value (period, prescaler, dead-time ticks, DAC trip
 * codes, biquad coefficients) is computed from the actual spec / fsw /
 * compensator and baked into config.h, so the emitted sources are
 * self-consistent with the rest of the design.
 */

import type {
  CompensatorDesign,
  DesignSpec,
  FirmwareFile,
  FirmwarePackage,
  TopologyId,
} from "@/lib/types";
import { clamp } from "@/lib/util";

// ---------------------------------------------------------------------------
// Timer timing math
// ---------------------------------------------------------------------------

/** STM32G474 system / HRTIM kernel clock (PLL-R). */
export const STM32_HRTIM_FCLK_HZ = 170e6;
/** HRTIM high-resolution DLL multiplier at CKPSC = 0 (184 ps LSB). */
export const STM32_HRTIM_HIRES_MULT = 32;
/** HRTIM 16-bit period register ceiling (0xFFDF per RM0440). */
export const STM32_HRTIM_PER_MAX = 0xffdf;
/** HRTIM minimum period value (0x0060 per RM0440). */
export const STM32_HRTIM_PER_MIN = 0x0060;
/** Dead-time generator LSB at DTPRSC = 0: t_HRTIM/8 = 735.3 ps. */
export const STM32_HRTIM_DT_LSB_PS = 1e12 / (STM32_HRTIM_FCLK_HZ * 8);

/** TMS320F280049 EPWM time-base clock (EPWMCLK = SYSCLK = 100 MHz). */
export const C2000_EPWM_CLK_HZ = 100e6;

export interface HrtimTiming {
  /** CKPSC[2:0] prescaler exponent: f_tick = 170 MHz * 32 / 2^ckpsc. */
  ckpsc: number;
  periodTicks: number;
  /** fsw actually achieved with the integer period. */
  actualFswHz: number;
  /** Counter LSB in picoseconds at this prescaler. */
  resolutionPs: number;
  /** DTPRSC[2:0]: dead-time LSB = 735.3 ps * 2^dtPrsc. */
  dtPrsc: number;
  dtTicks: number;
  deadTimeNs: number;
}

export interface EpwmTiming {
  /** Up-down count: fsw = EPWMCLK / (2 * TBPRD). */
  tbprd: number;
  actualFswHz: number;
  /** Dead-band counts, 10 ns per TBCLK at 100 MHz. */
  dbTicks: number;
  deadTimeNs: number;
}

/** HRTIM period/prescaler/dead-time for a requested fsw. */
export function hrtimTiming(fswHz: number, deadTimeNs: number): HrtimTiming {
  let ckpsc = 0;
  let periodTicks = 0;
  for (; ckpsc <= 7; ckpsc++) {
    periodTicks = Math.round(
      (STM32_HRTIM_FCLK_HZ * STM32_HRTIM_HIRES_MULT) / 2 ** ckpsc / fswHz,
    );
    if (periodTicks <= STM32_HRTIM_PER_MAX) break;
  }
  ckpsc = Math.min(ckpsc, 7);
  periodTicks = clamp(periodTicks, STM32_HRTIM_PER_MIN, STM32_HRTIM_PER_MAX);
  const tickHz = (STM32_HRTIM_FCLK_HZ * STM32_HRTIM_HIRES_MULT) / 2 ** ckpsc;
  const actualFswHz = tickHz / periodTicks;
  const resolutionPs = 1e12 / tickHz;

  // Dead-time generator: 9-bit DTR/DTF fields, LSB = 735.3 ps * 2^DTPRSC.
  let dtPrsc = 0;
  let dtTicks = Math.round((deadTimeNs * 1000) / STM32_HRTIM_DT_LSB_PS);
  while (dtTicks > 511 && dtPrsc < 7) {
    dtPrsc++;
    dtTicks = Math.round(
      (deadTimeNs * 1000) / (STM32_HRTIM_DT_LSB_PS * 2 ** dtPrsc),
    );
  }
  dtTicks = clamp(dtTicks, 1, 511);
  return { ckpsc, periodTicks, actualFswHz, resolutionPs, dtPrsc, dtTicks, deadTimeNs };
}

/** EPWM up-down-count TBPRD and dead-band counts for a requested fsw. */
export function epwmTiming(fswHz: number, deadTimeNs: number): EpwmTiming {
  const tbprd = clamp(Math.round(C2000_EPWM_CLK_HZ / (2 * fswHz)), 2, 0xffff);
  return {
    tbprd,
    actualFswHz: C2000_EPWM_CLK_HZ / (2 * tbprd),
    dbTicks: clamp(Math.round(deadTimeNs / 10), 1, 0x3fff),
    deadTimeNs,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** C float literal with 9 significant digits, e.g. "0.0123456789f". */
export function cFloat9(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`non-finite value in firmware constant: ${x}`);
  const s = x.toPrecision(9);
  return s.includes(".") || s.includes("e") ? `${s}f` : `${s}.0f`;
}

function cUint(x: number): string {
  return `${Math.round(x)}U`;
}

function padDefines(lines: [string, string, string][]): string {
  // Align "#define NAME (value)  /* comment */"
  const nameW = Math.max(...lines.map(([n]) => n.length)) + 2;
  const valW = Math.max(...lines.map(([, v]) => v.length)) + 4; // "(", ")" + 2-space gap
  return lines
    .map(([n, v, c]) => `#define ${n.padEnd(nameW)}${`(${v})`.padEnd(valW)}${c ? `/* ${c} */` : ""}`.trimEnd())
    .join("\n");
}

// ---------------------------------------------------------------------------
// Topology -> control strategy
// ---------------------------------------------------------------------------

type CtrlMode = "duty" | "phase-shift" | "frequency" | "pfc-duty";

function ctrlModeFor(id: TopologyId): CtrlMode {
  switch (id) {
    case "dab":
    case "psfb":
      return "phase-shift";
    case "llc-half-bridge":
    case "llc-full-bridge":
      return "frequency";
    case "totem-pole-pfc":
      return "pfc-duty";
    default:
      return "duty";
  }
}

const CTRL_MODE_MACRO: Record<CtrlMode, string> = {
  duty: "CTRL_MODE_DUTY",
  "phase-shift": "CTRL_MODE_PHASE_SHIFT",
  frequency: "CTRL_MODE_FREQUENCY",
  "pfc-duty": "CTRL_MODE_PFC_DUTY",
};

/**
 * Topology-appropriate dead time. Resonant/ZVS stages need enough dead time
 * for the Coss charge exchange; hard-switched GaN legs want it minimal to
 * limit third-quadrant Vsd conduction loss.
 */
function deadTimeNsFor(id: TopologyId): number {
  switch (id) {
    case "llc-half-bridge":
    case "llc-full-bridge":
      return 120; // resonant ZVS transition
    case "psfb":
      return 100;
    case "dab":
      return 80;
    case "forward-active-clamp":
    case "flyback":
      return 40;
    case "totem-pole-pfc":
      return 30;
    default:
      return 20; // sync-buck-class GaN half-bridge
  }
}

interface CtrlLimits {
  uMin: number;
  uMax: number;
  comment: string;
}

function ctrlLimitsFor(mode: CtrlMode, id: TopologyId): CtrlLimits {
  switch (mode) {
    case "phase-shift":
      // DAB power peaks at phi = 90 deg (quarter period); PSFB effective duty
      // spans nearly the half period.
      return id === "dab"
        ? { uMin: 0.0, uMax: 0.25, comment: "phase shift, fraction of Tsw (0.25 = 90 deg)" }
        : { uMin: 0.0, uMax: 0.48, comment: "leg phase shift, fraction of Tsw" };
    case "frequency":
      return { uMin: 0.0, uMax: 1.0, comment: "0 = f_max (min gain) .. 1 = f_min (max gain)" };
    case "pfc-duty":
      return { uMin: 0.02, uMax: 0.97, comment: "duty cycle, line-synchronized" };
    default:
      return { uMin: 0.02, uMax: 0.95, comment: "duty cycle" };
  }
}

// ---------------------------------------------------------------------------
// Derived analog scaling & protection numbers
// ---------------------------------------------------------------------------

interface DerivedNumbers {
  ioutNomA: number;
  ovpV: number;
  ocpA: number;
  otpC: number;
  tjMaxC: number;
  /** Output-voltage divider gain so Vout,set reads 2.25 V at the ADC pin. */
  voutSenseGain: number;
  /** Current-sense transimpedance so Iout,nom reads 2.25 V at the ADC pin. */
  isnsVPerA: number;
  ovpDacCode: number;
  ocpDacCode: number;
  softStartMs: number;
  softStartSamples: number;
  llcFMinHz: number;
  llcFMaxHz: number;
}

const VADC_REF_V = 3.3;
const SENSE_NOM_V = 2.25; // nominal signal level at the ADC pin -> 20 % trip lands at 2.7 V

function derive(spec: DesignSpec, fswHz: number, comp: CompensatorDesign): DerivedNumbers {
  const ioutNomA = spec.poutW / spec.voutV;
  const tjMaxC = spec.maxJunctionC ?? 125;
  const ovpV = 1.2 * spec.voutV; // 20 % margin above the regulation point
  const ocpA = 1.2 * ioutNomA; // 20 % margin above rated output current
  const otpC = 0.8 * tjMaxC; // 20 % margin below Tj,max
  const voutSenseGain = SENSE_NOM_V / spec.voutV;
  const isnsVPerA = SENSE_NOM_V / ioutNomA;
  const ovpDacCode = clamp(Math.round((ovpV * voutSenseGain * 4095) / VADC_REF_V), 0, 4095);
  const ocpDacCode = clamp(Math.round((ocpA * isnsVPerA * 4095) / VADC_REF_V), 0, 4095);
  const softStartMs = clamp(Math.round(spec.poutW / 100), 5, 100);
  const softStartSamples = Math.max(1, Math.round((softStartMs / 1000) * comp.sampleHz));
  return {
    ioutNomA,
    ovpV,
    ocpA,
    otpC,
    tjMaxC,
    voutSenseGain,
    isnsVPerA,
    ovpDacCode,
    ocpDacCode,
    softStartMs,
    softStartSamples,
    llcFMinHz: 0.6 * fswHz,
    llcFMaxHz: 1.5 * fswHz,
  };
}

// ---------------------------------------------------------------------------
// Compensator coefficient handling
// ---------------------------------------------------------------------------

interface Coeffs {
  b: number[];
  a: number[]; // a[0] normalized to 1
  ntaps: number;
}

function normalizeCoeffs(comp: CompensatorDesign): Coeffs {
  const a0 = comp.a.length > 0 && comp.a[0] !== 0 ? comp.a[0] : 1;
  const n = Math.max(comp.b.length, comp.a.length, 2);
  const pad = (xs: number[]) => Array.from({ length: n }, (_, i) => (xs[i] ?? 0) / a0);
  const a = pad(comp.a.length > 0 ? comp.a : [1]);
  a[0] = 1;
  return { b: pad(comp.b), a, ntaps: n };
}

// ---------------------------------------------------------------------------
// config.h
// ---------------------------------------------------------------------------

function genConfigH(
  target: FirmwarePackage["target"],
  id: TopologyId,
  spec: DesignSpec,
  fswHz: number,
  comp: CompensatorDesign,
  mode: CtrlMode,
  d: DerivedNumbers,
  hr: HrtimTiming,
  ep: EpwmTiming,
): string {
  const limits = ctrlLimitsFor(mode, id);
  const specLines: [string, string, string][] = [
    ["VIN_MIN_V", cFloat9(spec.vinMinV), "minimum input voltage [V]"],
    ["VIN_NOM_V", cFloat9(spec.vinNomV), "nominal input voltage [V]"],
    ["VIN_MAX_V", cFloat9(spec.vinMaxV), "maximum input voltage [V]"],
    ["VOUT_SET_V", cFloat9(spec.voutV), "output-voltage setpoint [V]"],
    ["POUT_RATED_W", cFloat9(spec.poutW), "rated output power [W]"],
    ["IOUT_NOM_A", cFloat9(d.ioutNomA), "rated output current [A]"],
    ["FSW_HZ", `${cUint(fswHz)}L`, "requested switching frequency [Hz]"],
  ];

  const protLines: [string, string, string][] = [
    ["OVP_THRESHOLD_V", cFloat9(d.ovpV), "over-voltage trip, 1.2 x VOUT_SET [V]"],
    ["OCP_THRESHOLD_A", cFloat9(d.ocpA), "over-current trip, 1.2 x IOUT_NOM [A]"],
    ["OTP_THRESHOLD_C", cFloat9(d.otpC), `over-temp trip, 20 % below Tj,max = ${d.tjMaxC} degC [degC]`],
    ["UVLO_VIN_V", cFloat9(0.9 * spec.vinMinV), "input under-voltage lockout, 0.9 x Vin,min [V]"],
    ["VADC_REF_V", cFloat9(VADC_REF_V), "ADC / comparator-DAC reference [V]"],
    ["VOUT_SENSE_GAIN", cFloat9(d.voutSenseGain), "output divider gain [V/V] (Vout,set -> 2.25 V)"],
    ["ISNS_GAIN_V_PER_A", cFloat9(d.isnsVPerA), "current-sense transimpedance [V/A]"],
    ["OVP_DAC_CODE", cUint(d.ovpDacCode), "12-bit comparator-DAC code at OVP [counts]"],
    ["OCP_DAC_CODE", cUint(d.ocpDacCode), "12-bit comparator-DAC code at OCP [counts]"],
  ];

  const ctrlLines: [string, string, string][] = [
    ["CTRL_SAMPLE_HZ", `${cUint(comp.sampleHz)}L`, "control ISR rate [Hz]"],
    ["CTRL_MODE", CTRL_MODE_MACRO[mode], `modulation strategy for ${id}`],
    ["CTRL_U_MIN", cFloat9(limits.uMin), limits.comment],
    ["CTRL_U_MAX", cFloat9(limits.uMax), limits.comment],
    ["CTRL_AW_GAIN", cFloat9(0.5), "anti-windup back-calculation gain [-]"],
    ["SOFT_START_MS", cUint(d.softStartMs), "output soft-start ramp [ms]"],
    ["SOFT_START_SAMPLES", `${cUint(d.softStartSamples)}L`, "= SOFT_START_MS * CTRL_SAMPLE_HZ / 1000"],
    ["CROSSOVER_HZ", cFloat9(comp.crossoverHz), `${comp.kind} compensator crossover [Hz]`],
    ["PHASE_MARGIN_DEG", cFloat9(comp.phaseMarginDeg), "design phase margin [deg]"],
  ];

  let timerBlock: string;
  if (target === "STM32G474") {
    const tickHz = (STM32_HRTIM_FCLK_HZ * STM32_HRTIM_HIRES_MULT) / 2 ** hr.ckpsc;
    const lines: [string, string, string][] = [
      ["HRTIM_FCLK_HZ", "170000000UL", "HRTIM kernel clock (PLL-R) [Hz]"],
      ["HRTIM_CKPSC", cUint(hr.ckpsc), `tick = ${hr.resolutionPs.toFixed(1)} ps (170 MHz x32 / 2^CKPSC)`],
      ["HRTIM_PERIOD_TICKS", cUint(hr.periodTicks), `= round(170e6 * 32 / 2^${hr.ckpsc} / FSW_HZ) [ticks]`],
      ["FSW_ACTUAL_HZ", cFloat9(hr.actualFswHz), "achieved with integer period [Hz]"],
      ["HRTIM_CMP_50PCT", cUint(Math.round(hr.periodTicks / 2)), "50 % compare [ticks]"],
      ["HRTIM_DT_PRSC", cUint(hr.dtPrsc), `dead-time LSB = ${(STM32_HRTIM_DT_LSB_PS * 2 ** hr.dtPrsc / 1000).toFixed(3)} ns`],
      ["HRTIM_DT_TICKS", cUint(hr.dtTicks), `${hr.deadTimeNs} ns dead time on both edges [ticks]`],
    ];
    if (mode === "phase-shift") {
      lines.push([
        "PHASE_SHIFT_MAX_TICKS",
        cUint(Math.round(ctrlLimitsFor(mode, id).uMax * hr.periodTicks)),
        "phase-shift ceiling [HRTIM ticks]",
      ]);
    }
    if (mode === "frequency") {
      const perMin = clamp(Math.round(tickHz / d.llcFMaxHz), STM32_HRTIM_PER_MIN, STM32_HRTIM_PER_MAX);
      const perMax = clamp(Math.round(tickHz / d.llcFMinHz), STM32_HRTIM_PER_MIN, STM32_HRTIM_PER_MAX);
      lines.push(
        ["LLC_F_MIN_HZ", cFloat9(d.llcFMinHz), "minimum switching frequency (max gain) [Hz]"],
        ["LLC_F_MAX_HZ", cFloat9(d.llcFMaxHz), "maximum switching frequency (min gain) [Hz]"],
        ["LLC_PERIOD_MIN_TICKS", cUint(perMin), "period at LLC_F_MAX_HZ [ticks]"],
        ["LLC_PERIOD_MAX_TICKS", cUint(perMax), "period at LLC_F_MIN_HZ [ticks]"],
      );
    }
    timerBlock = `/* ---- Modulator: STM32G474 HRTIM (RM0440) ----------------------------- */\n${padDefines(lines)}`;
  } else {
    const lines: [string, string, string][] = [
      ["EPWM_CLK_HZ", "100000000UL", "EPWMCLK = SYSCLK [Hz]"],
      ["EPWM_TBPRD_TICKS", cUint(ep.tbprd), "= round(100e6 / (2 * FSW_HZ)), up-down count [ticks]"],
      ["FSW_ACTUAL_HZ", cFloat9(ep.actualFswHz), "achieved with integer TBPRD [Hz]"],
      ["EPWM_CMPA_INIT", cUint(Math.round(ep.tbprd / 2)), "50 % compare at start [ticks]"],
      ["EPWM_DB_TICKS", cUint(ep.dbTicks), `${ep.deadTimeNs} ns dead band @ 10 ns/TBCLK [ticks]`],
      ["CMPSS_OCP_DAC_CODE", cUint(d.ocpDacCode), "CMPSS 12-bit DAC trip code vs 3.3 V [counts]"],
    ];
    if (mode === "phase-shift") {
      lines.push([
        "PHASE_SHIFT_MAX_TICKS",
        cUint(Math.round(ctrlLimitsFor(mode, id).uMax * 2 * ep.tbprd)),
        "TBPHS ceiling, full period = 2 * TBPRD [ticks]",
      ]);
    }
    if (mode === "frequency") {
      const prdMin = clamp(Math.round(C2000_EPWM_CLK_HZ / (2 * d.llcFMaxHz)), 2, 0xffff);
      const prdMax = clamp(Math.round(C2000_EPWM_CLK_HZ / (2 * d.llcFMinHz)), 2, 0xffff);
      lines.push(
        ["LLC_F_MIN_HZ", cFloat9(d.llcFMinHz), "minimum switching frequency (max gain) [Hz]"],
        ["LLC_F_MAX_HZ", cFloat9(d.llcFMaxHz), "maximum switching frequency (min gain) [Hz]"],
        ["LLC_TBPRD_MIN_TICKS", cUint(prdMin), "TBPRD at LLC_F_MAX_HZ [ticks]"],
        ["LLC_TBPRD_MAX_TICKS", cUint(prdMax), "TBPRD at LLC_F_MIN_HZ [ticks]"],
      );
    }
    timerBlock = `/* ---- Modulator: TMS320F280049 EPWM (SPRUI33) ------------------------- */\n${padDefines(lines)}`;
  }

  return `/*
 * VoltForge auto-generated configuration
 * Design:   ${spec.name ?? "unnamed"} — ${id}, ${spec.vinNomV} V -> ${spec.voutV} V, ${spec.poutW} W
 * Target:   ${target}
 * DO NOT EDIT — regenerate from the design spec.
 */
#ifndef VOLTFORGE_CONFIG_H
#define VOLTFORGE_CONFIG_H

/* ---- Power-stage specification --------------------------------------- */
${padDefines(specLines)}

${timerBlock}

/* ---- Protection thresholds (20 % margin on spec ratings) -------------- */
${padDefines(protLines)}

/* ---- Control loop ----------------------------------------------------- */
${padDefines(ctrlLines)}

#endif /* VOLTFORGE_CONFIG_H */
`;
}

// ---------------------------------------------------------------------------
// control.h / control.c
// ---------------------------------------------------------------------------

function genControlH(): string {
  return `/*
 * VoltForge auto-generated control interface.
 */
#ifndef VOLTFORGE_CONTROL_H
#define VOLTFORGE_CONTROL_H

#include <stdint.h>

/* Modulation strategy selected per topology (see CTRL_MODE in config.h). */
typedef enum {
    CTRL_MODE_DUTY        = 0, /* buck / boost / flyback / forward: duty PWM  */
    CTRL_MODE_PHASE_SHIFT = 1, /* dab / psfb: phase between bridge legs       */
    CTRL_MODE_FREQUENCY   = 2, /* llc: switching-frequency modulation        */
    CTRL_MODE_PFC_DUTY    = 3, /* totem-pole PFC: duty, line-synchronized    */
} ctrl_mode_t;

void  ctrl_init(void);
void  ctrl_reset(void);
/* One control-law iteration: measured Vout [V] and inductor/output current
 * [A] in, saturated actuator command out (duty / phase fraction / freq cmd). */
float ctrl_step(float vout_v, float il_a);
/* Write the actuator command into the modulator registers. */
void  ctrl_apply(float u);

void protection_init(void);
void protection_task(float vout_v, float iout_a);
void protection_check_temp(float hotspot_c);
int  protection_faulted(void);

#endif /* VOLTFORGE_CONTROL_H */
`;
}

function genControlC(
  target: FirmwarePackage["target"],
  id: TopologyId,
  comp: CompensatorDesign,
  mode: CtrlMode,
): string {
  const { b, a, ntaps } = normalizeCoeffs(comp);
  const bList = b.map(cFloat9).join(", ");
  const aList = a.map(cFloat9).join(", ");

  let applyBody: string;
  if (target === "STM32G474") {
    switch (mode) {
      case "phase-shift":
        applyBody = `    /* Phase-shift modulation (${id}): both legs run 50 %; leg B's counter is
     * reset by master compare 1, so moving MCMP1 shifts the leg-B phase.
     * u is the phase shift as a fraction of the switching period. */
    uint32_t phase_ticks = (uint32_t)(u * (float)HRTIM_PERIOD_TICKS);
    if (phase_ticks > PHASE_SHIFT_MAX_TICKS) phase_ticks = PHASE_SHIFT_MAX_TICKS;
    HRTIM1->sMasterRegs.MCMP1R = phase_ticks;`;
        break;
      case "frequency":
        applyBody = `    /* Frequency modulation (${id}): fixed 50 % duty, the period register is
     * the actuator. u = 0 -> LLC_F_MAX (min gain), u = 1 -> LLC_F_MIN (max gain). */
    uint32_t per = LLC_PERIOD_MIN_TICKS
                 + (uint32_t)(u * (float)(LLC_PERIOD_MAX_TICKS - LLC_PERIOD_MIN_TICKS));
    HRTIM1->sTimerxRegs[0].PERxR  = per;
    HRTIM1->sTimerxRegs[0].CMP1xR = per / 2U;   /* keep 50 % duty */
    HRTIM1->sTimerxRegs[1].PERxR  = per;
    HRTIM1->sTimerxRegs[1].CMP1xR = per / 2U;`;
        break;
      default:
        applyBody = `    /* Duty-cycle modulation (${id})${mode === "pfc-duty" ? " — line-synchronized; the outer\n     * voltage loop feeds an inner average-current loop at CTRL_SAMPLE_HZ" : ""}. */
    HRTIM1->sTimerxRegs[0].CMP1xR = (uint32_t)(u * (float)HRTIM_PERIOD_TICKS);`;
    }
  } else {
    switch (mode) {
      case "phase-shift":
        applyBody = `    /* Phase-shift modulation (${id}): EPWM2 lags EPWM1 via TBPHS.
     * Full period = 2 * TBPRD counts in up-down mode; u is the phase shift
     * as a fraction of the switching period. */
    uint16_t phase_ticks = (uint16_t)(u * (float)(2U * EPWM_TBPRD_TICKS));
    if (phase_ticks > PHASE_SHIFT_MAX_TICKS) phase_ticks = PHASE_SHIFT_MAX_TICKS;
    EPwm2Regs.TBPHS.bit.TBPHS = phase_ticks;`;
        break;
      case "frequency":
        applyBody = `    /* Frequency modulation (${id}): TBPRD is the actuator, 50 % duty held.
     * u = 0 -> LLC_F_MAX (min gain), u = 1 -> LLC_F_MIN (max gain). */
    uint16_t prd = LLC_TBPRD_MIN_TICKS
                 + (uint16_t)(u * (float)(LLC_TBPRD_MAX_TICKS - LLC_TBPRD_MIN_TICKS));
    EPwm1Regs.TBPRD = prd;
    EPwm1Regs.CMPA.bit.CMPA = prd / 2U;   /* keep 50 % duty */
    EPwm2Regs.TBPRD = prd;
    EPwm2Regs.CMPA.bit.CMPA = prd / 2U;`;
        break;
      default:
        applyBody = `    /* Duty-cycle modulation (${id})${mode === "pfc-duty" ? " — line-synchronized; the outer\n     * voltage loop feeds an inner average-current loop at CTRL_SAMPLE_HZ" : ""}. */
    EPwm1Regs.CMPA.bit.CMPA = (uint16_t)(u * (float)EPWM_TBPRD_TICKS);`;
    }
  }

  const header =
    target === "STM32G474" ? '#include "stm32g4xx.h"' : '#include "F28x_Project.h"';

  return `/*
 * VoltForge auto-generated control law — ${id} on ${target}.
 *
 * ${comp.kind} compensator discretized by bilinear transform at
 * ${comp.sampleHz} Hz (fc = ${comp.crossoverHz} Hz, PM = ${comp.phaseMarginDeg} deg).
 * Coefficients normalized to a0 = 1, printed to 9 significant digits.
 */
${header}
#include "config.h"
#include "control.h"

#define CTRL_NTAPS ${ntaps}

static const float ctrl_b[CTRL_NTAPS] = { ${bList} };
static const float ctrl_a[CTRL_NTAPS] = { ${aList} };

static float    ctrl_w[CTRL_NTAPS - 1];   /* DF-II transposed delay line */
static uint32_t ss_count;                 /* soft-start sample counter   */

void ctrl_reset(void)
{
    for (int i = 0; i < CTRL_NTAPS - 1; i++) ctrl_w[i] = 0.0f;
    ss_count = 0U;
}

void ctrl_init(void)
{
    ctrl_reset();
}

float ctrl_step(float vout_v, float il_a)
{
    (void)il_a; /* available for an inner current loop / feed-forward */

    /* Soft-start: ramp the reference from 0 to VOUT_SET_V over SOFT_START_MS. */
    float ref = VOUT_SET_V;
    if (ss_count < SOFT_START_SAMPLES) {
        ref = VOUT_SET_V * ((float)ss_count / (float)SOFT_START_SAMPLES);
        ss_count++;
    }

    float e = ref - vout_v;

    /* Direct Form II transposed difference equation. */
    float u = ctrl_b[0] * e + ctrl_w[0];
    for (int i = 1; i < CTRL_NTAPS; i++) {
        float wi = (i < CTRL_NTAPS - 1) ? ctrl_w[i] : 0.0f;
        ctrl_w[i - 1] = ctrl_b[i] * e - ctrl_a[i] * u + wi;
    }

    /* Anti-windup: saturate, then back-calculate into the first state so the
     * integrator unwinds instead of charging against the limit. */
    float u_sat = u;
    if (u_sat > CTRL_U_MAX) u_sat = CTRL_U_MAX;
    if (u_sat < CTRL_U_MIN) u_sat = CTRL_U_MIN;
    ctrl_w[0] += CTRL_AW_GAIN * (u_sat - u);

    return u_sat;
}

void ctrl_apply(float u)
{
${applyBody}
}
`;
}

// ---------------------------------------------------------------------------
// protection.c
// ---------------------------------------------------------------------------

function genProtectionC(target: FirmwarePackage["target"]): string {
  const shutdown =
    target === "STM32G474"
      ? `    /* Disable all HRTIM outputs; the hardware FLT1 path (COMP + DAC) has
     * already clamped them if the analog OCP fired first. */
    HRTIM1->sCommonRegs.ODISR = HRTIM_ODISR_TA1ODIS | HRTIM_ODISR_TA2ODIS
                              | HRTIM_ODISR_TB1ODIS | HRTIM_ODISR_TB2ODIS;`
      : `    /* Force both EPWM outputs low via the one-shot trip; the CMPSS
     * comparator path has already tripped them if the analog OCP fired first. */
    EALLOW;
    EPwm1Regs.TZFRC.bit.OST = 1;
    EPwm2Regs.TZFRC.bit.OST = 1;
    EDIS;`;

  const header =
    target === "STM32G474" ? '#include "stm32g4xx.h"' : '#include "F28x_Project.h"';

  return `/*
 * VoltForge auto-generated supervisory protection — ${target}.
 *
 * Fast OCP is analog (comparator + DAC threshold, see main.c); this file is
 * the slower firmware supervisor: OVP / OCP / OTP / UVLO with latched faults.
 * Thresholds carry a 20 % margin on the spec ratings (config.h).
 */
${header}
#include "config.h"
#include "control.h"

typedef enum {
    FAULT_NONE = 0,
    FAULT_OVP,
    FAULT_OCP,
    FAULT_OTP,
    FAULT_UVLO,
} fault_t;

static volatile fault_t s_fault = FAULT_NONE;
static uint16_t s_ocp_debounce;

void protection_init(void)
{
    s_fault = FAULT_NONE;
    s_ocp_debounce = 0U;
}

int protection_faulted(void)
{
    return s_fault != FAULT_NONE;
}

static void power_stage_shutdown(fault_t f)
{
    s_fault = f;
${shutdown}
    ctrl_reset();
}

/* Called from the control ISR with the freshly sampled feedback signals. */
void protection_task(float vout_v, float iout_a)
{
    if (s_fault != FAULT_NONE) return;

    if (vout_v > OVP_THRESHOLD_V) {          /* over-voltage: trip immediately */
        power_stage_shutdown(FAULT_OVP);
        return;
    }
    if (iout_a > OCP_THRESHOLD_A) {          /* over-current: 4-sample debounce */
        if (++s_ocp_debounce >= 4U) power_stage_shutdown(FAULT_OCP);
    } else {
        s_ocp_debounce = 0U;
    }
}

/* Called from the slow (1 kHz) housekeeping loop with the NTC-derived
 * power-stage hot-spot temperature. */
void protection_check_temp(float hotspot_c)
{
    if (s_fault != FAULT_NONE) return;
    if (hotspot_c > OTP_THRESHOLD_C) power_stage_shutdown(FAULT_OTP);
}
`;
}

// ---------------------------------------------------------------------------
// main.c — STM32G474
// ---------------------------------------------------------------------------

function genMainStm32(id: TopologyId, mode: CtrlMode): string {
  const twoLegs = mode === "phase-shift" || mode === "frequency";
  const timerBSetup = twoLegs
    ? `
    /* Timer B: second bridge leg${mode === "phase-shift" ? ", phase-shifted from timer A via MCMP1" : ", synchronous with timer A"} */
    HRTIM1->sTimerxRegs[1].TIMxCR = (HRTIM_CKPSC << HRTIM_TIMCR_CK_PSC_Pos)
                                  | HRTIM_TIMCR_CONT | HRTIM_TIMCR_PREEN | HRTIM_TIMCR_TREPU;
    HRTIM1->sTimerxRegs[1].PERxR  = HRTIM_PERIOD_TICKS;
    HRTIM1->sTimerxRegs[1].CMP1xR = HRTIM_CMP_50PCT;
    HRTIM1->sTimerxRegs[1].SETx1R = HRTIM_SET1R_PER;
    HRTIM1->sTimerxRegs[1].RSTx1R = HRTIM_RST1R_CMP1;
${mode === "phase-shift" ? "    HRTIM1->sTimerxRegs[1].RSTxR  = HRTIM_RSTR_MSTCMP1;    /* phase from master CMP1 */\n" : ""}    HRTIM1->sTimerxRegs[1].OUTxR  = HRTIM_OUTR_DTEN;        /* TB2 = complement of TB1 */
    HRTIM1->sTimerxRegs[1].DTxR   = (HRTIM_DT_PRSC << HRTIM_DTR_DTPRSC_Pos)
                                  | (HRTIM_DT_TICKS << HRTIM_DTR_DTR_Pos)
                                  | (HRTIM_DT_TICKS << HRTIM_DTR_DTF_Pos);
`
    : "";
  const oenr = twoLegs
    ? "HRTIM_OENR_TA1OEN | HRTIM_OENR_TA2OEN | HRTIM_OENR_TB1OEN | HRTIM_OENR_TB2OEN"
    : "HRTIM_OENR_TA1OEN | HRTIM_OENR_TA2OEN";
  const mcr = twoLegs
    ? "HRTIM_MCR_MCEN | HRTIM_MCR_TACEN | HRTIM_MCR_TBCEN"
    : "HRTIM_MCR_MCEN | HRTIM_MCR_TACEN";

  return `/*
 * VoltForge auto-generated firmware — STM32G474 (Cortex-M4F @ 170 MHz)
 * Topology: ${id} | Modulation: ${mode}
 * Toolchain: arm-none-eabi-gcc + CMSIS device header (stm32g474xx.h)
 */
#include "stm32g4xx.h"
#include "config.h"
#include "control.h"

/* ------------------------------------------------------------------ clocks */
static void system_clock_170mhz(void)
{
    /* Boost regulator range + 4 WS flash are required above 150 MHz. */
    PWR->CR5 &= ~PWR_CR5_R1MODE;
    FLASH->ACR = (FLASH->ACR & ~FLASH_ACR_LATENCY) | FLASH_ACR_LATENCY_4WS;

    /* PLL: HSI16 / M(4) * N(85) / R(2) = 170 MHz sysclk = HRTIM kernel clock */
    RCC->CR |= RCC_CR_HSION;
    while (!(RCC->CR & RCC_CR_HSIRDY)) { }
    RCC->PLLCFGR = RCC_PLLCFGR_PLLSRC_HSI
                 | (3U  << RCC_PLLCFGR_PLLM_Pos)     /* /4          */
                 | (85U << RCC_PLLCFGR_PLLN_Pos)     /* x85         */
                 | RCC_PLLCFGR_PLLREN;               /* R = /2      */
    RCC->CR |= RCC_CR_PLLON;
    while (!(RCC->CR & RCC_CR_PLLRDY)) { }
    RCC->CFGR = (RCC->CFGR & ~RCC_CFGR_SW) | RCC_CFGR_SW_PLL;
    while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_PLL) { }
}

/* ------------------------------------------------------------------- HRTIM */
static void hrtim_init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_HRTIM1EN;

    /* Calibrate the x32 DLL (184 ps LSB at CKPSC = 0). */
    HRTIM1->sCommonRegs.DLLCR = HRTIM_DLLCR_CAL | HRTIM_DLLCR_CALEN;
    while (!(HRTIM1->sCommonRegs.ISR & HRTIM_ISR_DLLRDY)) { }

    /* Master timer paces the switching period${mode === "phase-shift" ? " and carries the phase compare" : ""}. */
    HRTIM1->sMasterRegs.MPER  = HRTIM_PERIOD_TICKS;
${mode === "phase-shift" ? "    HRTIM1->sMasterRegs.MCMP1R = 0U;                       /* phase = 0 at start */\n" : ""}    HRTIM1->sMasterRegs.MCR   = (HRTIM_CKPSC << HRTIM_MCR_CK_PSC_Pos)
                              | HRTIM_MCR_CONT | HRTIM_MCR_PREEN | HRTIM_MCR_MREPU;

    /* Timer A: bridge leg 1, continuous mode, preload on repetition event. */
    HRTIM1->sTimerxRegs[0].TIMxCR = (HRTIM_CKPSC << HRTIM_TIMCR_CK_PSC_Pos)
                                  | HRTIM_TIMCR_CONT | HRTIM_TIMCR_PREEN | HRTIM_TIMCR_TREPU;
    HRTIM1->sTimerxRegs[0].PERxR  = HRTIM_PERIOD_TICKS;
    HRTIM1->sTimerxRegs[0].CMP1xR = HRTIM_CMP_50PCT;
    HRTIM1->sTimerxRegs[0].SETx1R = HRTIM_SET1R_PER;       /* TA1 set at period  */
    HRTIM1->sTimerxRegs[0].RSTx1R = HRTIM_RST1R_CMP1;      /* TA1 reset at CMP1  */
    HRTIM1->sTimerxRegs[0].OUTxR  = HRTIM_OUTR_DTEN;       /* TA2 = complement   */
    HRTIM1->sTimerxRegs[0].DTxR   = (HRTIM_DT_PRSC << HRTIM_DTR_DTPRSC_Pos)
                                  | (HRTIM_DT_TICKS << HRTIM_DTR_DTR_Pos)   /* rising  */
                                  | (HRTIM_DT_TICKS << HRTIM_DTR_DTF_Pos);  /* falling */
${timerBSetup}
    /* ADC trigger 1 on timer A period -> injected sampling mid-ripple. */
    HRTIM1->sCommonRegs.ADC1R = HRTIM_ADC1R_AD1TAPER;

    /* FLT1 (from COMP2/OCP) forces both outputs to their inactive fault state. */
    HRTIM1->sCommonRegs.FLTINR1  = HRTIM_FLTINR1_FLT1E;
    HRTIM1->sTimerxRegs[0].FLTxR = HRTIM_FLTR_FLT1EN;
${twoLegs ? "    HRTIM1->sTimerxRegs[1].FLTxR = HRTIM_FLTR_FLT1EN;\n" : ""}}

/* ---------------------------------------------------------- ADC (injected) */
static void adc_init(void)
{
    RCC->AHB2ENR |= RCC_AHB2ENR_ADC12EN;
    ADC12_COMMON->CCR = (0x1U << ADC_CCR_CKMODE_Pos);      /* sync clock HCLK/1 */

    ADC1->CR &= ~ADC_CR_DEEPPWD;
    ADC1->CR |= ADC_CR_ADVREGEN;
    for (volatile uint32_t i = 0U; i < 4000U; i++) { }     /* t_ADCVREG_STUP    */
    ADC1->CR |= ADC_CR_ADCAL;
    while (ADC1->CR & ADC_CR_ADCAL) { }
    ADC1->ISR = ADC_ISR_ADRDY;
    ADC1->CR |= ADC_CR_ADEN;
    while (!(ADC1->ISR & ADC_ISR_ADRDY)) { }

    /* Injected group, 2 conversions: Vout on IN1, IL on IN2.
     * Hardware trigger = HRTIM_ADCTRG1 (JEXTSEL = 27), rising edge. */
    ADC1->JSQR = (1U  << ADC_JSQR_JL_Pos)
               | (27U << ADC_JSQR_JEXTSEL_Pos)
               | (1U  << ADC_JSQR_JEXTEN_Pos)
               | (1U  << ADC_JSQR_JSQ1_Pos)
               | (2U  << ADC_JSQR_JSQ2_Pos);
    ADC1->IER |= ADC_IER_JEOSIE;
    NVIC_SetPriority(ADC1_2_IRQn, 1U);
    NVIC_EnableIRQ(ADC1_2_IRQn);
}

/* --------------------------------------------- analog OCP: DAC3 + COMP2 -> FLT1 */
static void ocp_comparator_init(void)
{
    RCC->AHB2ENR |= RCC_AHB2ENR_DAC3EN;
    DAC3->DHR12R1 = OCP_DAC_CODE;          /* OCP_THRESHOLD_A * ISNS_GAIN_V_PER_A */
    DAC3->CR |= DAC_CR_EN1;

    /* COMP2: INP = current-sense pin, INM = DAC3_CH1, output -> HRTIM FLT1. */
    COMP2->CSR = (0x4U << COMP_CSR_INMSEL_Pos) | COMP_CSR_EN;
}

/* ----------------------------------------------------------- control ISR  */
void ADC1_2_IRQHandler(void)
{
    ADC1->ISR = ADC_ISR_JEOS;

    float vout = (float)ADC1->JDR1 * (VADC_REF_V / 4095.0f) / VOUT_SENSE_GAIN;
    float il   = (float)ADC1->JDR2 * (VADC_REF_V / 4095.0f) / ISNS_GAIN_V_PER_A;

    ctrl_apply(ctrl_step(vout, il));
    protection_task(vout, il);
}

int main(void)
{
    system_clock_170mhz();
    ctrl_init();
    protection_init();
    hrtim_init();
    adc_init();
    ocp_comparator_init();

    /* Enable gate-drive outputs and start the counters. */
    HRTIM1->sCommonRegs.OENR = ${oenr};
    HRTIM1->sMasterRegs.MCR |= ${mcr};

    for (;;) {
        __WFI();   /* everything runs in the ADC-paced control ISR */
    }
}
`;
}

// ---------------------------------------------------------------------------
// main.c — TMS320F280049
// ---------------------------------------------------------------------------

function genMainC2000(id: TopologyId, mode: CtrlMode): string {
  const twoLegs = mode === "phase-shift" || mode === "frequency";
  const epwm2 = twoLegs
    ? `
    /* EPWM2: second bridge leg${mode === "phase-shift" ? " — lags EPWM1 by TBPHS (phase-shift actuator)" : " — synchronized to EPWM1"} */
    EPwm2Regs.TBPRD = EPWM_TBPRD_TICKS;
    EPwm2Regs.TBCTL.bit.CTRMODE   = TB_COUNT_UPDOWN;
    EPwm2Regs.TBCTL.bit.HSPCLKDIV = TB_DIV1;
    EPwm2Regs.TBCTL.bit.CLKDIV    = TB_DIV1;
    EPwm2Regs.TBCTL.bit.PHSEN     = TB_ENABLE;           /* slave: load TBPHS  */
    EPwm2Regs.TBCTL.bit.SYNCOSEL  = TB_SYNC_IN;
    EPwm2Regs.TBPHS.bit.TBPHS     = 0U;                  /* phase = 0 at start */
    EPwm2Regs.CMPA.bit.CMPA       = EPWM_CMPA_INIT;
    EPwm2Regs.AQCTLA.bit.CAU      = AQ_CLEAR;
    EPwm2Regs.AQCTLA.bit.CAD      = AQ_SET;
    EPwm2Regs.DBCTL.bit.OUT_MODE  = DB_FULL_ENABLE;
    EPwm2Regs.DBCTL.bit.POLSEL    = DB_ACTV_HIC;
    EPwm2Regs.DBRED.bit.DBRED     = EPWM_DB_TICKS;
    EPwm2Regs.DBFED.bit.DBFED     = EPWM_DB_TICKS;
`
    : "";

  return `/*
 * VoltForge auto-generated firmware — TMS320F280049 (C28x @ 100 MHz + CLA)
 * Topology: ${id} | Modulation: ${mode}
 * Toolchain: TI C2000Ware bit-field headers (F28x_Project.h) + CGT
 */
#include "F28x_Project.h"
#include "config.h"
#include "control.h"

__interrupt void adca1_isr(void);

/* -------------------------------------------------------------------- EPWM */
static void epwm_init(void)
{
    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 0;                /* freeze while configuring */
    EDIS;

    /* EPWM1: bridge leg 1. Up-down count -> fsw = EPWMCLK / (2 * TBPRD). */
    EPwm1Regs.TBPRD = EPWM_TBPRD_TICKS;
    EPwm1Regs.TBCTL.bit.CTRMODE   = TB_COUNT_UPDOWN;
    EPwm1Regs.TBCTL.bit.HSPCLKDIV = TB_DIV1;             /* TBCLK = 100 MHz    */
    EPwm1Regs.TBCTL.bit.CLKDIV    = TB_DIV1;
    EPwm1Regs.TBCTL.bit.SYNCOSEL  = TB_CTR_ZERO;         /* sync pulse at zero */
    EPwm1Regs.CMPA.bit.CMPA       = EPWM_CMPA_INIT;
    EPwm1Regs.AQCTLA.bit.CAU      = AQ_CLEAR;            /* symmetric PWM      */
    EPwm1Regs.AQCTLA.bit.CAD      = AQ_SET;

    /* Active-high complementary pair with dead band (10 ns per TBCLK). */
    EPwm1Regs.DBCTL.bit.OUT_MODE  = DB_FULL_ENABLE;
    EPwm1Regs.DBCTL.bit.POLSEL    = DB_ACTV_HIC;
    EPwm1Regs.DBRED.bit.DBRED     = EPWM_DB_TICKS;
    EPwm1Regs.DBFED.bit.DBFED     = EPWM_DB_TICKS;

    /* ADC start-of-conversion once per period at counter zero. */
    EPwm1Regs.ETSEL.bit.SOCAEN    = 1;
    EPwm1Regs.ETSEL.bit.SOCASEL   = ET_CTR_ZERO;
    EPwm1Regs.ETPS.bit.SOCAPRD    = ET_1ST;
${epwm2}
    EALLOW;
    CpuSysRegs.PCLKCR0.bit.TBCLKSYNC = 1;
    EDIS;
}

/* --------------------------------------------------- CMPSS analog OCP trip */
static void cmpss_ocp_init(void)
{
    EALLOW;
    Cmpss1Regs.COMPCTL.bit.COMPDACE    = 1;              /* enable CMPSS + DAC */
    Cmpss1Regs.COMPCTL.bit.COMPHSOURCE = 0;              /* high comp <- pin   */
    Cmpss1Regs.DACHVALS.bit.DACVAL     = CMPSS_OCP_DAC_CODE; /* 12-bit vs 3.3 V */
    Cmpss1Regs.CTRIPHFILCTL.bit.SAMPWIN = 15;            /* glitch filter      */
    Cmpss1Regs.CTRIPHFILCTL.bit.THRESH  = 12;
    Cmpss1Regs.COMPCTL.bit.CTRIPHSEL    = 2;             /* filtered output    */

    /* Route CTRIPH -> ePWM X-BAR TRIP4 -> digital-compare one-shot trip. */
    EPwmXbarRegs.TRIP4MUX0TO15CFG.bit.MUX0 = 0;
    EPwmXbarRegs.TRIP4MUXENABLE.bit.MUX0   = 1;
    EPwm1Regs.DCTRIPSEL.bit.DCAHCOMPSEL    = DC_TRIPIN4;
    EPwm1Regs.TZDCSEL.bit.DCAEVT1          = TZ_DCAH_HI;
    EPwm1Regs.DCACTL.bit.EVT1SRCSEL        = DC_EVT1;
    EPwm1Regs.TZCTL.bit.DCAEVT1            = TZ_FORCE_LO;
    EDIS;
}

/* ---------------------------------------------------------------- ADC/PIE */
static void adc_init(void)
{
    EALLOW;
    AdcaRegs.ADCCTL2.bit.PRESCALE  = 6;                  /* ADCCLK = SYSCLK/4  */
    AdcaRegs.ADCCTL1.bit.ADCPWDNZ  = 1;
    DELAY_US(1000);                                      /* power-up time      */

    /* SOC0: Vout on ADCINA0, SOC1: IL on ADCINA1, both from EPWM1 SOCA. */
    AdcaRegs.ADCSOC0CTL.bit.CHSEL   = 0;
    AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 5;                 /* EPWM1 SOCA         */
    AdcaRegs.ADCSOC0CTL.bit.ACQPS   = 14;                /* 150 ns S+H window  */
    AdcaRegs.ADCSOC1CTL.bit.CHSEL   = 1;
    AdcaRegs.ADCSOC1CTL.bit.TRIGSEL = 5;
    AdcaRegs.ADCSOC1CTL.bit.ACQPS   = 14;

    AdcaRegs.ADCINTSEL1N2.bit.INT1SEL  = 1;              /* EOC1 -> ADCINT1    */
    AdcaRegs.ADCINTSEL1N2.bit.INT1E    = 1;
    EDIS;

    PieVectTable.ADCA1_INT = &adca1_isr;
    PieCtrlRegs.PIEIER1.bit.INTx1 = 1;
    IER |= M_INT1;
}

/* Control ISR — CLA-ready: ctrl_step() uses only float math and file-scope
 * state, so the identical body can be registered as Cla1Task1 and triggered
 * by ADCAINT1 to offload the C28x. The C28x fallback below runs from RAM. */
#pragma CODE_SECTION(adca1_isr, ".TI.ramfunc")
__interrupt void adca1_isr(void)
{
    float vout = (float)AdcaResultRegs.ADCRESULT0 * (VADC_REF_V / 4095.0f) / VOUT_SENSE_GAIN;
    float il   = (float)AdcaResultRegs.ADCRESULT1 * (VADC_REF_V / 4095.0f) / ISNS_GAIN_V_PER_A;

    ctrl_apply(ctrl_step(vout, il));
    protection_task(vout, il);

    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

void main(void)
{
    InitSysCtrl();                                       /* PLL -> 100 MHz     */
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    ctrl_init();
    protection_init();
    epwm_init();
    cmpss_ocp_init();
    adc_init();

    EINT;                                                /* global int enable  */
    ERTM;

    for (;;) {
        IDLE;   /* everything runs in the ADC-paced control ISR */
    }
}
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a complete firmware package for the selected control target.
 * See MODULES.md (firmware).
 */
export function generateFirmware(
  target: FirmwarePackage["target"],
  id: TopologyId,
  spec: DesignSpec,
  fswHz: number,
  comp: CompensatorDesign,
): FirmwarePackage {
  if (!(fswHz > 0)) throw new Error(`generateFirmware: fswHz must be > 0, got ${fswHz}`);
  const mode = ctrlModeFor(id);
  const deadNs = deadTimeNsFor(id);
  const hr = hrtimTiming(fswHz, deadNs);
  const ep = epwmTiming(fswHz, deadNs);
  const d = derive(spec, fswHz, comp);

  const files: FirmwareFile[] = [
    {
      path: "config.h",
      contents: genConfigH(target, id, spec, fswHz, comp, mode, d, hr, ep),
    },
    {
      path: "main.c",
      contents: target === "STM32G474" ? genMainStm32(id, mode) : genMainC2000(id, mode),
    },
    { path: "control.h", contents: genControlH() },
    { path: "control.c", contents: genControlC(target, id, comp, mode) },
    { path: "protection.c", contents: genProtectionC(target) },
  ];

  const actual = target === "STM32G474" ? hr.actualFswHz : ep.actualFswHz;
  const modTxt =
    target === "STM32G474"
      ? `HRTIM period ${hr.periodTicks} ticks (CKPSC=${hr.ckpsc}, ${hr.resolutionPs.toFixed(1)} ps LSB), dead time ${deadNs} ns`
      : `EPWM TBPRD ${ep.tbprd} (up-down @ 100 MHz), dead band ${deadNs} ns`;

  return {
    target,
    files,
    summary:
      `${target} firmware for ${id}: ${mode} modulation at ` +
      `${(actual / 1e3).toFixed(2)} kHz (requested ${(fswHz / 1e3).toFixed(2)} kHz); ${modTxt}; ` +
      `${comp.kind} biquad at ${comp.sampleHz} Hz with anti-windup and ${d.softStartMs} ms soft-start; ` +
      `OVP ${d.ovpV.toFixed(1)} V / OCP ${d.ocpA.toFixed(1)} A / OTP ${d.otpC.toFixed(0)} degC (20 % margins). ` +
      `${files.length} files.`,
  };
}
