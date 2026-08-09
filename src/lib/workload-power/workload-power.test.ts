import { describe, expect, it } from "vitest";
import type { DesignSpec } from "@/lib/types";
import {
  converterSpecFromPowerTrace,
  parsePowerTrace,
  summarizePowerTrace,
  type PowerTrace,
} from "./index";

const TRACE: PowerTrace = {
  schema_version: "1.0",
  source: "board-instrument",
  hardware_id: "synthetic-test-only",
  operation: "authenticated_bridge",
  metadata: { bandwidth_hz: 10_000_000 },
  samples: [
    {
      timestamp_ns: 0,
      state: "idle",
      active_lanes: 0,
      clock_hz: 100_000_000,
      estimated_watts: 1.8,
      measured_watts: 2,
    },
    {
      timestamp_ns: 1_000,
      state: "kem",
      active_lanes: 1,
      clock_hz: 100_000_000,
      estimated_watts: 3.6,
      measured_watts: 4,
    },
    {
      timestamp_ns: 2_000,
      state: "idle",
      active_lanes: 0,
      clock_hz: 100_000_000,
      estimated_watts: 1.8,
      measured_watts: 2,
    },
  ],
};

const BASE_SPEC: Omit<DesignSpec, "poutW"> = {
  name: "LCA-1 core rail",
  conversion: "dc-dc",
  vinMinV: 11.4,
  vinNomV: 12,
  vinMaxV: 12.6,
  voutV: 0.8,
  bidirectional: false,
  isolated: false,
  ambientC: 40,
  cooling: "forced-air",
};

describe("LCA-1 power-trace integration", () => {
  it("integrates energy and exposes converter transients", () => {
    const summary = summarizePowerTrace(TRACE);
    expect(summary.provenance).toBe("measurement");
    expect(summary.durationNs).toBe(2_000);
    expect(summary.energyJ).toBeCloseTo(6e-6, 12);
    expect(summary.averageW).toBeCloseTo(3, 12);
    expect(summary.peakW).toBe(4);
    expect(summary.p95W).toBe(4);
    expect(summary.peakState).toBe("kem");
    expect(summary.maxRiseW).toBe(2);
    expect(summary.maxFallW).toBe(2);
    expect(summary.maxSlewWPerUs).toBeCloseTo(2, 12);
    expect(summary.stateDutyPct.idle).toBe(50);
    expect(summary.stateDutyPct.kem).toBe(50);
  });

  it("turns peak workload power into a DesignSpec with explicit headroom", () => {
    const result = converterSpecFromPowerTrace(TRACE, BASE_SPEC, {
      otherLoadW: 1,
      transientHeadroomPct: 20,
    });
    expect(result.spec.poutW).toBe(6);
    expect(result.spec.notes).toContain("board-instrument");
    expect(result.trace.maxRiseW).toBe(2);
  });

  it("requires an explicit estimated series when measurements are absent", () => {
    const estimateOnly: PowerTrace = {
      ...TRACE,
      samples: TRACE.samples.map((sample) => ({
        ...sample,
        measured_watts: null,
      })),
    };
    expect(() => summarizePowerTrace(estimateOnly)).toThrow(
      "all samples require measured_watts",
    );
    expect(summarizePowerTrace(estimateOnly, "estimated").provenance).toBe(
      "estimate",
    );
  });

  it("rejects non-monotonic timestamps", () => {
    const invalid = {
      ...TRACE,
      samples: [TRACE.samples[0], { ...TRACE.samples[1], timestamp_ns: 0 }],
    };
    expect(() => parsePowerTrace(invalid)).toThrow(
      "sample timestamps must be strictly increasing",
    );
  });

  it("rejects schema drift instead of ignoring unknown sample fields", () => {
    const invalid = {
      ...TRACE,
      samples: TRACE.samples.map((sample, index) =>
        index === 0 ? { ...sample, marketing_tdp_watts: 9000 } : sample,
      ),
    };
    expect(() => parsePowerTrace(invalid)).toThrow(
      "unsupported field: marketing_tdp_watts",
    );
  });
});
