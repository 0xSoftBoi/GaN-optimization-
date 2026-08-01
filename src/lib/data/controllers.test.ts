import { describe, expect, it } from "vitest";
import { CONTROLLERS, getController } from "./controllers";

const ALLOWED_SUPPLIERS = new Set(["Digi-Key", "Mouser", "Arrow", "Avnet"]);

describe("CONTROLLERS", () => {
  it("has at least 6 parts with unique ids", () => {
    expect(CONTROLLERS.length).toBeGreaterThanOrEqual(6);
    const ids = CONTROLLERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all four controller families", () => {
    const fams = new Set(CONTROLLERS.map((c) => c.family));
    for (const f of ["STM32G4", "C2000", "analog-pwm", "digital-pwm"]) {
      expect(fams.has(f as never), f).toBe(true);
    }
  });

  it("includes UCC28951 as the analog PSFB reference", () => {
    const c = getController("UCC28951");
    expect(c?.family).toBe("analog-pwm");
  });

  it("digital controllers have real cores, high-res PWM and >= 10-bit ADCs", () => {
    for (const c of CONTROLLERS.filter((x) => x.family !== "analog-pwm")) {
      expect(c.coreMhz, c.id).toBeGreaterThanOrEqual(48);
      expect(c.coreMhz, c.id).toBeLessThanOrEqual(400);
      expect(c.pwmResolutionPs, c.id).toBeGreaterThanOrEqual(100);
      expect(c.pwmResolutionPs, c.id).toBeLessThanOrEqual(10000);
      // PWM step must be finer than one core clock period is not required
      // (HRPWM/HRTIM use delay lines), but it must be finer than 10 clocks:
      const corePeriodPs = 1e6 / c.coreMhz;
      expect(c.pwmResolutionPs, c.id).toBeLessThan(10 * corePeriodPs);
      expect(c.adcBits, c.id).toBeGreaterThanOrEqual(10);
      expect(c.adcBits, c.id).toBeLessThanOrEqual(16);
    }
  });

  it("analog PWM controllers use the coreMhz=0 convention", () => {
    const analog = CONTROLLERS.filter((c) => c.family === "analog-pwm");
    expect(analog.length).toBeGreaterThanOrEqual(1);
    for (const c of analog) {
      expect(c.coreMhz, c.id).toBe(0);
      expect(c.pwmResolutionPs, c.id).toBe(0);
      expect(c.adcBits, c.id).toBe(0);
    }
  });

  it("prices and suppliers are sane", () => {
    for (const c of CONTROLLERS) {
      expect(c.priceUsd1k, c.id).toBeGreaterThan(0.5);
      expect(c.priceUsd1k, c.id).toBeLessThan(25);
      expect(c.suppliers.length, c.id).toBeGreaterThan(0);
      for (const s of c.suppliers) expect(ALLOWED_SUPPLIERS.has(s), `${c.id}: ${s}`).toBe(true);
    }
  });

  it("HRTIM-class parts resolve finer than plain-timer parts", () => {
    const g474 = getController("STM32G474RET6")!;
    const g431 = getController("STM32G431CBT6")!;
    expect(g474.pwmResolutionPs).toBeLessThan(g431.pwmResolutionPs / 10);
  });
});
