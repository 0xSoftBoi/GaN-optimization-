"use client";

/**
 * Normalized figure-of-merit bar chart for the compare tray.
 * One horizontal bar per device, length ∝ Rds(on)·Qg (lower = better).
 * Hand-rolled inline SVG — no chart libraries.
 */

import type { SwitchDevice } from "@/lib/types";
import { fmtNum } from "./format";
import { normalizedFomBars } from "./switch-logic";
import { linScale, niceTicks } from "./pareto-logic";

const SURFACE = "#11161f"; // ink-800 panel surface
const GRID = "#243044";
const TEXT = "#94a3b8";
const TEXT_DIM = "#64748b";
const VOLT = "#22d3ee";
const CYAN_DIM = "#0e7490"; // same hue, dimmer step — non-best bars

/** Bar with a 4px rounded data-end (right) and a square baseline (left). */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h / 2);
  return [
    `M${x},${y}`,
    `h${w - r}`,
    `a${r},${r} 0 0 1 ${r},${r}`,
    `v${h - 2 * r}`,
    `a${r},${r} 0 0 1 ${-r},${r}`,
    `h${-(w - r)}`,
    "z",
  ].join(" ");
}

export default function FomBarChart({ devices }: { devices: SwitchDevice[] }) {
  const bars = normalizedFomBars(devices);
  if (bars.length === 0) return null;

  const W = 560;
  // Right margin fits the longest value label ("×99.99 · 9,999") past the bar tip.
  const M = { top: 8, right: 118, bottom: 30, left: 8 };
  const rowH = 42; // 12px label line + 20px bar + air
  const plotW = W - M.left - M.right;
  const H = M.top + bars.length * rowH + M.bottom;

  const maxFom = Math.max(...bars.map((b) => b.fom));
  const ticks = niceTicks(0, maxFom);
  const sx = linScale(0, maxFom, 0, plotW);

  return (
    <figure>
      <figcaption className="mb-1 text-xs text-slate-500">
        Figure of merit — Rds(on)·Qg, mΩ·nC (lower is better)
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Normalized Rds(on) times Qg figure of merit per compared device"
      >
        {/* gridlines */}
        {ticks.map((t) => (
          <line
            key={`g${t}`}
            x1={M.left + sx(t)}
            x2={M.left + sx(t)}
            y1={M.top}
            y2={H - M.bottom + 4}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
        {/* bars */}
        {bars.map((b, i) => {
          const y = M.top + i * rowH;
          const w = Math.max(2, sx(b.fom));
          return (
            <g key={b.id}>
              <text x={M.left} y={y + 11} fontSize={12} fill={TEXT}>
                {b.id}
                {b.best ? " · best" : ""}
              </text>
              <path
                d={barPath(M.left, y + 16, w, 20)}
                fill={b.best ? VOLT : CYAN_DIM}
                stroke={SURFACE}
                strokeWidth={2}
              />
              <text
                x={M.left + w + 6}
                y={y + 30}
                fontSize={12}
                fill={TEXT}
              >
                ×{b.ratioToBest.toFixed(2)} · {fmtNum(b.fom)}
              </text>
            </g>
          );
        })}
        {/* x axis */}
        <line
          x1={M.left}
          x2={M.left + plotW}
          y1={H - M.bottom + 4}
          y2={H - M.bottom + 4}
          stroke={GRID}
          strokeWidth={1}
        />
        {ticks.map((t) => (
          <text
            key={`t${t}`}
            x={M.left + sx(t)}
            y={H - M.bottom + 18}
            fontSize={12}
            fill={TEXT_DIM}
            textAnchor="middle"
          >
            {fmtNum(t)}
          </text>
        ))}
        <text x={M.left + plotW} y={H - 4} fontSize={12} fill={TEXT_DIM} textAnchor="end">
          Rds(on)·Qg (mΩ·nC)
        </text>
      </svg>
    </figure>
  );
}
