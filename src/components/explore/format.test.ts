import { describe, expect, it } from "vitest";
import { fmtHz, fmtNum, fmtPct, fmtUsd } from "./format";

describe("format helpers", () => {
  it("fmtUsd keeps cents under $100 and drops them above", () => {
    expect(fmtUsd(3.5)).toBe("$3.50");
    expect(fmtUsd(1234.6)).toBe("$1,235");
    expect(fmtUsd(NaN)).toBe("—");
  });

  it("fmtHz uses SI prefixes", () => {
    expect(fmtHz(250e3)).toBe("250 kHz");
    expect(fmtHz(1.2e6)).toBe("1.2 MHz");
  });

  it("fmtNum rounds to significant figures and guards non-finite", () => {
    expect(fmtNum(0.12345)).toBe("0.123");
    expect(fmtNum(12345)).toBe("12,300");
    expect(fmtNum(undefined)).toBe("—");
  });

  it("fmtPct formats with one decimal by default", () => {
    expect(fmtPct(96.478)).toBe("96.5%");
  });
});
