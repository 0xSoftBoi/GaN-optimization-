"use client";

/**
 * Pareto-explorer scatter: efficiency (y) vs BOM cost (x), point area ∝
 * power density. Volt-cyan = Pareto front (connected), slate = dominated,
 * rose ring = infeasible. Hand-rolled inline SVG.
 */

import { useMemo, useState } from "react";
import type { DesignCandidateSummary } from "@/lib/types";
import { Term } from "@/components/ui/term";
import { fmtHz, fmtPct, fmtUsd } from "./format";
import {
  candidateKey,
  groupCandidates,
  linScale,
  niceTicks,
  paddedExtent,
  radiusForDensity,
} from "./pareto-logic";

const SURFACE = "#11161f";
const GRID = "#243044";
const TEXT = "#94a3b8";
const TEXT_DIM = "#64748b";
const VOLT = "#22d3ee";
const SLATE = "#475569";
const ROSE = "#fb7185";

const W = 640;
const H = 400;
const M = { top: 14, right: 18, bottom: 46, left: 58 };

export default function ParetoChart({
  candidates,
  selectedKey,
  onHover,
  onSelect,
}: {
  candidates: DesignCandidateSummary[];
  selectedKey: string | null;
  onHover: (c: DesignCandidateSummary | null) => void;
  onSelect: (c: DesignCandidateSummary) => void;
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const model = useMemo(() => {
    const groups = groupCandidates(candidates);
    const costs = candidates.map((c) => c.bomCostUsd);
    const effs = candidates.map((c) => c.efficiencyPct);
    const dens = candidates.map((c) => c.powerDensityWPerL);
    const [x0, x1] = paddedExtent(costs);
    const [y0, y1] = paddedExtent(effs);
    const dMin = Math.min(...dens);
    const dMax = Math.max(...dens);
    const sx = linScale(x0, x1, M.left, W - M.right);
    const sy = linScale(y0, y1, H - M.bottom, M.top); // SVG y grows downward
    return {
      groups,
      sx,
      sy,
      dMin,
      dMax,
      xTicks: niceTicks(x0, x1),
      yTicks: niceTicks(y0, y1),
    };
  }, [candidates]);

  if (candidates.length === 0) return null;
  const { groups, sx, sy, dMin, dMax, xTicks, yTicks } = model;

  const hovered = hoverKey
    ? candidates.find((c) => candidateKey(c) === hoverKey) ?? null
    : null;

  const enter = (c: DesignCandidateSummary) => {
    setHoverKey(candidateKey(c));
    onHover(c);
  };
  const leave = () => {
    setHoverKey(null);
    onHover(null);
  };

  const drawPoint = (c: DesignCandidateSummary) => {
    const k = candidateKey(c);
    const r = radiusForDensity(c.powerDensityWPerL, dMin, dMax);
    const cx = sx(c.bomCostUsd);
    const cy = sy(c.efficiencyPct);
    const active = k === hoverKey || k === selectedKey;
    return (
      <g key={k}>
        {c.feasible ? (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill={c.pareto ? VOLT : SLATE}
            stroke={SURFACE}
            strokeWidth={2}
          />
        ) : (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={ROSE} strokeWidth={2} />
        )}
        {active && (
          <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={VOLT} strokeWidth={1.5} />
        )}
        {/* Oversized invisible hit target for hover/click. */}
        <circle
          cx={cx}
          cy={cy}
          r={Math.max(r + 5, 11)}
          fill="transparent"
          className="cursor-pointer"
          onMouseEnter={() => enter(c)}
          onMouseLeave={leave}
          onClick={() => onSelect(c)}
        />
      </g>
    );
  };

  // Tooltip near the hovered point, flipped when close to an edge. Width is
  // sized from the longest line (the app renders in a monospace font, so a
  // per-character estimate is accurate) instead of a fixed guess that
  // overflows for long device ids.
  let tip: React.ReactNode = null;
  if (hovered) {
    const line1 = `${hovered.deviceId} · ${fmtHz(hovered.fswHz)}`;
    const line2 = `${hovered.topologyId} · ${fmtPct(hovered.efficiencyPct, 2)}`;
    const line3 = `${fmtUsd(hovered.bomCostUsd)} · ${Math.round(hovered.powerDensityWPerL)} W/L`;
    const maxChars = Math.max(line1.length, line2.length, line3.length);
    const cx = sx(hovered.bomCostUsd);
    const cy = sy(hovered.efficiencyPct);
    const tw = Math.min(280, Math.max(190, maxChars * 7 + 16));
    const th = 52;
    const tx = Math.min(Math.max(cx + tw + 14 > W - M.right ? cx - tw - 12 : cx + 12, M.left), W - M.right - tw);
    const ty = cy - th - 10 < M.top ? cy + 10 : cy - th - 10;
    tip = (
      <g pointerEvents="none">
        <rect x={tx} y={ty} width={tw} height={th} rx={4} fill="#0a0e14" stroke={GRID} />
        <text x={tx + 8} y={ty + 16} fontSize={12} fill="#e2e8f0">
          {line1}
        </text>
        <text x={tx + 8} y={ty + 31} fontSize={12} fill={TEXT}>
          {line2}
        </text>
        <text x={tx + 8} y={ty + 46} fontSize={12} fill={TEXT}>
          {line3}
        </text>
      </g>
    );
  }

  return (
    <div>
      {/* Legend — identity never rides on color alone; shapes differ too. */}
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="5" fill={VOLT} />
          </svg>
          <Term k="pareto">Pareto front</Term>
        </span>
        <span title="Beaten by another candidate" className="inline-flex cursor-help items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="5" fill={SLATE} />
          </svg>
          dominated
        </span>
        <span
          title="Violates a thermal or spec limit"
          className="inline-flex cursor-help items-center gap-1.5"
        >
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill="none" stroke={ROSE} strokeWidth="2" />
          </svg>
          infeasible
        </span>
        <span className="text-slate-400">point size ∝ power density (bigger = more W per liter)</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Scatter of candidate designs: efficiency versus BOM cost"
        onMouseLeave={leave}
      >
        {/* gridlines */}
        {yTicks.map((t) => (
          <line
            key={`gy${t}`}
            x1={M.left}
            x2={W - M.right}
            y1={sy(t)}
            y2={sy(t)}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
        {xTicks.map((t) => (
          <line
            key={`gx${t}`}
            x1={sx(t)}
            x2={sx(t)}
            y1={M.top}
            y2={H - M.bottom}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}

        {/* Pareto front connector under the points */}
        {groups.front.length >= 2 && (
          <polyline
            points={groups.front
              .map((c) => `${sx(c.bomCostUsd)},${sy(c.efficiencyPct)}`)
              .join(" ")}
            fill="none"
            stroke={VOLT}
            strokeWidth={2}
            strokeOpacity={0.45}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* dominated first (visually behind), then infeasible, then front */}
        {groups.dominated.map(drawPoint)}
        {groups.infeasible.map(drawPoint)}
        {groups.front.map(drawPoint)}

        {/* axes */}
        <line
          x1={M.left}
          x2={W - M.right}
          y1={H - M.bottom}
          y2={H - M.bottom}
          stroke={GRID}
          strokeWidth={1}
        />
        <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} stroke={GRID} strokeWidth={1} />
        {xTicks.map((t) => (
          <text
            key={`tx${t}`}
            x={sx(t)}
            y={H - M.bottom + 16}
            fontSize={12}
            fill={TEXT_DIM}
            textAnchor="middle"
          >
            {t >= 1000 ? `${(t / 1000).toLocaleString("en-US")}k` : t}
          </text>
        ))}
        {yTicks.map((t) => (
          <text
            key={`ty${t}`}
            x={M.left - 8}
            y={sy(t) + 4}
            fontSize={12}
            fill={TEXT_DIM}
            textAnchor="end"
          >
            {t}
          </text>
        ))}
        <text
          x={(M.left + W - M.right) / 2}
          y={H - 8}
          fontSize={12}
          fill={TEXT}
          textAnchor="middle"
        >
          BOM cost (USD)
        </text>
        <text
          transform={`rotate(-90 14 ${(M.top + H - M.bottom) / 2})`}
          x={14}
          y={(M.top + H - M.bottom) / 2}
          fontSize={12}
          fill={TEXT}
          textAnchor="middle"
        >
          Efficiency (%)
        </text>

        {tip}
      </svg>
    </div>
  );
}
