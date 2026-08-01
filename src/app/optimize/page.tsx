"use client";

/**
 * /optimize — the Pareto explorer. Compact spec form (defaults = the 5 kW
 * flagship example) → POST /api/optimize → efficiency-vs-cost scatter with
 * the Pareto front highlighted, candidate detail card, and a hand-off into
 * the design workbench.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DesignCandidateSummary, DesignSpec } from "@/lib/types";
import CandidateCard from "@/components/explore/CandidateCard";
import ParetoChart from "@/components/explore/ParetoChart";
import SpecForm from "@/components/explore/SpecForm";
import { fmtHz, fmtPct, fmtUsd } from "@/components/explore/format";
import {
  DEFAULT_SPEC,
  SPEC_STORAGE_KEY,
  candidateKey,
  formStateFromSpec,
  groupCandidates,
  specFromForm,
  type OptimizeResponse,
  type SpecFormState,
} from "@/components/explore/pareto-logic";

export default function ParetoExplorerPage() {
  const router = useRouter();
  const [form, setForm] = useState<SpecFormState>(() => formStateFromSpec(DEFAULT_SPEC));
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  /** The spec the shown result was computed from (for the workbench hand-off). */
  const [ranSpec, setRanSpec] = useState<DesignSpec | null>(null);
  const [hovered, setHovered] = useState<DesignCandidateSummary | null>(null);
  const [selected, setSelected] = useState<DesignCandidateSummary | null>(null);

  const run = async () => {
    const v = specFromForm(form);
    if (!v.ok) {
      setFormErrors(v.errors);
      return;
    }
    setFormErrors([]);
    setBusy(true);
    setError(null);
    setSelected(null);
    setHovered(null);
    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec: v.spec }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; details?: string[] }
          | null;
        throw new Error(
          body?.details?.length ? `${body.error}: ${body.details.join("; ")}` : body?.error ?? `HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as OptimizeResponse;
      setResult(data);
      setRanSpec(v.spec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openInWorkbench = () => {
    if (!ranSpec) return;
    try {
      window.localStorage.setItem(SPEC_STORAGE_KEY, JSON.stringify(ranSpec));
    } catch {
      // Storage may be unavailable (private mode) — still navigate.
    }
    router.push("/design");
  };

  const groups = useMemo(
    () => (result ? groupCandidates(result.candidates) : null),
    [result],
  );

  const shown = hovered ?? selected;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold text-slate-100">Pareto Explorer</h1>
        <span className="text-xs text-slate-500">
          topology × device × fsw sweep — efficiency vs cost vs density
        </span>
      </div>

      <div className="panel">
        <h2 className="panel-title">Design spec</h2>
        <SpecForm value={form} onChange={setForm} onSubmit={() => void run()} busy={busy} />
        {formErrors.length > 0 && (
          <ul className="mt-3 list-inside list-disc text-xs text-[#fb7185]">
            {formErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      {busy && (
        <div className="panel text-sm text-slate-500">
          sweeping topologies × devices × switching frequencies…
        </div>
      )}
      {error && (
        <div className="panel border-[#fb7185]/40 text-sm text-[#fb7185]">
          optimizer failed: {error}
        </div>
      )}

      {result && groups && !busy && (
        <>
          {/* Headline summary */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="stat">
              <div className="stat-label">Best topology</div>
              <div className="stat-value text-base">{result.bestSummary.topologyId}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Efficiency</div>
              <div className="stat-value text-base">
                {fmtPct(result.bestSummary.efficiencyPct, 2)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">BOM cost</div>
              <div className="stat-value text-base">{fmtUsd(result.bestSummary.bomCostUsd)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">fsw</div>
              <div className="stat-value text-base">{fmtHz(result.bestSummary.fswHz)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Candidates</div>
              <div className="stat-value text-base">
                {result.candidates.length}
                <span className="ml-1 text-xs text-slate-500">
                  ({groups.front.length} pareto · {groups.infeasible.length} infeasible)
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="panel lg:col-span-2">
              <h2 className="panel-title">Efficiency vs BOM cost</h2>
              <ParetoChart
                candidates={result.candidates}
                selectedKey={selected ? candidateKey(selected) : null}
                onHover={setHovered}
                onSelect={setSelected}
              />
            </div>
            <div className="space-y-4">
              {shown ? (
                <CandidateCard candidate={shown} />
              ) : (
                <div className="panel text-sm text-slate-500">
                  hover or click a point to inspect the candidate
                </div>
              )}
              <div className="panel">
                <h2 className="panel-title">Winner · {result.bestSummary.deviceId}</h2>
                <p className="mb-3 text-xs text-slate-500">
                  Full design (losses, magnetics, thermal, schematic, BOM, firmware,
                  compliance) is one click away — same spec, same engine run.
                </p>
                <button type="button" className="btn w-full justify-center" onClick={openInWorkbench}>
                  Open in workbench →
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {!result && !busy && !error && (
        <div className="panel text-sm text-slate-500">
          Run the optimizer to explore the candidate space. The defaults are the
          flagship example: 5 kW bidirectional, 800 V bus → 48 V rack, forced air,
          40 °C ambient.
        </div>
      )}
    </div>
  );
}
