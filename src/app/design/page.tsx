"use client";

/**
 * /design — the workbench. Reads the landing page's sessionStorage hand-off
 * (fallback: the 5 kW 800→48 V demo), runs the design engine through
 * /api/copilot or /api/design, and renders the full result for two
 * audiences via the persona toggle:
 *
 *   executive — Impact panel, summary stats, plain-language topology
 *   rationale, a condensed risk & compliance verdict, and BOM cost only.
 *
 *   engineer — everything above the fold PLUS the full engineering depth:
 *   loss waterfall, efficiency curve, devices, magnetics, thermal,
 *   schematic, itemized BOM, full compliance findings, firmware, layout
 *   guidance and warnings.
 *
 * The $-impact numbers (Impact panel) are computed client-side from the
 * already-fetched DesignResult via src/lib/economics — no extra round trip.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CopilotParse, DesignResult } from "@/lib/types";
import {
  assertValidAssumptions,
  defaultAssumptions,
  energyEconomics,
  type EconomicsAssumptions,
  type EnergyEconomics,
} from "@/lib/economics";
import { formatUsd } from "@/lib/format";
import { usePersona, PersonaToggle } from "@/components/ui/persona";
import { Term } from "@/components/ui/term";
import {
  BomPanel,
  CompliancePanel,
  ComplianceVerdictCard,
  DEFAULT_SPEC,
  DeviceTable,
  EfficiencyChart,
  ErrorPanel,
  FirmwarePanel,
  ImpactPanel,
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
  buildSummaryMarkdown,
  complianceVerdict,
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

type ExportKind = "summary" | "spice" | "kicad" | "ltspice";

const EXPORT_FILE: Record<Exclude<ExportKind, "summary">, { ext: string; label: string }> = {
  spice: { ext: "cir", label: "↓ Export SPICE" },
  kicad: { ext: "kicad_sch", label: "↓ KiCad" },
  ltspice: { ext: "net", label: "↓ LTspice" },
};

export default function DesignWorkbench() {
  const { isEngineer, isExecutive } = usePersona();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [stage, setStage] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [runId, setRunId] = useState(0);
  const [exportBusy, setExportBusy] = useState<ExportKind | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isDemoSpec, setIsDemoSpec] = useState(false);
  const [demoDismissed, setDemoDismissed] = useState(false);
  const [assumptionsOverride, setAssumptionsOverride] = useState<EconomicsAssumptions | null>(null);
  const requestRef = useRef<WorkbenchRequest | null>(null);

  // Staged progress: advance while loading, hold on the last stage. Fixed
  // 700ms ticks are indicative, not measured — the elapsed-time counter
  // below (real Date.now()) and the microcopy in StagedProgress say so.
  useEffect(() => {
    if (state.phase !== "loading") return;
    setStage(0);
    const t = setInterval(
      () => setStage((s) => Math.min(s + 1, PIPELINE_STAGES.length - 1)),
      700,
    );
    return () => clearInterval(t);
  }, [state.phase, runId]);

  useEffect(() => {
    if (state.phase !== "loading") return;
    const start = Date.now();
    setElapsedSec(0);
    const t = setInterval(() => setElapsedSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [state.phase, runId]);

  // A new design (fresh run, not a retry-with-same-request) resets any
  // hand-edited $-impact assumptions back to the new spec's defaults.
  useEffect(() => {
    setAssumptionsOverride(null);
  }, [runId]);

  // Kick off (and retry via runId) the engine run.
  useEffect(() => {
    const controller = new AbortController();
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    const decoded = decodeRequest(raw);
    const req = requestRef.current ?? decoded ?? { spec: DEFAULT_SPEC };
    requestRef.current = req;
    // True when we fell back to the flagship demo spec (no valid hand-off
    // in sessionStorage) — surfaced as a dismissible banner, not silently.
    setIsDemoSpec(req.spec === DEFAULT_SPEC);
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

  const exportFile = useCallback(
    async (kind: ExportKind, assumptions: EconomicsAssumptions | null) => {
      if (state.phase !== "done") return;
      setExportBusy(kind);
      setExportError(null);
      try {
        if (kind === "summary") {
          if (!assumptions) throw new Error("Impact assumptions are not ready yet");
          assertValidAssumptions(assumptions);
          const eco = energyEconomics(state.result, assumptions);
          const md = buildSummaryMarkdown(state.result, assumptions, eco);
          downloadBlob(md, `voltforge-${state.result.topology.id}-summary.md`, "text/markdown");
          return;
        }
        const url = kind === "spice" ? "/api/spice" : "/api/export";
        const body =
          kind === "spice"
            ? { spec: state.result.spec }
            : { spec: state.result.spec, format: kind };
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const o = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(o?.error ?? `HTTP ${res.status}`);
        }
        const text = await res.text();
        downloadBlob(
          text,
          `voltforge-${state.result.topology.id}.${EXPORT_FILE[kind].ext}`,
          "text/plain",
        );
      } catch (err) {
        setExportError(err instanceof Error ? err.message : String(err));
      } finally {
        setExportBusy(null);
      }
    },
    [state],
  );

  if (state.phase === "loading") {
    return (
      <div className="py-16">
        <StagedProgress stages={PIPELINE_STAGES} active={stage} elapsedSec={elapsedSec} />
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
  const assumptions = assumptionsOverride ?? defaultAssumptions(result.spec);

  let economics: EnergyEconomics | null = null;
  let economicsError: string | null = null;
  try {
    assertValidAssumptions(assumptions);
    economics = energyEconomics(result, assumptions);
  } catch (err) {
    economicsError = err instanceof Error ? err.message : String(err);
  }

  const verdict = complianceVerdict(result.compliance);

  return (
    <div className="space-y-4">
      {isDemoSpec && !demoDismissed && (
        <div className="panel flex items-center justify-between gap-3 border-volt/30 bg-volt/5">
          <p className="text-sm text-slate-300">
            <span className="font-semibold text-volt">Demo spec:</span> 5 kW 800 V → 48 V — describe
            your own converter in the{" "}
            <a href="/" className="underline decoration-dotted hover:text-volt">
              copilot
            </a>
            .
          </p>
          <button
            type="button"
            className="shrink-0 text-slate-500 hover:text-slate-300"
            onClick={() => setDemoDismissed(true)}
            aria-label="Dismiss demo spec banner"
          >
            ✕
          </button>
        </div>
      )}

      {/* Title bar + persona toggle + risk chips + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">
            {result.spec.name ?? "Converter design"}
          </h1>
          <p className="text-xs text-slate-400">
            {result.spec.vinNomV} V → {result.spec.voutV} V · {fmtW(result.spec.poutW)} ·{" "}
            {result.spec.conversion}
            {result.spec.isolated ? (
              <>
                {" "}
                · <Term k="isolated">isolated</Term>
              </>
            ) : (
              ""
            )}
            {result.spec.bidirectional ? (
              <>
                {" "}
                · <Term k="bidirectional">bidirectional</Term>
              </>
            ) : (
              ""
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="#compliance-panel"
            className={`rounded border px-2 py-1 text-xs font-semibold transition-colors ${
              verdict.passed
                ? "border-lime-400/40 bg-lime-400/10 text-lime-400 hover:bg-lime-400/20"
                : "border-rose-400/40 bg-rose-400/10 text-rose-400 hover:bg-rose-400/20"
            }`}
          >
            {verdict.passed ? "Compliant" : `${verdict.failCount} compliance issue${verdict.failCount === 1 ? "" : "s"}`}
          </a>
          <a
            href="#warnings-strip"
            className={`rounded border px-2 py-1 text-xs font-semibold transition-colors ${
              result.warnings.length === 0
                ? "border-ink-600 text-slate-500 hover:text-slate-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
            }`}
          >
            {result.warnings.length === 0 ? "No warnings" : `${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`}
          </a>
          <PersonaToggle />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {exportError && <span className="text-xs text-rose-400">{exportError}</span>}
        <button
          className="btn"
          onClick={() => exportFile("summary", assumptions)}
          disabled={exportBusy !== null || economics === null}
          title="Markdown one-pager: spec, headline $ numbers, assumptions, warnings"
        >
          {exportBusy === "summary" ? "Exporting…" : "↓ Summary"}
        </button>
        {isEngineer &&
          (Object.keys(EXPORT_FILE) as (keyof typeof EXPORT_FILE)[]).map((kind) => (
            <button
              key={kind}
              className="btn"
              onClick={() => exportFile(kind, assumptions)}
              disabled={exportBusy !== null}
            >
              {exportBusy === kind ? "Exporting…" : EXPORT_FILE[kind].label}
            </button>
          ))}
      </div>

      {/* Impact panel — rendered first, both personas */}
      <ImpactPanel
        assumptions={assumptions}
        onAssumptionsChange={setAssumptionsOverride}
        economics={economics}
        error={economicsError}
      />

      {/* Summary stats — both personas */}
      <StatsRow result={result} />

      {/* Topology rationale, plain language — both personas */}
      <RationalePanel
        rationale={result.topologyRationale}
        assumptions={parse?.assumptions}
        unrecognized={parse?.unrecognized}
        confidence={parse?.confidence}
      />

      {isExecutive && (
        <>
          {/* Condensed risk & compliance verdict (id="compliance-panel" + nested id="warnings-strip") */}
          <div id="compliance-panel">
            <ComplianceVerdictCard compliance={result.compliance} warnings={result.warnings} />
          </div>

          {/* BOM cost only — full itemized bill lives in Engineer view */}
          <div className="panel">
            <div className="panel-title">
              <Term k="bom">BOM</Term> cost
            </div>
            <div className="stat-value text-2xl">{formatUsd(result.bomCostUsd)}</div>
            <p className="mt-1 text-xs text-slate-500">
              Estimated per-unit hardware cost. Switch to Engineer view for the full itemized bill
              of materials.
            </p>
          </div>
        </>
      )}

      {isEngineer && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* loss waterfall */}
            <div className="panel">
              <div className="panel-title">
                Loss waterfall · {fmtW(result.losses.totalW)} total at 100% load
              </div>
              <LossWaterfall losses={result.losses} />
              <p className="mt-2 text-[11px] text-slate-500">
                Includes <Term k="zvs">ZVS</Term> switching loss and <Term k="coss">Coss</Term>{" "}
                energy where applicable.
              </p>
            </div>

            {/* efficiency vs load */}
            <div className="panel">
              <div className="panel-title">
                <Term k="efficiency-curve">Efficiency vs load</Term>
              </div>
              <EfficiencyChart points={result.efficiencyCurve} />
              <p className="mt-2 text-[11px] text-slate-500">
                Axis is zoomed to the data range to show curve shape, not 0–100% — a few tenths of
                a percent here can be real dollars at fleet scale (see Impact panel above).
              </p>
            </div>

            {/* device table */}
            <DeviceTable devices={result.devices} />

            {/* magnetics */}
            <MagneticsCards magnetics={result.magnetics} />

            {/* thermal */}
            <ThermalPanel thermal={result.thermal} />
          </div>

          {/* schematic */}
          <SchematicPanel svg={result.schematic.svg} />

          {/* BOM */}
          <BomPanel bom={result.bom} totalUsd={result.bomCostUsd} />

          {/* compliance */}
          <div id="compliance-panel">
            <CompliancePanel compliance={result.compliance} />
          </div>

          {/* firmware */}
          <FirmwarePanel firmware={result.firmware} />

          {/* layout guidance */}
          <LayoutPanel layout={result.layout} />

          {/* warnings strip */}
          <div id="warnings-strip">
            <WarningsStrip warnings={result.warnings} />
          </div>
        </>
      )}
    </div>
  );
}
