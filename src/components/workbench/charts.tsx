"use client";

/**
 * Workbench charts — hand-rolled inline SVG, no chart libs.
 *
 * Style contract (dataviz skill + project fallback rules):
 *  - volt-cyan #22d3ee for the primary series, one hue per series
 *  - gridlines #243044 hairline solid, labels #94a3b8 at 12px+
 *  - bars ≤ 24px with 4px rounded data end, square baseline
 *  - lines 2px, markers r≥4 with a 2px surface ring
 *  - selective direct labels (bar tips / line endpoint); native <title>
 *    tooltips carry the rest — the tables elsewhere on the page are the
 *    accessible twin, so tooltips never gate a value.
 */

import type { EfficiencyPoint, LossBreakdown } from "@/lib/types";
import {
  barPath,
  fmtW,
  lossSegments,
  niceDomainTicks,
  niceTicks,
  scaleLinear,
} from "./format";

const GRID = "#243044";
const LABEL = "#94a3b8";
const VOLT = "#22d3ee";
const SURFACE = "#11161f"; // ink-800 panel surface

// ---------------------------------------------------------------------------
// Loss waterfall — horizontal bars, one per mechanism
// ---------------------------------------------------------------------------

export function LossWaterfall({ losses }: { losses: LossBreakdown }) {
  const segs = lossSegments(losses);
  const maxW = Math.max(...segs.map((s) => s.w), 1e-3);
  const ticks = niceTicks(0, maxW, 5);

  const W = 600;
  const left = 104;
  const right = 64;
  const top = 8;
  const rowH = 27;
  const barH = 14;
  const axisH = 40;
  const H = top + segs.length * rowH + axisH;
  const plotW = W - left - right;
  const x = (v: number) => left + scaleLinear(v, 0, maxW, 0, plotW);
  const axisY = top + segs.length * rowH;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Loss breakdown by mechanism, watts"
    >
      {/* vertical gridlines */}
      {ticks.map((t) => (
        <line
          key={`g${t}`}
          x1={x(t)}
          y1={top}
          x2={x(t)}
          y2={axisY}
          stroke={GRID}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ))}
      {/* bars + row labels + tip values */}
      {segs.map((s, i) => {
        const y = top + i * rowH + (rowH - barH) / 2;
        const w = Math.max(0, x(s.w) - left);
        return (
          <g key={s.key}>
            <title>{`${s.label}: ${fmtW(s.w)}`}</title>
            {/* oversized transparent hit target for hover */}
            <rect x={0} y={top + i * rowH} width={W} height={rowH} fill="transparent" />
            <text
              x={left - 8}
              y={y + barH / 2 + 4}
              textAnchor="end"
              fontSize={12}
              fill={LABEL}
            >
              {s.label}
            </text>
            {w > 0.5 ? (
              <path d={barPath(left, y, w, barH)} fill={VOLT} />
            ) : (
              <line
                x1={left}
                y1={y}
                x2={left}
                y2={y + barH}
                stroke={VOLT}
                strokeWidth={1}
              />
            )}
            <text
              x={x(s.w) + 6}
              y={y + barH / 2 + 4}
              fontSize={12}
              fill={LABEL}
            >
              {fmtW(s.w)}
            </text>
          </g>
        );
      })}
      {/* x axis */}
      <line
        x1={left}
        y1={axisY}
        x2={W - right}
        y2={axisY}
        stroke={GRID}
        strokeWidth={1}
        shapeRendering="crispEdges"
      />
      {ticks.map((t) => (
        <text
          key={`t${t}`}
          x={x(t)}
          y={axisY + 16}
          textAnchor="middle"
          fontSize={12}
          fill={LABEL}
        >
          {t}
        </text>
      ))}
      <text
        x={left + plotW / 2}
        y={H - 6}
        textAnchor="middle"
        fontSize={12}
        fill={LABEL}
      >
        Loss (W)
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Efficiency vs load — single-series line (no legend needed for one series)
// ---------------------------------------------------------------------------

export function EfficiencyChart({ points }: { points: EfficiencyPoint[] }) {
  const pts = [...points].sort((a, b) => a.loadPct - b.loadPct);
  if (pts.length === 0) return null;

  const effs = pts.map((p) => p.efficiencyPct);
  const loMin = Math.min(...effs);
  const loMax = Math.max(...effs);
  const pad = Math.max(0.25, (loMax - loMin) * 0.2);
  const {
    d0: y0,
    d1: y1,
    ticks: yTicks,
  } = niceDomainTicks(Math.max(0, loMin - pad), Math.min(100, loMax + pad), 5);

  const xLo = Math.min(...pts.map((p) => p.loadPct), 0);
  const xHi = Math.max(...pts.map((p) => p.loadPct), 100);
  const xTicks = niceTicks(xLo, xHi, 5);

  const W = 600;
  const H = 280;
  const left = 56;
  const right = 56;
  const top = 14;
  const bottom = 46;
  const x = (v: number) => left + scaleLinear(v, xLo, xHi, 0, W - left - right);
  const y = (v: number) => H - bottom - scaleLinear(v, y0, y1, 0, H - top - bottom);

  const path = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.loadPct).toFixed(1)},${y(p.efficiencyPct).toFixed(1)}`)
    .join(" ");
  const last = pts[pts.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Efficiency versus load percentage"
    >
      {/* horizontal gridlines */}
      {yTicks.map((t) => (
        <line
          key={`g${t}`}
          x1={left}
          y1={y(t)}
          x2={W - right}
          y2={y(t)}
          stroke={GRID}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ))}
      {/* axes */}
      <line
        x1={left}
        y1={H - bottom}
        x2={W - right}
        y2={H - bottom}
        stroke={GRID}
        strokeWidth={1}
        shapeRendering="crispEdges"
      />
      {xTicks.map((t) => (
        <text
          key={`x${t}`}
          x={x(t)}
          y={H - bottom + 18}
          textAnchor="middle"
          fontSize={12}
          fill={LABEL}
        >
          {t}
        </text>
      ))}
      {yTicks.map((t) => (
        <text
          key={`y${t}`}
          x={left - 8}
          y={y(t) + 4}
          textAnchor="end"
          fontSize={12}
          fill={LABEL}
        >
          {t}
        </text>
      ))}
      {/* series */}
      <path d={path} fill="none" stroke={VOLT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => (
        <g key={p.loadPct}>
          <title>{`${p.loadPct}% load: ${p.efficiencyPct.toFixed(2)}% η, ${fmtW(p.lossW)} loss`}</title>
          {/* oversized hit target */}
          <circle cx={x(p.loadPct)} cy={y(p.efficiencyPct)} r={12} fill="transparent" />
          <circle
            cx={x(p.loadPct)}
            cy={y(p.efficiencyPct)}
            r={4}
            fill={VOLT}
            stroke={SURFACE}
            strokeWidth={2}
          />
        </g>
      ))}
      {/* endpoint direct label (selective labeling) */}
      <text
        x={x(last.loadPct) + 8}
        y={y(last.efficiencyPct) - 8}
        fontSize={12}
        fill={LABEL}
      >
        {last.efficiencyPct.toFixed(2)}%
      </text>
      {/* axis titles */}
      <text x={left + (W - left - right) / 2} y={H - 6} textAnchor="middle" fontSize={12} fill={LABEL}>
        Load (% of rated)
      </text>
      <text
        x={14}
        y={top + (H - top - bottom) / 2}
        textAnchor="middle"
        fontSize={12}
        fill={LABEL}
        transform={`rotate(-90 14 ${top + (H - top - bottom) / 2})`}
      >
        Efficiency (%)
      </text>
    </svg>
  );
}
