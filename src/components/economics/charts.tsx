"use client";

/**
 * /economics charts — hand-rolled inline SVG, no chart libs. Same style
 * contract as the rest of the app (see components/workbench/charts.tsx):
 * volt-cyan primary series, amber marks the current assumption, rose/lime
 * for negative/positive $, gridlines #243044, labels #94a3b8 at 12px+.
 * Native <title> tooltips carry hover detail — the numbers are also always
 * visible in the surrounding stat tiles / breakdown, so a tooltip never
 * gates a value.
 */

import type { LoadProfileBreakdownPoint, PriceSensitivityPoint } from "@/lib/economics";
import { linScale, niceTicks, paddedExtent } from "@/components/explore/pareto-logic";
import { formatUsd } from "@/lib/format";

const GRID = "#243044";
const TEXT = "#94a3b8";
const TEXT_DIM = "#64748b";
const VOLT = "#22d3ee";
const AMBER = "#f59e0b";
const ROSE = "#fb7185";
const LIME = "#a3e635";
const SURFACE = "#11161f";

const W = 560;
const H = 260;
const M = { top: 14, right: 16, bottom: 38, left: 68 };

/** Compact $/yr axis tick: formatUsd already handles k/M scaling. */
function tickLabel(v: number): string {
  return formatUsd(v);
}

// ---------------------------------------------------------------------------
// Savings vs assumed energy price — line, one point per sensitivity sweep
// ---------------------------------------------------------------------------

export function SavingsVsPriceChart({
  points,
  currentPriceUsd,
}: {
  points: PriceSensitivityPoint[];
  currentPriceUsd: number;
}) {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.pricePerMwhUsd - b.pricePerMwhUsd);
  const xs = sorted.map((p) => p.pricePerMwhUsd);
  const ys = sorted.map((p) => p.fleetAnnualUsdSaved);
  const [x0, x1] = paddedExtent(xs, 0.08);
  const [y0raw, y1raw] = paddedExtent(ys.length > 1 ? ys : [ys[0], 0], 0.15);
  // Keep the zero-line in view — "no savings" is the reader's reference point.
  const y0 = Math.min(y0raw, 0);
  const y1 = Math.max(y1raw, 0);
  const sx = linScale(x0, x1, M.left, W - M.right);
  const sy = linScale(y0, y1, H - M.bottom, M.top);
  const xTicks = niceTicks(x0, x1);
  const yTicks = niceTicks(y0, y1);
  const zeroY = sy(0);
  const path = sorted
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.pricePerMwhUsd).toFixed(1)},${sy(p.fleetAnnualUsdSaved).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Fleet annual savings versus assumed energy price"
    >
      {yTicks.map((t) => (
        <line key={`gy${t}`} x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} shapeRendering="crispEdges" />
      ))}
      {y0 < 0 && (
        <line x1={M.left} x2={W - M.right} y1={zeroY} y2={zeroY} stroke={TEXT_DIM} strokeWidth={1} strokeDasharray="2 3" />
      )}
      <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke={GRID} strokeWidth={1} shapeRendering="crispEdges" />
      {xTicks.map((t) => (
        <text key={`tx${t}`} x={sx(t)} y={H - M.bottom + 18} fontSize={12} fill={TEXT_DIM} textAnchor="middle">
          ${Math.round(t)}
        </text>
      ))}
      {yTicks.map((t) => (
        <text key={`ty${t}`} x={M.left - 8} y={sy(t) + 4} fontSize={12} fill={TEXT_DIM} textAnchor="end">
          {tickLabel(t)}
        </text>
      ))}
      <path d={path} fill="none" stroke={VOLT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {sorted.map((p) => {
        const isCurrent = Math.abs(p.pricePerMwhUsd - currentPriceUsd) < 1e-6;
        return (
          <g key={p.pricePerMwhUsd}>
            <title>{`$${Math.round(p.pricePerMwhUsd)}/MWh: ${formatUsd(p.fleetAnnualUsdSaved)}/yr`}</title>
            <circle cx={sx(p.pricePerMwhUsd)} cy={sy(p.fleetAnnualUsdSaved)} r={16} fill="transparent" />
            <circle
              cx={sx(p.pricePerMwhUsd)}
              cy={sy(p.fleetAnnualUsdSaved)}
              r={isCurrent ? 6 : 4}
              fill={isCurrent ? AMBER : VOLT}
              stroke={SURFACE}
              strokeWidth={2}
            />
          </g>
        );
      })}
      <text x={M.left + (W - M.left - M.right) / 2} y={H - 6} textAnchor="middle" fontSize={12} fill={TEXT}>
        Energy price ($/MWh)
      </text>
      <text
        transform={`rotate(-90 14 ${(M.top + H - M.bottom) / 2})`}
        x={14}
        y={(M.top + H - M.bottom) / 2}
        textAnchor="middle"
        fontSize={12}
        fill={TEXT}
      >
        Fleet $/yr saved
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Savings by load profile point — bar, one per duty-cycle bucket
// ---------------------------------------------------------------------------

export function SavingsVsLoadChart({
  rows,
}: {
  /** Fleet-scaled $/yr saved at each load-profile point (caller applies fleetUnits). */
  rows: { loadPct: number; weightFrac: number; usd: number }[];
}) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.loadPct - b.loadPct);
  const vals = sorted.map((r) => r.usd);
  const [y0raw, y1raw] = paddedExtent(vals.length > 1 ? vals : [vals[0], 0], 0.18);
  const y0 = Math.min(y0raw, 0);
  const y1 = Math.max(y1raw, 0);
  const sy = linScale(y0, y1, H - M.bottom, M.top);
  const yTicks = niceTicks(y0, y1);
  const zeroY = sy(0);
  const plotW = W - M.left - M.right;
  const bandW = plotW / sorted.length;
  const barW = Math.min(46, bandW * 0.5);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Fleet annual savings by load-profile point"
    >
      {yTicks.map((t) => (
        <line key={`gy${t}`} x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} shapeRendering="crispEdges" />
      ))}
      {yTicks.map((t) => (
        <text key={`ty${t}`} x={M.left - 8} y={sy(t) + 4} fontSize={12} fill={TEXT_DIM} textAnchor="end">
          {tickLabel(t)}
        </text>
      ))}
      {sorted.map((r, i) => {
        const cx = M.left + bandW * (i + 0.5);
        const top = Math.min(sy(r.usd), zeroY);
        const barH = Math.max(1, Math.abs(sy(r.usd) - zeroY));
        const color = r.usd >= 0 ? LIME : ROSE;
        return (
          <g key={r.loadPct}>
            <title>{`${r.loadPct}% load (${Math.round(r.weightFrac * 100)}% of hours): ${formatUsd(r.usd)}/yr`}</title>
            <rect x={cx - bandW / 2} y={M.top} width={bandW} height={H - M.top - M.bottom} fill="transparent" />
            <rect x={cx - barW / 2} y={top} width={barW} height={barH} rx={3} fill={color} />
            <text x={cx} y={H - M.bottom + 18} fontSize={12} fill={TEXT_DIM} textAnchor="middle">
              {r.loadPct}%
            </text>
          </g>
        );
      })}
      <line x1={M.left} x2={W - M.right} y1={zeroY} y2={zeroY} stroke={TEXT_DIM} strokeWidth={1} shapeRendering="crispEdges" />
      <text x={M.left + plotW / 2} y={H - 6} textAnchor="middle" fontSize={12} fill={TEXT}>
        Load point (% of rated output)
      </text>
      <text
        transform={`rotate(-90 14 ${(M.top + H - M.bottom) / 2})`}
        x={14}
        y={(M.top + H - M.bottom) / 2}
        textAnchor="middle"
        fontSize={12}
        fill={TEXT}
      >
        Fleet $/yr saved
      </text>
    </svg>
  );
}
