"use client";

/**
 * /optimize — the Pareto explorer. Compact spec form (defaults = the 5 kW
 * flagship example) → POST /api/optimize → efficiency-vs-cost scatter with
 * the Pareto front highlighted, candidate detail card, and a hand-off into
 * the design workbench.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DesignCandidateSummary, DesignSpec } from "@/lib/types";
import type { EnergyEconomics } from "@/lib/economics";
import { formatUsd } from "@/lib/format";
import CandidateCard from "@/components/explore/CandidateCard";
import ParetoChart from "@/components/explore/ParetoChart";
import SpecForm from "@/components/explore/SpecForm";
import { Term } from "@/components/ui/term";
import { fmtHz, fmtPct, fmtUsd } from "@/components/explore/format";
import { STORAGE_KEY, encodeRequest } from "@/components/workbench";
import {
  DEFAULT_SPEC,
  QUICK_LENS_DEFAULTS,
  candidateFleetEconomics,
  candidateKey,
  cheapestFeasible,
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
  /** Fleet size for the $ lens — purely a display-time multiplier, no re-run needed. */
  const [fleetUnits, setFleetUnits] = useState(1);
  /**
   * Per-unit economics of the winning design at default assumptions — one
   * /api/economics call per run ("the one-line economics call"). Per-unit
   * figures are fleet-independent, so `fleetUnits` scales them live below
   * without another request.
   */
  const [winnerEconomics, setWinnerEconomics] = useState<EnergyEconomics | null>(null);

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
    setWinnerEconomics(null);
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

      // $ lens: one economics call at default assumptions for the winning
      // design. Best-effort — a failure here never blocks the Pareto result.
      fetch("/api/economics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec: v.spec }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ economics: EnergyEconomics }>) : null))
        .then((body) => setWinnerEconomics(body?.economics ?? null))
        .catch(() => setWinnerEconomics(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openInWorkbench = () => {
    if (!ranSpec) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, encodeRequest({ spec: ranSpec }));
    } catch {
      // Storage may be unavailable (private mode) — still navigate.
    }
    router.push("/design");
  };

  const groups = useMemo(
    () => (result ? groupCandidates(result.candidates) : null),
    [result],
  );

  const cheapest = useMemo(
    () => (result ? cheapestFeasible(result.candidates) : null),
    [result],
  );

  const shown = hovered ?? selected;
  const poutW = ranSpec?.poutW;

  const shownLens =
    shown && poutW !== undefined ? candidateFleetEconomics(shown, poutW, fleetUnits) : null;
  const cheapestLens =
    cheapest && poutW !== undefined ? candidateFleetEconomics(cheapest, poutW, fleetUnits) : null;
  const lossDeltaVsCheapest =
    shownLens && cheapestLens
      ? shownLens.fleetAnnualLossCostUsd - cheapestLens.fleetAnnualLossCostUsd
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold text-slate-100">Pareto Explorer</h1>
        <span className="text-xs text-slate-400">
          topology × device × <Term k="fsw">fsw</Term> sweep — efficiency vs cost vs density
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
        <div className="panel flex items-center gap-3 text-sm text-slate-400">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-volt border-t-transparent" />
          sweeping topologies × devices × switching frequencies…
        </div>
      )}
      {error && (
        <div className="panel border-[#fb7185]/40 text-sm text-[#fb7185]">
          The optimizer could not complete this sweep.
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-[#fb7185]/80">technical details</summary>
            <p className="mt-1 text-xs text-[#fb7185]/70">{error}</p>
          </details>
        </div>
      )}

      {result && groups && !busy && (
        <>
          {/* Headline summary */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
              <div className="stat-label">
                <Term k="fsw">fsw</Term>
              </div>
              <div className="stat-value text-base">{fmtHz(result.bestSummary.fswHz)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Candidates</div>
              <div className="stat-value text-base">
                {result.candidates.length}
                <span className="ml-1 text-xs text-slate-400">
                  (
                  <Term k="pareto">
                    <span title="Best available trade-off">{groups.front.length} pareto</span>
                  </Term>{" "}
                  ·{" "}
                  <span title="Violates a thermal or spec limit">
                    {groups.infeasible.length} infeasible
                  </span>
                  )
                </span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">
                Fleet $/yr saved <span className="text-slate-500">· assumption — edit</span>
              </div>
              <div className="stat-value text-base">
                {winnerEconomics ? (
                  <span
                    className={
                      winnerEconomics.annualUsdSavedPerUnit * fleetUnits >= 0
                        ? "text-lime-400"
                        : "text-[#fb7185]"
                    }
                  >
                    {formatUsd(winnerEconomics.annualUsdSavedPerUnit * fleetUnits)}
                  </span>
                ) : (
                  <span className="text-slate-500">…</span>
                )}
              </div>
            </div>
          </div>

          {/* Fleet $ lens controls */}
          <div className="panel flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span className="uppercase tracking-wider">Fleet units</span>
              <input
                className="input w-24"
                type="number"
                min={1}
                step={1}
                value={fleetUnits}
                onChange={(e) => setFleetUnits(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              />
            </label>
            <p className="text-xs text-slate-500">
              Scales the $ lens on the candidate card and winner panel below — no re-run needed.
              Winner savings vs a 96.5% baseline, profile-weighted; see{" "}
              <Term k="tco">TCO</Term> and payback for the full fleet on the{" "}
              <Link href="/economics" className="text-volt hover:underline">
                Economics
              </Link>{" "}
              page.
            </p>
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
              <div aria-live="polite" aria-atomic="true">
                {shown ? (
                  <CandidateCard candidate={shown} poutW={poutW} fleetUnits={fleetUnits} />
                ) : (
                  <div className="panel text-sm text-slate-500">
                    hover or click a point to inspect the candidate
                  </div>
                )}
              </div>

              {shown && cheapest && lossDeltaVsCheapest !== null && (
                <div className="panel">
                  <h2 className="panel-title">vs cheapest feasible · {cheapest.deviceId}</h2>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="stat">
                      <div className="stat-label">Cheapest BOM (fleet)</div>
                      <div className="stat-value text-base">
                        {formatUsd(cheapest.bomCostUsd * fleetUnits)}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">Annual loss $ delta</div>
                      <div
                        className={`stat-value text-base ${lossDeltaVsCheapest <= 0 ? "text-lime-400" : "text-[#fb7185]"}`}
                      >
                        {lossDeltaVsCheapest >= 0 ? "+" : ""}
                        {formatUsd(lossDeltaVsCheapest)}/yr
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">
                    Fleet-wide annual loss-cost difference between the shown candidate and the
                    cheapest feasible one, at ${QUICK_LENS_DEFAULTS.pricePerMwhUsd}/MWh rated
                    output — negative means the shown candidate wastes less energy.
                  </p>
                </div>
              )}

              <div className="panel">
                <h2 className="panel-title">Winner · {result.bestSummary.deviceId}</h2>
                <p className="mb-3 text-xs text-slate-400">
                  Full design (losses, magnetics, thermal, schematic, <Term k="bom">BOM</Term>,
                  firmware, compliance) is one click away — same spec, same engine run.
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
