"use client";

/** Detail card for a hovered/clicked Pareto candidate. */

import type { DesignCandidateSummary } from "@/lib/types";
import { fmtHz, fmtPct, fmtUsd } from "./format";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value text-base">{value}</div>
    </div>
  );
}

export default function CandidateCard({ candidate }: { candidate: DesignCandidateSummary }) {
  const c = candidate;
  return (
    <div className="panel">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="panel-title mb-0">Candidate</h3>
        {c.pareto && c.feasible && (
          <span className="rounded border border-volt/40 bg-volt/10 px-1.5 py-0.5 text-[10px] font-semibold text-volt">
            PARETO
          </span>
        )}
        {!c.feasible && (
          <span className="rounded border border-[#fb7185]/40 bg-[#fb7185]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#fb7185]">
            INFEASIBLE
          </span>
        )}
        {c.feasible && !c.pareto && (
          <span className="rounded border border-slate-500/40 bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
            DOMINATED
          </span>
        )}
      </div>
      <div className="mb-3 text-sm text-slate-300">
        <span className="text-slate-500">topology</span> {c.topologyId}
        <span className="mx-2 text-slate-600">·</span>
        <span className="text-slate-500">device</span> {c.deviceId}
        <span className="mx-2 text-slate-600">·</span>
        <span className="text-slate-500">fsw</span> {fmtHz(c.fswHz)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Efficiency" value={fmtPct(c.efficiencyPct, 2)} />
        <Stat label="BOM cost" value={fmtUsd(c.bomCostUsd)} />
        <Stat label="Density" value={`${Math.round(c.powerDensityWPerL)} W/L`} />
      </div>
    </div>
  );
}
