import type { DesignSpec } from "@/lib/types";

export const ACTIVITY_STATES = [
  "idle",
  "kem",
  "dsa",
  "dma",
  "zeroize",
  "fault",
] as const;

export type ActivityState = (typeof ACTIVITY_STATES)[number];
export type PowerSeries = "estimated" | "measured";

export interface PowerTraceSample {
  timestamp_ns: number;
  state: ActivityState;
  active_lanes: number;
  clock_hz: number;
  estimated_watts: number | null;
  measured_watts: number | null;
}

export interface PowerTrace {
  schema_version: "1.0";
  source: string;
  hardware_id: string;
  operation: string;
  metadata: Record<string, unknown>;
  samples: PowerTraceSample[];
}

export interface PowerTraceSummary {
  series: PowerSeries;
  provenance: "estimate" | "measurement";
  durationNs: number;
  energyJ: number;
  averageW: number;
  peakW: number;
  p95W: number;
  peakState: ActivityState;
  maxRiseW: number;
  maxFallW: number;
  maxSlewWPerUs: number;
  stateDutyPct: Record<ActivityState, number>;
}

export interface ConverterSizingOptions {
  /** Select measurements by default so estimates cannot silently become claims. */
  series?: PowerSeries;
  /** Non-accelerator load carried by the same rail. */
  otherLoadW?: number;
  /** Engineering headroom applied after accelerator + other load. */
  transientHeadroomPct?: number;
}

export interface TraceDrivenDesignInput {
  spec: DesignSpec;
  trace: PowerTraceSummary;
}

const ROOT_KEYS = new Set([
  "schema_version",
  "source",
  "hardware_id",
  "operation",
  "metadata",
  "samples",
]);
const SAMPLE_KEYS = new Set([
  "timestamp_ns",
  "state",
  "active_lanes",
  "clock_hz",
  "estimated_watts",
  "measured_watts",
]);
const STATE_SET = new Set<string>(ACTIVITY_STATES);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unsupported field: ${unknown[0]}`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function integerAtLeast(value: unknown, minimum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
  return value as number;
}

function nullablePower(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be null or a finite, non-negative number`);
  }
  return value;
}

/** Parse and strictly validate the LCA-1 power-trace schema v1.0. */
export function parsePowerTrace(value: unknown): PowerTrace {
  const root = record(value, "trace");
  rejectUnknownKeys(root, ROOT_KEYS, "trace");
  if (root.schema_version !== "1.0") {
    throw new Error("trace.schema_version must be 1.0");
  }

  const metadata = record(root.metadata, "trace.metadata");
  if (!Array.isArray(root.samples) || root.samples.length < 2) {
    throw new Error("trace.samples must contain at least two samples");
  }

  let previousTimestamp = -1;
  const samples = root.samples.map((item, index): PowerTraceSample => {
    const sample = record(item, `trace.samples[${index}]`);
    rejectUnknownKeys(sample, SAMPLE_KEYS, `trace.samples[${index}]`);
    const timestamp = integerAtLeast(
      sample.timestamp_ns,
      0,
      `trace.samples[${index}].timestamp_ns`,
    );
    if (timestamp <= previousTimestamp) {
      throw new Error("sample timestamps must be strictly increasing");
    }
    previousTimestamp = timestamp;

    if (typeof sample.state !== "string" || !STATE_SET.has(sample.state)) {
      throw new Error(`trace.samples[${index}].state is unsupported`);
    }

    return {
      timestamp_ns: timestamp,
      state: sample.state as ActivityState,
      active_lanes: integerAtLeast(
        sample.active_lanes,
        0,
        `trace.samples[${index}].active_lanes`,
      ),
      clock_hz: integerAtLeast(
        sample.clock_hz,
        1,
        `trace.samples[${index}].clock_hz`,
      ),
      estimated_watts: nullablePower(
        sample.estimated_watts,
        `trace.samples[${index}].estimated_watts`,
      ),
      measured_watts: nullablePower(
        sample.measured_watts,
        `trace.samples[${index}].measured_watts`,
      ),
    };
  });

  return {
    schema_version: "1.0",
    source: requiredString(root.source, "trace.source"),
    hardware_id: requiredString(root.hardware_id, "trace.hardware_id"),
    operation: requiredString(root.operation, "trace.operation"),
    metadata,
    samples,
  };
}

function tracePowers(trace: PowerTrace, series: PowerSeries): number[] {
  const field = series === "measured" ? "measured_watts" : "estimated_watts";
  const values = trace.samples.map((sample) => sample[field]);
  if (values.some((value) => value === null)) {
    throw new Error(`all samples require ${field}`);
  }
  return values as number[];
}

/**
 * Summarize converter-relevant behavior without inventing a TDP.
 *
 * Energy uses trapezoidal integration. State duty assigns each interval to its
 * left-hand sample, matching a piecewise-constant activity-state trace.
 */
export function summarizePowerTrace(
  input: PowerTrace,
  series: PowerSeries = "measured",
): PowerTraceSummary {
  const trace = parsePowerTrace(input);
  const powers = tracePowers(trace, series);
  const first = trace.samples[0];
  const last = trace.samples[trace.samples.length - 1];
  const durationNs = last.timestamp_ns - first.timestamp_ns;

  let energyJ = 0;
  let maxRiseW = 0;
  let maxFallW = 0;
  let maxSlewWPerUs = 0;
  const stateDurationNs = Object.fromEntries(
    ACTIVITY_STATES.map((state) => [state, 0]),
  ) as Record<ActivityState, number>;

  for (let index = 0; index < trace.samples.length - 1; index++) {
    const left = trace.samples[index];
    const right = trace.samples[index + 1];
    const intervalNs = right.timestamp_ns - left.timestamp_ns;
    const deltaW = powers[index + 1] - powers[index];
    energyJ +=
      (intervalNs / 1_000_000_000) *
      ((powers[index] + powers[index + 1]) / 2);
    stateDurationNs[left.state] += intervalNs;
    maxRiseW = Math.max(maxRiseW, deltaW);
    maxFallW = Math.max(maxFallW, -deltaW);
    maxSlewWPerUs = Math.max(
      maxSlewWPerUs,
      Math.abs(deltaW) / (intervalNs / 1_000),
    );
  }

  const peakW = Math.max(...powers);
  const peakIndex = powers.indexOf(peakW);
  const sorted = [...powers].sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const stateDutyPct = Object.fromEntries(
    ACTIVITY_STATES.map((state) => [
      state,
      (100 * stateDurationNs[state]) / durationNs,
    ]),
  ) as Record<ActivityState, number>;

  return {
    series,
    provenance: series === "measured" ? "measurement" : "estimate",
    durationNs,
    energyJ,
    averageW: energyJ / (durationNs / 1_000_000_000),
    peakW,
    p95W: sorted[p95Index],
    peakState: trace.samples[peakIndex].state,
    maxRiseW,
    maxFallW,
    maxSlewWPerUs,
    stateDutyPct,
  };
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative`);
  }
  return value;
}

/**
 * Convert a workload trace into a normal VoltForge DesignSpec plus the transient
 * evidence that steady-state optimization does not capture.
 */
export function converterSpecFromPowerTrace(
  input: PowerTrace,
  base: Omit<DesignSpec, "poutW">,
  options: ConverterSizingOptions = {},
): TraceDrivenDesignInput {
  const trace = parsePowerTrace(input);
  const series = options.series ?? "measured";
  const summary = summarizePowerTrace(trace, series);
  const otherLoadW = finiteNonNegative(options.otherLoadW ?? 0, "otherLoadW");
  const headroomPct = finiteNonNegative(
    options.transientHeadroomPct ?? 20,
    "transientHeadroomPct",
  );
  const poutW = (summary.peakW + otherLoadW) * (1 + headroomPct / 100);
  const provenance = `${trace.source}/${trace.hardware_id}/${trace.operation}`;
  const traceNote =
    `Trace-derived ${series} load (${provenance}): ` +
    `${summary.peakW} W peak, ${summary.averageW} W average, ` +
    `${headroomPct}% sizing headroom.`;

  return {
    spec: {
      ...base,
      poutW,
      notes: base.notes ? `${base.notes}\n${traceNote}` : traceNote,
    },
    trace: summary,
  };
}
