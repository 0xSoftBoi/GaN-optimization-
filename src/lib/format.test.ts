import { describe, expect, it } from "vitest";
import { formatEnergy, formatNumber, formatPct, formatUsd } from "./format";

describe("formatUsd", () => {
  it("matches the canonical examples", () => {
    expect(formatUsd(1_200_000)).toBe("$1.2M");
    expect(formatUsd(43_000)).toBe("$43k");
    expect(formatUsd(980)).toBe("$980");
  });

  it("scales through k, M, B, T", () => {
    expect(formatUsd(1_500)).toBe("$1.5k");
    expect(formatUsd(2_500_000_000)).toBe("$2.5B");
    expect(formatUsd(3_100_000_000_000)).toBe("$3.1T");
  });

  it("rounds to two significant digits", () => {
    expect(formatUsd(1_234_567)).toBe("$1.2M");
    expect(formatUsd(12_700)).toBe("$13k");
    expect(formatUsd(987.4)).toBe("$987"); // whole dollars below 1k
  });

  it("promotes when rounding carries into the next scale", () => {
    expect(formatUsd(999_600)).toBe("$1M");
    expect(formatUsd(999_600_000)).toBe("$1B");
  });

  it("handles zero and negatives", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(-43_000)).toBe("-$43k");
    expect(formatUsd(-980)).toBe("-$980");
  });

  it("cents round to whole dollars", () => {
    expect(formatUsd(12.34)).toBe("$12");
    expect(formatUsd(0.4)).toBe("$0");
  });
});

describe("formatNumber", () => {
  it("rounds to significant digits with grouping", () => {
    expect(formatNumber(12345.6, 3)).toBe("12,300");
    expect(formatNumber(8760)).toBe("8,760");
    expect(formatNumber(0.012345, 2)).toBe("0.012");
    expect(formatNumber(1234567, 2)).toBe("1,200,000");
  });

  it("small and negative values", () => {
    expect(formatNumber(3.14159, 3)).toBe("3.14");
    expect(formatNumber(-12345.6, 3)).toBe("-12,300");
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatEnergy", () => {
  it("matches the canonical examples", () => {
    expect(formatEnergy(1200)).toBe("1.2 GWh");
    expect(formatEnergy(340)).toBe("340 MWh");
  });

  it("scales down to kWh and up to TWh", () => {
    expect(formatEnergy(0.34)).toBe("340 kWh");
    expect(formatEnergy(2_500_000)).toBe("2.5 TWh");
    expect(formatEnergy(0.0005)).toBe("0.5 kWh");
  });

  it("promotes when rounding carries (999.7 MWh → 1 GWh)", () => {
    expect(formatEnergy(999.7)).toBe("1 GWh");
  });

  it("zero and negatives", () => {
    expect(formatEnergy(0)).toBe("0 MWh");
    expect(formatEnergy(-1200)).toBe("-1.2 GWh");
  });
});

describe("formatPct", () => {
  it("fixed decimal places, input already percent", () => {
    expect(formatPct(97.31)).toBe("97.3%");
    expect(formatPct(97.35, 2)).toBe("97.35%");
    expect(formatPct(5, 0)).toBe("5%");
    expect(formatPct(-1.25, 1)).toBe("-1.3%");
    expect(formatPct(100, 1)).toBe("100.0%");
  });
});
