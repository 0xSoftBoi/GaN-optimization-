"use client";

/**
 * /economics — the fleet calculator for energy traders and professionals.
 * Pick a converter (a preset, or the design you were just looking at
 * elsewhere on the site), set fleet-scale business assumptions, and see
 * what efficiency is worth in dollars, payback, and CO2 — no engineering
 * literacy required. "Open full engineering design" hands the same spec to
 * /design for anyone who wants the underlying physics.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CopilotParse, DesignSpec } from "@/lib/types";
import type { EconomicsAssumptions, EnergyEconomics } from "@/lib/economics";
import { formatEnergy, formatPct, formatUsd } from "@/lib/format";
import { STORAGE_KEY as WORKBENCH_STORAGE_KEY, encodeRequest } from "@/components/workbench/examples";
import { PersonaToggle } from "@/components/ui/persona";
import { Term } from "@/components/ui/term";
import { SavingsVsLoadChart, SavingsVsPriceChart } from "@/components/economics/charts";
import {
  DEFAULT_PRESET_ID,
  PRESETS,
  presetById,
  promptFromSession,
  specFromSession,
} from "@/components/economics/presets";

const SESSION_ID = "session";
const HOURS_PRESETS = [
  { label: "24/7 (8760 h)", value: 8760 },
  { label: "Business hours (2500 h)", value: 2500 },
  { label: "Half year (4380 h)", value: 4380 },
];
const FLEET_PRESETS = [10, 50, 200, 1000];

interface EconomicsResponse {
  design: {
    name?: string;
    topologyId: string;
    fswHz: number;
    poutW: number;
    efficiencyPct: number;
    bomCostUsd: number;
  };
  assumptions: EconomicsAssumptions;
  economics: EnergyEconomics;
}

function fmtMonths(months: number | null): string {
  if (months === null) return "never — design underperforms baseline";
  if (months < 1) return "< 1 month";
  const years = months / 12;
  return years >= 1 ? `${Math.round(months)} mo (~${years.toFixed(1)} yr)` : `${Math.round(months)} mo`;
}

export default function EconomicsPage() {
  const router = useRouter();

  const [sessionSpec, setSessionSpec] = useState<DesignSpec | null>(null);
  const [resolvingSession, setResolvingSession] = useState(false);
  const [presetChoice, setPresetChoice] = useState<string>(DEFAULT_PRESET_ID);

  // Editable assumptions — start at the module's documented defaults;
  // overwritten once from the first server response so the UI never drifts
  // from the single source of truth in @/lib/economics.
  const [pricePerMwhUsd, setPricePerMwhUsd] = useState(70);
  const [hoursPerYear, setHoursPerYear] = useState(8760);
  const [baselineEfficiencyPct, setBaselineEfficiencyPct] = useState(96.5);
  const [fleetUnits, setFleetUnits] = useState(1);
  const [horizonYears, setHorizonYears] = useState(5);
  const [carbonKgPerMwh, setCarbonKgPerMwh] = useState(350);
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<EconomicsResponse | null>(null);

  // Pull a spec from the cross-page hand-off (landing / /design / /optimize),
  // same sessionStorage contract /design reads. A {prompt} hand-off needs
  // one /api/copilot resolve first.
  useEffect(() => {
    const spec = specFromSession();
    if (spec) {
      setSessionSpec(spec);
      setPresetChoice(SESSION_ID);
      return;
    }
    const prompt = promptFromSession();
    if (!prompt) return;
    setResolvingSession(true);
    fetch("/api/copilot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ parse: CopilotParse }>) : null))
      .then((body) => {
        if (body?.parse.spec) {
          setSessionSpec(body.parse.spec);
          setPresetChoice(SESSION_ID);
        }
      })
      .catch(() => {
        // No usable hand-off — the preset dropdown default still works.
      })
      .finally(() => setResolvingSession(false));
  }, []);

  const selectedSpec: DesignSpec | null = useMemo(() => {
    if (presetChoice === SESSION_ID) return sessionSpec;
    return presetById(presetChoice)?.spec ?? PRESETS[0].spec;
  }, [presetChoice, sessionSpec]);

  const run = async (opts: { useServerDefaults: boolean }) => {
    if (!selectedSpec) return;
    setBusy(true);
    setError(null);
    try {
      const body: { spec: DesignSpec; assumptions?: Partial<EconomicsAssumptions> } = {
        spec: selectedSpec,
      };
      if (!opts.useServerDefaults) {
        body.assumptions = {
          pricePerMwhUsd,
          hoursPerYear,
          baselineEfficiencyPct,
          fleetUnits,
          horizonYears,
          carbonKgPerMwh,
        };
      }
      const res = await fetch("/api/economics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const o = (json ?? {}) as { error?: string; details?: string[] };
        const detail = o.details?.length ? ` — ${o.details.join("; ")}` : "";
        throw new Error((o.error ?? `HTTP ${res.status}`) + detail);
      }
      const r = json as EconomicsResponse;
      setResponse(r);
      if (!defaultsLoaded) {
        setPricePerMwhUsd(r.assumptions.pricePerMwhUsd);
        setHoursPerYear(r.assumptions.hoursPerYear);
        setBaselineEfficiencyPct(r.assumptions.baselineEfficiencyPct);
        setFleetUnits(r.assumptions.fleetUnits);
        setHorizonYears(r.assumptions.horizonYears);
        setCarbonKgPerMwh(r.assumptions.carbonKgPerMwh);
        setDefaultsLoaded(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Run once the spec is known/changes (initial load + preset switch).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedSpec) void run({ useServerDefaults: !defaultsLoaded });
    // Only the spec identity should trigger an auto-run; assumption edits
    // go through the explicit "Recalculate" button below.
  }, [selectedSpec]);

  const openInWorkbench = () => {
    if (!selectedSpec) return;
    try {
      sessionStorage.setItem(WORKBENCH_STORAGE_KEY, encodeRequest({ spec: selectedSpec }));
    } catch {
      // Private mode without storage — still navigate; /design falls back to its demo spec.
    }
    router.push("/design");
  };

  const eco = response?.economics ?? null;
  const fleetMwhPerYear = eco ? eco.annualMwhPerUnit * fleetUnits : null;
  const loadRows = useMemo(
    () =>
      (eco?.loadProfileBreakdown ?? []).map((r) => ({
        loadPct: r.loadPct,
        weightFrac: r.weightFrac,
        usd: r.annualUsdSavedPerUnit * fleetUnits,
      })),
    [eco, fleetUnits],
  );

  const activePreset = presetChoice === SESSION_ID ? null : presetById(presetChoice);

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-400">
        <Link href="/" className="hover:text-volt">
          Home
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-300">Fleet economics</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Fleet economics</h1>
          <p className="text-xs text-slate-400">
            What is 1% efficiency worth to your fleet? Set your own price, load and fleet
            size — every number below traces back to the design engine, not a market claim.
          </p>
        </div>
        <PersonaToggle />
      </div>

      {/* Converter picker */}
      <div className="panel">
        <h2 className="panel-title">Converter</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[16rem] grow sm:max-w-md">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">
              Preset or your last design
            </span>
            <select
              className="input"
              value={presetChoice}
              onChange={(e) => setPresetChoice(e.target.value)}
              disabled={resolvingSession}
            >
              {sessionSpec && (
                <option value={SESSION_ID}>
                  Your last design — {sessionSpec.name ?? `${sessionSpec.poutW} W`}
                </option>
              )}
              {resolvingSession && <option value={SESSION_ID}>Resolving your last design…</option>}
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="max-w-sm pb-2 text-xs text-slate-400">
            {presetChoice === SESSION_ID
              ? "Pulled from the design you were just looking at."
              : (activePreset?.blurb ?? "")}
          </p>
        </div>
      </div>

      {/* Assumptions — editable inputs */}
      <div className="panel border-[#f59e0b]/30">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="panel-title mb-0">Your assumptions</h2>
          <span className="text-[10px] uppercase tracking-wider text-[#f59e0b]">
            editable — not market data
          </span>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Every number here is a starting point you can change. See{" "}
          <Link href="/docs#economics-methodology" className="text-volt hover:underline">
            Economics methodology
          </Link>{" "}
          for typical published ranges and sources.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-slate-400">
              <span>Energy price</span>
              <span className="text-slate-300">${pricePerMwhUsd}/MWh</span>
            </span>
            <input
              type="range"
              min={30}
              max={200}
              step={1}
              value={pricePerMwhUsd}
              onChange={(e) => setPricePerMwhUsd(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">
              Hours / year
            </span>
            <input
              className="input"
              type="number"
              min={1}
              max={8784}
              value={hoursPerYear}
              onChange={(e) => setHoursPerYear(Number(e.target.value) || 1)}
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {HOURS_PRESETS.map((h) => (
                <button
                  key={h.label}
                  type="button"
                  className="rounded border border-ink-600 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-volt/50 hover:text-volt"
                  onClick={() => setHoursPerYear(h.value)}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">
              Baseline efficiency (%)
            </span>
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              step={0.1}
              value={baselineEfficiencyPct}
              onChange={(e) => setBaselineEfficiencyPct(Number(e.target.value) || 1)}
            />
            <p className="mt-1 text-[10px] text-slate-500">
              What you compare against — default is a flat 96.5% titanium-class reference.
            </p>
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">
              Fleet units
            </span>
            <input
              className="input"
              type="number"
              min={1}
              step={1}
              value={fleetUnits}
              onChange={(e) => setFleetUnits(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {FLEET_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="rounded border border-ink-600 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-volt/50 hover:text-volt"
                  onClick={() => setFleetUnits(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">
              Horizon (years)
            </span>
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={horizonYears}
              onChange={(e) => setHorizonYears(Number(e.target.value) || 1)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">
              Carbon intensity (kg CO2/MWh)
            </span>
            <input
              className="input"
              type="number"
              min={0}
              value={carbonKgPerMwh}
              onChange={(e) => setCarbonKgPerMwh(Math.max(0, Number(e.target.value) || 0))}
            />
            <p className="mt-1 text-[10px] text-slate-500">Grid-average; set it to your region.</p>
          </label>
        </div>

        <button
          type="button"
          className="btn mt-4"
          onClick={() => void run({ useServerDefaults: false })}
          disabled={busy || !selectedSpec}
        >
          {busy ? "Recalculating…" : "Recalculate"}
        </button>
      </div>

      {error && (
        <div className="panel border-[#fb7185]/40 text-sm text-[#fb7185]">
          The economics engine could not price this converter.
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-[#fb7185]/80">technical details</summary>
            <p className="mt-1 text-xs text-[#fb7185]/70">{error}</p>
          </details>
        </div>
      )}

      {!eco && busy && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="stat">
              <div className="stat-label">·</div>
              <div className="h-5 w-16 animate-pulse rounded bg-ink-700/70" />
            </div>
          ))}
        </div>
      )}

      {eco && response && (
        <>
          {/* Headline cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="stat">
              <div className="stat-label">Fleet $/yr saved</div>
              <div
                className={`stat-value text-base ${eco.fleetAnnualUsdSaved >= 0 ? "text-lime-400" : "text-[#fb7185]"}`}
              >
                {formatUsd(eco.fleetAnnualUsdSaved)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">{horizonYears}-yr fleet savings</div>
              <div
                className={`stat-value text-base ${eco.fleetHorizonUsdSaved >= 0 ? "text-lime-400" : "text-[#fb7185]"}`}
              >
                {formatUsd(eco.fleetHorizonUsdSaved)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">
                <Term k="payback">Payback</Term>
              </div>
              <div className="stat-value text-base">{fmtMonths(eco.paybackMonths)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">CO2 avoided / yr</div>
              <div
                className={`stat-value text-base ${eco.co2SavedTonnesPerYear >= 0 ? "text-lime-400" : "text-[#fb7185]"}`}
              >
                {eco.co2SavedTonnesPerYear >= 0 ? "" : "-"}
                {Math.abs(eco.co2SavedTonnesPerYear).toLocaleString("en-US", { maximumFractionDigits: 1 })} t
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Weighted efficiency</div>
              <div className="stat-value text-base">
                {formatPct(eco.weightedEfficiencyPct, 2)}
                <span className="ml-1 text-xs font-normal text-slate-400">
                  vs {formatPct(eco.baselineWeightedPct, 1)}
                </span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Fleet energy / yr</div>
              <div className="stat-value text-base">
                {fleetMwhPerYear !== null ? formatEnergy(fleetMwhPerYear) : "—"}
              </div>
            </div>
          </div>

          <div className="panel flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              {response.design.topologyId} · {formatPct(response.design.efficiencyPct, 2)} rated ·{" "}
              <Term k="bom">BOM</Term> {formatUsd(response.design.bomCostUsd)}/unit ·{" "}
              {fleetUnits} unit{fleetUnits === 1 ? "" : "s"}
            </p>
            <button type="button" className="btn" onClick={openInWorkbench}>
              Open full engineering design →
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="panel">
              <h2 className="panel-title">Savings vs energy price</h2>
              <SavingsVsPriceChart points={eco.sensitivity} currentPriceUsd={pricePerMwhUsd} />
            </div>
            <div className="panel">
              <h2 className="panel-title">Savings by load profile</h2>
              <SavingsVsLoadChart rows={loadRows} />
              <p className="mt-1 text-[10px] text-slate-500">
                Default duty cycle weights hours toward 60–90% load, typical of a
                well-utilized rack power system — edit the horizon/price assumptions above;
                see <Link href="/docs#economics-methodology" className="text-volt hover:underline">methodology</Link> for the full profile.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
