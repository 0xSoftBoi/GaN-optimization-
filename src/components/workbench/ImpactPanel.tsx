"use client";

/**
 * Impact panel — the $-framing block energy traders and datacenter/energy
 * managers read first. Rendered FIRST on /design for BOTH personas.
 *
 * All commercial inputs (energy price, fleet size, horizon, baseline
 * efficiency, and — behind "More assumptions" — operating hours and grid
 * carbon intensity) are user-editable, defaulted from
 * `defaultAssumptions()` and clearly labeled as adjustable, never presented
 * as market fact (see src/lib/economics and the Business assumptions
 * section of /docs).
 *
 * Presentational only: the parent (/design/page.tsx) owns the assumptions
 * state and the energyEconomics() computation so the export/summary code
 * path shares one source of truth with what's on screen.
 */

import type { EconomicsAssumptions, EnergyEconomics } from "@/lib/economics";
import { formatEnergy, formatPct, formatUsd } from "@/lib/format";
import { Term } from "@/components/ui/term";
import { impactSentence } from "./summary";
import { niceDomainTicks, niceTicks, scaleLinear } from "./format";

const GRID = "#243044";
const LABEL = "#94a3b8";
const VOLT = "#22d3ee";
const ROSE = "#fb7185";
const SURFACE = "#11161f";

// ---------------------------------------------------------------------------
// Editable assumption field
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  suffix,
}: {
  label: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="stat-label mb-1 block normal-case tracking-normal">
        {label} <span className="text-slate-400">— assumption, edit</span>
      </span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          className="input"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          step={step}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v)) onChange(v);
          }}
        />
        {suffix && <span className="shrink-0 text-xs text-slate-500">{suffix}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Savings-vs-price sensitivity mini chart
// ---------------------------------------------------------------------------

function SensitivityChart({ sensitivity, currentIdx = 2 }: { sensitivity: EnergyEconomics["sensitivity"]; currentIdx?: number }) {
  const prices = sensitivity.map((s) => s.pricePerMwhUsd);
  const savings = sensitivity.map((s) => s.fleetAnnualUsdSaved);
  const xLo = Math.min(...prices);
  const xHi = Math.max(...prices);
  const yLoRaw = Math.min(0, ...savings);
  const yHiRaw = Math.max(0, ...savings);
  const pad = Math.max(1, (yHiRaw - yLoRaw) * 0.2);
  const { d0: yLo, d1: yHi, ticks: yTicks } = niceDomainTicks(yLoRaw - pad, yHiRaw + pad, 4);
  const xTicks = niceTicks(xLo, xHi, 4);

  const W = 340;
  const H = 150;
  const left = 60;
  const right = 12;
  const top = 10;
  const bottom = 30;
  const x = (v: number) => left + scaleLinear(v, xLo, xHi, 0, W - left - right);
  const y = (v: number) => H - bottom - scaleLinear(v, yLo, yHi, 0, H - top - bottom);

  const path = sensitivity
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.pricePerMwhUsd).toFixed(1)},${y(p.fleetAnnualUsdSaved).toFixed(1)}`)
    .join(" ");
  const current = sensitivity[currentIdx] ?? sensitivity[Math.floor(sensitivity.length / 2)];
  const showZero = yLo < 0 && yHi > 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Fleet annual savings versus assumed energy price">
      {yTicks.map((t) => (
        <line key={`g${t}`} x1={left} y1={y(t)} x2={W - right} y2={y(t)} stroke={GRID} strokeWidth={1} shapeRendering="crispEdges" />
      ))}
      {showZero && (
        <line x1={left} y1={y(0)} x2={W - right} y2={y(0)} stroke={ROSE} strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
      )}
      <line x1={left} y1={H - bottom} x2={W - right} y2={H - bottom} stroke={GRID} strokeWidth={1} shapeRendering="crispEdges" />
      {xTicks.map((t) => (
        <text key={`x${t}`} x={x(t)} y={H - bottom + 16} textAnchor="middle" fontSize={11} fill={LABEL}>
          {Math.round(t)}
        </text>
      ))}
      {yTicks.map((t) => (
        <text key={`y${t}`} x={left - 6} y={y(t) + 3} textAnchor="end" fontSize={11} fill={LABEL}>
          {formatUsd(t)}
        </text>
      ))}
      <path d={path} fill="none" stroke={VOLT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {sensitivity.map((p) => (
        <g key={p.pricePerMwhUsd}>
          <title>{`$${Math.round(p.pricePerMwhUsd)}/MWh: ${formatUsd(p.fleetAnnualUsdSaved)}/yr`}</title>
          <circle cx={x(p.pricePerMwhUsd)} cy={y(p.fleetAnnualUsdSaved)} r={10} fill="transparent" />
          <circle
            cx={x(p.pricePerMwhUsd)}
            cy={y(p.fleetAnnualUsdSaved)}
            r={p === current ? 5 : 3}
            fill={p === current ? VOLT : LABEL}
            stroke={SURFACE}
            strokeWidth={2}
          />
        </g>
      ))}
      <text x={left + (W - left - right) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill={LABEL}>
        Price ($/MWh)
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ImpactPanel({
  assumptions,
  onAssumptionsChange,
  economics,
  error,
}: {
  assumptions: EconomicsAssumptions;
  onAssumptionsChange: (a: EconomicsAssumptions) => void;
  economics: EnergyEconomics | null;
  error: string | null;
}) {
  const set = <K extends keyof EconomicsAssumptions>(key: K, v: EconomicsAssumptions[K]) =>
    onAssumptionsChange({ ...assumptions, [key]: v });

  const savingsPositive = economics !== null && economics.fleetAnnualUsdSaved > 0;

  return (
    <div className="panel border-volt/25">
      <div className="panel-title">
        Fleet <Term k="tco">impact</Term>
      </div>

      {/* Compact controls row — every commercial input is editable, none is market fact. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field
          label="Energy price"
          value={assumptions.pricePerMwhUsd}
          onChange={(v) => set("pricePerMwhUsd", v)}
          step={5}
          suffix="$/MWh"
        />
        <Field
          label="Fleet units"
          value={assumptions.fleetUnits}
          onChange={(v) => set("fleetUnits", Math.max(1, Math.round(v)))}
          min={1}
          step={1}
        />
        <Field
          label="Horizon"
          value={assumptions.horizonYears}
          onChange={(v) => set("horizonYears", v)}
          min={1}
          step={1}
          suffix="yr"
        />
        <Field
          label="Baseline efficiency"
          value={assumptions.baselineEfficiencyPct}
          onChange={(v) => set("baselineEfficiencyPct", v)}
          min={1}
          step={0.1}
          suffix="%"
        />
      </div>

      <details className="mb-4">
        <summary className="cursor-pointer select-none text-[11px] uppercase tracking-wider text-slate-500 hover:text-slate-300">
          More assumptions — operating hours, grid carbon intensity
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field
            label="Operating hours"
            value={assumptions.hoursPerYear}
            onChange={(v) => set("hoursPerYear", v)}
            min={1}
            step={100}
            suffix="h/yr"
          />
          <Field
            label="Grid carbon intensity"
            value={assumptions.carbonKgPerMwh}
            onChange={(v) => set("carbonKgPerMwh", v)}
            min={0}
            step={10}
            suffix="kg CO2/MWh"
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Typical ranges and public sources for these defaults are documented in{" "}
          <a href="/docs" className="underline decoration-dotted hover:text-volt">
            /docs
          </a>
          .
        </p>
      </details>

      {error && (
        <p className="mb-4 rounded border border-rose-400/40 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">
          Can&apos;t compute impact with these assumptions: {error}
        </p>
      )}

      {economics && !error && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="stat">
              <div className="stat-label">Fleet annual savings</div>
              <div className={`stat-value text-base leading-snug ${savingsPositive ? "" : "text-rose-400"}`}>
                {formatUsd(economics.fleetAnnualUsdSaved)}/yr
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">
                <Term k="payback">Payback</Term>
              </div>
              <div className={`stat-value text-base leading-snug ${economics.paybackMonths === null ? "text-rose-400" : ""}`}>
                {economics.paybackMonths === null
                  ? "never"
                  : economics.paybackMonths < 1
                    ? "< 1 mo"
                    : `${economics.paybackMonths.toFixed(1)} mo`}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Weighted efficiency vs baseline</div>
              <div className="stat-value text-base leading-snug">
                {formatPct(economics.weightedEfficiencyPct, 2)}
                <span className="ml-1 text-xs text-slate-500">vs {formatPct(economics.baselineWeightedPct, 1)}</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">
                {economics.co2SavedTonnesPerYear >= 0 ? "CO2 avoided / yr" : "Additional CO2 / yr"}
              </div>
              <div className={`stat-value text-base leading-snug ${economics.co2SavedTonnesPerYear >= 0 ? "" : "text-rose-400"}`}>
                {Math.abs(economics.co2SavedTonnesPerYear).toLocaleString("en-US", { maximumFractionDigits: 1 })} t
              </div>
            </div>
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                Savings vs assumed price
              </div>
              <SensitivityChart sensitivity={economics.sensitivity} />
            </div>
            <div className="flex flex-col justify-center gap-1 text-xs text-slate-500 lg:max-w-[14rem]">
              <div>
                Annual energy delivered: <span className="text-slate-300">{formatEnergy(economics.annualMwhPerUnit)}</span>/unit
              </div>
              <div>
                {economics.annualMwhSavedPerUnit >= 0 ? "Energy saved" : "Extra energy used"}:{" "}
                <span className="text-slate-300">{formatEnergy(Math.abs(economics.annualMwhSavedPerUnit))}</span>/unit/yr
              </div>
            </div>
          </div>

          <p className="rounded-md border border-ink-600 bg-ink-700/40 p-3 text-sm text-slate-200">
            {impactSentence(assumptions, economics)}
          </p>
        </>
      )}
    </div>
  );
}

export default ImpactPanel;
