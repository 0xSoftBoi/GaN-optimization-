"use client";

/** Detail card for a hovered/clicked Pareto candidate. */

import Link from "next/link";
import type { DesignCandidateSummary } from "@/lib/types";
import { Term } from "@/components/ui/term";
import { formatUsd } from "@/lib/format";
import { fmtHz, fmtPct, fmtUsd } from "./format";
import { QUICK_LENS_DEFAULTS, candidateFleetEconomics } from "./pareto-logic";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value text-base">{value}</div>
    </div>
  );
}

/** Litres-at-5kW-style translation so "W/L" means something to a non-engineer. */
function densityHint(wPerL: number, poutW?: number): string | null {
  if (!poutW || !Number.isFinite(wPerL) || wPerL <= 0) return null;
  const liters = poutW / wPerL;
  const shown = liters >= 10 ? Math.round(liters) : Math.round(liters * 10) / 10;
  return `~${shown} L at ${poutW >= 1000 ? `${poutW / 1000} kW` : `${poutW} W`} — smaller box, less rack space`;
}

export default function CandidateCard({
  candidate,
  poutW,
  fleetUnits = 1,
}: {
  candidate: DesignCandidateSummary;
  /** Spec's rated output power — enables the density and $-lens translations. */
  poutW?: number;
  /** Fleet size for the $ lens; defaults to 1 unit when not supplied. */
  fleetUnits?: number;
}) {
  const c = candidate;
  const hint = densityHint(c.powerDensityWPerL, poutW);
  const lens = poutW ? candidateFleetEconomics(c, poutW, fleetUnits) : null;

  return (
    <div className="panel">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="panel-title mb-0">Candidate</h3>
        {c.pareto && c.feasible && (
          <span
            title="Best available trade-off — no feasible candidate beats it on every metric at once."
            className="cursor-help rounded border border-volt/40 bg-volt/10 px-1.5 py-0.5 text-[10px] font-semibold text-volt"
          >
            PARETO
          </span>
        )}
        {!c.feasible && (
          <span
            title="Violates a thermal or spec limit — not buildable as evaluated."
            className="cursor-help rounded border border-[#fb7185]/40 bg-[#fb7185]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#fb7185]"
          >
            INFEASIBLE
          </span>
        )}
        {c.feasible && !c.pareto && (
          <span
            title="Beaten by another candidate — something else is better on every metric at once."
            className="cursor-help rounded border border-slate-500/40 bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400"
          >
            DOMINATED
          </span>
        )}
      </div>
      <div className="mb-3 text-sm text-slate-300">
        <span className="text-slate-400">topology</span> {c.topologyId}
        <span className="mx-2 text-slate-500">·</span>
        <span className="text-slate-400">device</span> {c.deviceId}
        <span className="mx-2 text-slate-500">·</span>
        <span className="text-slate-400">
          <Term k="fsw">fsw</Term>
        </span>{" "}
        {fmtHz(c.fswHz)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Efficiency" value={fmtPct(c.efficiencyPct, 2)} />
        <Stat label="BOM cost" value={fmtUsd(c.bomCostUsd)} />
        <Stat
          label="Density"
          value={`${Math.round(c.powerDensityWPerL)} W/L`}
        />
      </div>
      {hint && <p className="mt-2 text-xs text-slate-400">{hint}</p>}

      {lens && (
        <div className="mt-3 border-t border-ink-700 pt-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">
              $ lens · {fleetUnits} unit{fleetUnits === 1 ? "" : "s"} · rated output
            </span>
            <Link href="/economics" className="text-[10px] text-volt hover:underline">
              full profile →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Fleet BOM total" value={formatUsd(lens.fleetBomTotalUsd)} />
            <Stat
              label="vs 96.5% baseline"
              value={
                <span className={lens.fleetAnnualSavingsVsBaselineUsd >= 0 ? "text-lime-400" : "text-[#fb7185]"}>
                  {lens.fleetAnnualSavingsVsBaselineUsd >= 0 ? "+" : ""}
                  {formatUsd(lens.fleetAnnualSavingsVsBaselineUsd)}/yr
                </span>
              }
            />
          </div>
          <p className="mt-1.5 text-[10px] text-slate-500">
            Assumes ${QUICK_LENS_DEFAULTS.pricePerMwhUsd}/MWh,{" "}
            {QUICK_LENS_DEFAULTS.hoursPerYear.toLocaleString("en-US")} h/yr, rated-output only —
            editable, profile-weighted numbers on the Economics page.
          </p>
        </div>
      )}
    </div>
  );
}
