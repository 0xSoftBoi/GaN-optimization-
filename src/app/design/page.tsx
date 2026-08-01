"use client";

/**
 * /design — the workbench. Reads the landing page's sessionStorage hand-off
 * (fallback: the 5 kW 800→48 V demo), runs the design engine through
 * /api/copilot or /api/design, and renders the full result: stats, rationale,
 * loss waterfall, efficiency curve, devices, magnetics, thermal, schematic,
 * BOM, compliance, firmware, layout guidance and warnings.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CopilotParse, DesignResult } from "@/lib/types";
import {
  BomPanel,
  CompliancePanel,
  DEFAULT_SPEC,
  DeviceTable,
  EfficiencyChart,
  ErrorPanel,
  FirmwarePanel,
  LayoutPanel,
  LossWaterfall,
  MagneticsCards,
  PIPELINE_STAGES,
  RationalePanel,
  STORAGE_KEY,
  SchematicPanel,
  StagedProgress,
  StatsRow,
  ThermalPanel,
  WarningsStrip,
  type WorkbenchRequest,
  decodeRequest,
  downloadBlob,
  fmtW,
} from "@/components/workbench";

interface RunOutcome {
  result: DesignResult;
  parse?: CopilotParse;
}

async function runEngine(req: WorkbenchRequest, signal: AbortSignal): Promise<RunOutcome> {
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const o = (json ?? {}) as { error?: string; details?: string[] };
      const detail = o.details?.length ? ` — ${o.details.join("; ")}` : "";
      throw new Error((o.error ?? `HTTP ${res.status}`) + detail);
    }
    return json;
  };

  if (req.prompt) {
    const body = (await post("/api/copilot", { prompt: req.prompt })) as {
      parse: CopilotParse;
      result: DesignResult;
    };
    return { result: body.result, parse: body.parse };
  }
  const spec = req.spec ?? DEFAULT_SPEC;
  const result = (await post("/api/design", { spec })) as DesignResult;
  return { result };
}

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "done"; result: DesignResult; parse?: CopilotParse };

export default function DesignWorkbench() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [stage, setStage] = useState(0);
  const [runId, setRunId] = useState(0);
  const [spiceBusy, setSpiceBusy] = useState(false);
  const [spiceError, setSpiceError] = useState<string | null>(null);
  const requestRef = useRef<WorkbenchRequest | null>(null);

  // Staged progress: advance while loading, hold on the last stage.
  useEffect(() => {
    if (state.phase !== "loading") return;
    setStage(0);
    const t = setInterval(
      () => setStage((s) => Math.min(s + 1, PIPELINE_STAGES.length - 1)),
      700,
    );
    return () => clearInterval(t);
  }, [state.phase, runId]);

  // Kick off (and retry via runId) the engine run.
  useEffect(() => {
    const controller = new AbortController();
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    const req = requestRef.current ?? decodeRequest(raw) ?? { spec: DEFAULT_SPEC };
    requestRef.current = req;
    setState({ phase: "loading" });
    runEngine(req, controller.signal)
      .then((out) => setState({ phase: "done", ...out }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ phase: "error", message });
      });
    return () => controller.abort();
  }, [runId]);

  const retry = useCallback(() => setRunId((r) => r + 1), []);

  const exportSpice = useCallback(async () => {
    if (state.phase !== "done") return;
    setSpiceBusy(true);
    setSpiceError(null);
    try {
      const res = await fetch("/api/spice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec: state.result.spec }),
      });
      if (!res.ok) {
        const o = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(o?.error ?? `HTTP ${res.status}`);
      }
      const text = await res.text();
      downloadBlob(text, `voltforge-${state.result.topology.id}.cir`, "text/plain");
    } catch (err) {
      setSpiceError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpiceBusy(false);
    }
  }, [state]);

  if (state.phase === "loading") {
    return (
      <div className="py-16">
        <StagedProgress stages={PIPELINE_STAGES} active={stage} />
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="py-16">
        <ErrorPanel message={state.message} onRetry={retry} />
      </div>
    );
  }

  const { result, parse } = state;

  return (
    <div className="space-y-4">
      {/* Title bar + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">
            {result.spec.name ?? "Converter design"}
          </h1>
          <p className="text-xs text-slate-500">
            {result.spec.vinNomV} V → {result.spec.voutV} V · {fmtW(result.spec.poutW)} ·{" "}
            {result.spec.conversion}
            {result.spec.isolated ? " · isolated" : ""}
            {result.spec.bidirectional ? " · bidirectional" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {spiceError && <span className="text-xs text-rose-400">{spiceError}</span>}
          <button className="btn" onClick={exportSpice} disabled={spiceBusy}>
            {spiceBusy ? "Exporting…" : "↓ Export SPICE"}
          </button>
        </div>
      </div>

      {/* (1) header stats */}
      <StatsRow result={result} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* (2) rationale */}
        <RationalePanel
          rationale={result.topologyRationale}
          assumptions={parse?.assumptions}
          unrecognized={parse?.unrecognized}
          confidence={parse?.confidence}
        />

        {/* (3) loss waterfall */}
        <div className="panel">
          <div className="panel-title">
            Loss waterfall · {fmtW(result.losses.totalW)} total at 100% load
          </div>
          <LossWaterfall losses={result.losses} />
        </div>

        {/* (4) efficiency vs load */}
        <div className="panel">
          <div className="panel-title">Efficiency vs load</div>
          <EfficiencyChart points={result.efficiencyCurve} />
        </div>

        {/* (5) device table */}
        <DeviceTable devices={result.devices} />

        {/* (6) magnetics */}
        <MagneticsCards magnetics={result.magnetics} />

        {/* (7) thermal */}
        <ThermalPanel thermal={result.thermal} />
      </div>

      {/* (8) schematic */}
      <SchematicPanel svg={result.schematic.svg} />

      {/* (9) BOM */}
      <BomPanel bom={result.bom} totalUsd={result.bomCostUsd} />

      {/* (10) compliance */}
      <CompliancePanel compliance={result.compliance} />

      {/* (11) firmware */}
      <FirmwarePanel firmware={result.firmware} />

      {/* (12) layout guidance */}
      <LayoutPanel layout={result.layout} />

      {/* (13) warnings strip */}
      <WarningsStrip warnings={result.warnings} />
    </div>
  );
}
