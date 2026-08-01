import { describe, expect, it } from "vitest";
import type { CompensatorDesign, DesignSpec } from "@/lib/types";
import {
  C2000_EPWM_CLK_HZ,
  cFloat9,
  epwmTiming,
  generateFirmware,
  hrtimTiming,
  STM32_HRTIM_FCLK_HZ,
  STM32_HRTIM_HIRES_MULT,
} from "./generate";

// Inline fixtures — no data-module imports per module rules.
const spec: DesignSpec = {
  name: "EV charger DCDC stage",
  conversion: "dc-dc",
  vinMinV: 700,
  vinNomV: 800,
  vinMaxV: 900,
  voutV: 48,
  poutW: 3000,
  bidirectional: true,
  isolated: true,
  ambientC: 40,
  maxJunctionC: 125,
  cooling: "forced-air",
};

const comp: CompensatorDesign = {
  kind: "type-2",
  crossoverHz: 5000,
  phaseMarginDeg: 55,
  kp: 0.12,
  ki: 850,
  polesHz: [48000],
  zerosHz: [1200],
  b: [0.0123456789, 0.0234567891, -0.0111111111],
  a: [1, -1.85, 0.85],
  sampleHz: 100000,
  notes: [],
};

const fsw = 250e3;

function file(pkg: ReturnType<typeof generateFirmware>, path: string): string {
  const f = pkg.files.find((x) => x.path === path);
  expect(f, `missing file ${path}`).toBeDefined();
  return f!.contents;
}

describe("hrtimTiming", () => {
  it("computes period = round(170e6*32/fsw) when no prescaler is needed", () => {
    const t = hrtimTiming(250e3, 20);
    expect(t.ckpsc).toBe(0);
    expect(t.periodTicks).toBe(Math.round((STM32_HRTIM_FCLK_HZ * STM32_HRTIM_HIRES_MULT) / 250e3));
    expect(t.periodTicks).toBe(21760);
    expect(t.actualFswHz).toBeCloseTo(250e3, 0);
    expect(t.resolutionPs).toBeCloseTo(183.8, 1);
  });

  it("engages the prescaler below ~83 kHz and stays within the 16-bit period", () => {
    const t = hrtimTiming(50e3, 20);
    expect(t.ckpsc).toBeGreaterThanOrEqual(1);
    expect(t.periodTicks).toBeLessThanOrEqual(0xffdf);
    expect(t.periodTicks).toBeGreaterThanOrEqual(0x0060);
    // achieved frequency within 0.1 % of the request
    expect(Math.abs(t.actualFswHz / 50e3 - 1)).toBeLessThan(1e-3);
  });

  it("period ticks decrease monotonically with fsw", () => {
    const p100 = hrtimTiming(100e3, 20).periodTicks;
    const p250 = hrtimTiming(250e3, 20).periodTicks;
    const p500 = hrtimTiming(500e3, 20).periodTicks;
    const p1000 = hrtimTiming(1000e3, 20).periodTicks;
    expect(p100).toBeGreaterThan(p250);
    expect(p250).toBeGreaterThan(p500);
    expect(p500).toBeGreaterThan(p1000);
  });

  it("dead-time ticks are in the 9-bit register range and scale with the request", () => {
    const t20 = hrtimTiming(500e3, 20);
    const t120 = hrtimTiming(500e3, 120);
    expect(t20.dtTicks).toBeGreaterThanOrEqual(1);
    expect(t20.dtTicks).toBeLessThanOrEqual(511);
    expect(t120.dtTicks).toBeLessThanOrEqual(511);
    // 20 ns / 735.3 ps = 27 ticks
    expect(t20.dtTicks).toBe(27);
    expect(t120.dtTicks * 2 ** t120.dtPrsc).toBeGreaterThan(t20.dtTicks * 2 ** t20.dtPrsc);
  });
});

describe("epwmTiming", () => {
  it("computes TBPRD = round(100e6/(2*fsw)) for up-down count", () => {
    const t = epwmTiming(100e3, 20);
    expect(t.tbprd).toBe(Math.round(C2000_EPWM_CLK_HZ / (2 * 100e3)));
    expect(t.tbprd).toBe(500);
    expect(t.actualFswHz).toBeCloseTo(100e3, 6);
    expect(t.dbTicks).toBe(2); // 20 ns at 10 ns/count
  });

  it("TBPRD decreases with fsw", () => {
    expect(epwmTiming(100e3, 20).tbprd).toBeGreaterThan(epwmTiming(250e3, 20).tbprd);
    expect(epwmTiming(250e3, 20).tbprd).toBeGreaterThan(epwmTiming(500e3, 20).tbprd);
  });
});

describe("cFloat9", () => {
  it("prints 9 significant digits with an f suffix", () => {
    expect(cFloat9(0.0123456789)).toBe("0.0123456789f");
    expect(cFloat9(-1.85)).toBe("-1.85000000f");
    expect(cFloat9(1)).toBe("1.00000000f");
    expect(cFloat9(57.6)).toBe("57.6000000f");
  });
});

describe("generateFirmware — STM32G474", () => {
  const pkg = generateFirmware("STM32G474", "sync-buck", spec, fsw, comp);

  it("produces at least 4 files with the expected names", () => {
    expect(pkg.files.length).toBeGreaterThanOrEqual(4);
    for (const p of ["config.h", "main.c", "control.h", "control.c", "protection.c"]) {
      expect(pkg.files.map((f) => f.path)).toContain(p);
    }
    // unique paths
    expect(new Set(pkg.files.map((f) => f.path)).size).toBe(pkg.files.length);
  });

  it("config.h contains the computed HRTIM period value", () => {
    const cfg = file(pkg, "config.h");
    const expected = Math.round((STM32_HRTIM_FCLK_HZ * STM32_HRTIM_HIRES_MULT) / fsw); // 21760
    expect(cfg).toContain(`HRTIM_PERIOD_TICKS`);
    expect(cfg).toMatch(new RegExp(`HRTIM_PERIOD_TICKS\\s*\\(${expected}U\\)`));
    expect(cfg).toContain(`FSW_HZ`);
    expect(cfg).toContain(`${fsw}UL`);
  });

  it("config.h carries 20 %-margin protection thresholds with units", () => {
    const cfg = file(pkg, "config.h");
    expect(cfg).toContain(cFloat9(1.2 * spec.voutV)); // 57.6000000f
    expect(cfg).toContain(cFloat9(1.2 * (spec.poutW / spec.voutV))); // OCP = 75 A
    expect(cfg).toContain(cFloat9(0.8 * 125)); // OTP = 100 degC
    expect(cfg).toMatch(/\[V\]/);
    expect(cfg).toMatch(/\[A\]/);
    expect(cfg).toMatch(/\[Hz\]/);
  });

  it("control.c embeds the compensator coefficients at 9 significant digits", () => {
    const ctl = file(pkg, "control.c");
    for (const x of comp.b) expect(ctl).toContain(cFloat9(x));
    // a is normalized to a0 = 1
    expect(ctl).toContain(cFloat9(1));
    expect(ctl).toContain(cFloat9(-1.85));
    expect(ctl).toContain(cFloat9(0.85));
  });

  it("control.c has anti-windup and soft-start", () => {
    const ctl = file(pkg, "control.c");
    expect(ctl.toLowerCase()).toContain("anti-windup");
    expect(ctl).toContain("CTRL_AW_GAIN");
    expect(ctl).toContain("SOFT_START_SAMPLES");
  });

  it("main.c sets up 170 MHz clock, HRTIM dead time, injected ADC and fault path", () => {
    const main = file(pkg, "main.c");
    expect(main).toContain("170 MHz");
    expect(main).toContain("HRTIM_DT_TICKS");
    expect(main).toContain("JSQR");
    expect(main).toContain("FLT1");
    expect(main).toContain("DLLCR"); // high-resolution DLL calibration
  });

  it("protection.c checks OVP/OCP/OTP thresholds", () => {
    const prot = file(pkg, "protection.c");
    expect(prot).toContain("OVP_THRESHOLD_V");
    expect(prot).toContain("OCP_THRESHOLD_A");
    expect(prot).toContain("OTP_THRESHOLD_C");
  });

  it("contains no unresolved TODO strings", () => {
    for (const f of pkg.files) expect(f.contents).not.toContain("TODO");
    expect(pkg.summary).not.toContain("TODO");
  });
});

describe("generateFirmware — topology control modes", () => {
  it("dab emits the phase-shift code path on both targets", () => {
    for (const target of ["STM32G474", "TMS320F280049"] as const) {
      const pkg = generateFirmware(target, "dab", spec, fsw, comp);
      const ctl = file(pkg, "control.c");
      const cfg = file(pkg, "config.h");
      expect(ctl).toContain("Phase-shift");
      expect(ctl).toContain("PHASE_SHIFT_MAX_TICKS");
      expect(cfg).toContain("CTRL_MODE_PHASE_SHIFT");
      expect(cfg).toContain("PHASE_SHIFT_MAX_TICKS");
    }
  });

  it("psfb also selects phase-shift with a wider phase ceiling than dab", () => {
    const dab = file(generateFirmware("STM32G474", "dab", spec, fsw, comp), "config.h");
    const psfb = file(generateFirmware("STM32G474", "psfb", spec, fsw, comp), "config.h");
    const grab = (s: string) => Number(/PHASE_SHIFT_MAX_TICKS\s*\((\d+)U\)/.exec(s)![1]);
    expect(grab(psfb)).toBeGreaterThan(grab(dab));
    // dab ceiling = quarter period (phi = 90 deg, max power transfer)
    expect(grab(dab)).toBe(Math.round(0.25 * 21760));
  });

  it("llc emits frequency-control with a plausible band around fsw", () => {
    const pkg = generateFirmware("STM32G474", "llc-half-bridge", spec, fsw, comp);
    const ctl = file(pkg, "control.c");
    const cfg = file(pkg, "config.h");
    expect(cfg).toContain("CTRL_MODE_FREQUENCY");
    expect(ctl).toContain("LLC_PERIOD_MIN_TICKS");
    const fmin = Number(/LLC_F_MIN_HZ\s*\(([\d.]+)/.exec(cfg)![1]);
    const fmax = Number(/LLC_F_MAX_HZ\s*\(([\d.]+)/.exec(cfg)![1]);
    expect(fmin).toBeLessThan(fsw);
    expect(fmax).toBeGreaterThan(fsw);
    // period range consistent: min ticks at f_max < max ticks at f_min
    const pMin = Number(/LLC_PERIOD_MIN_TICKS\s*\((\d+)U\)/.exec(cfg)![1]);
    const pMax = Number(/LLC_PERIOD_MAX_TICKS\s*\((\d+)U\)/.exec(cfg)![1]);
    expect(pMin).toBeLessThan(pMax);
  });

  it("plain buck stays in duty mode", () => {
    const cfg = file(generateFirmware("STM32G474", "sync-buck", spec, fsw, comp), "config.h");
    expect(cfg).toContain("CTRL_MODE_DUTY");
    expect(cfg).not.toContain("PHASE_SHIFT_MAX_TICKS");
  });
});

describe("generateFirmware — TMS320F280049", () => {
  const pkg = generateFirmware("TMS320F280049", "dab", spec, 100e3, comp);

  it("produces at least 4 files", () => {
    expect(pkg.files.length).toBeGreaterThanOrEqual(4);
  });

  it("config.h contains the computed EPWM TBPRD for up-down count", () => {
    const cfg = file(pkg, "config.h");
    expect(cfg).toMatch(/EPWM_TBPRD_TICKS\s*\(500U\)/); // 100e6 / (2 * 100 kHz)
    expect(cfg).toContain("CMPSS_OCP_DAC_CODE");
  });

  it("main.c sets up up-down EPWM, CMPSS trip and a CLA-ready RAM-resident ISR", () => {
    const main = file(pkg, "main.c");
    expect(main).toContain("TB_COUNT_UPDOWN");
    expect(main).toContain("DBRED");
    expect(main).toContain("Cmpss1Regs");
    expect(main).toContain("CLA-ready");
    expect(main).toContain(".TI.ramfunc");
  });

  it("control.c coefficients match the STM32 build (same compensator)", () => {
    const ctl = file(pkg, "control.c");
    for (const x of comp.b) expect(ctl).toContain(cFloat9(x));
  });

  it("contains no unresolved TODO strings", () => {
    for (const f of pkg.files) expect(f.contents).not.toContain("TODO");
  });
});

describe("generateFirmware — package metadata & sanity", () => {
  it("summary names the target, topology and protection margins", () => {
    const pkg = generateFirmware("STM32G474", "llc-full-bridge", spec, 500e3, comp);
    expect(pkg.target).toBe("STM32G474");
    expect(pkg.summary).toContain("STM32G474");
    expect(pkg.summary).toContain("llc-full-bridge");
    expect(pkg.summary).toContain("20 % margins");
  });

  it("achieved fsw in config.h is within 0.1 % of the request across the sweep", () => {
    for (const f of [100e3, 250e3, 500e3, 1e6]) {
      expect(Math.abs(hrtimTiming(f, 20).actualFswHz / f - 1)).toBeLessThan(1e-3);
      expect(Math.abs(epwmTiming(f, 20).actualFswHz / f - 1)).toBeLessThan(2e-3);
    }
  });

  it("throws on a non-positive fsw", () => {
    expect(() => generateFirmware("STM32G474", "sync-buck", spec, 0, comp)).toThrow();
  });

  it("defaults Tj,max to 125 degC when the spec omits it", () => {
    const s2 = { ...spec, maxJunctionC: undefined };
    const cfg = file(generateFirmware("STM32G474", "sync-buck", s2, fsw, comp), "config.h");
    expect(cfg).toContain(cFloat9(100)); // 0.8 * 125
  });
});
