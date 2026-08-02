"use client";

/**
 * Workbench panels — every display block of the /design page.
 * Status colors (lime/amber/rose) are never color-alone: each carries a
 * text badge or numeric label alongside.
 */

import { useState, type ReactNode } from "react";
import type {
  ComplianceReport,
  DesignResult,
  DeviceLoss,
  FirmwarePackage,
  LayoutGuidance,
  MagneticDesign,
  SwitchTech,
  ThermalReport,
} from "@/lib/types";
import { roundSig } from "@/lib/util";
import { formatUsd as fmtUsdCompact } from "@/lib/format";
import { Term } from "@/components/ui/term";
import {
  bomToCsv,
  chosenPowerDensity,
  fmtC,
  fmtHz,
  fmtPct,
  fmtPowerDensity,
  fmtUsd,
  fmtW,
  marginBarFrac,
  marginTone,
} from "./format";
import { complianceConsequence, complianceVerdict, friendlyErrorMessage } from "./summary";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** Client-side blob download. */
export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const TECH_BADGE: Record<SwitchTech, string> = {
  GaN: "border-volt/40 bg-volt/10 text-volt",
  SiC: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  Si: "border-slate-500/40 bg-slate-500/10 text-slate-400",
};

const TECH_LABEL: Record<SwitchTech, ReactNode> = {
  GaN: <Term k="gan">GaN</Term>,
  SiC: <Term k="sic">SiC</Term>,
  Si: "Si",
};

function TechBadge({ tech }: { tech: SwitchTech }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${TECH_BADGE[tech]}`}
    >
      {TECH_LABEL[tech]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Staged progress
// ---------------------------------------------------------------------------

export function StagedProgress({
  stages,
  active,
  elapsedSec,
}: {
  stages: string[];
  active: number;
  /** Real elapsed seconds since the run started — these stages are indicative, not measured. */
  elapsedSec?: number;
}) {
  return (
    <div className="panel mx-auto max-w-md">
      <div className="panel-title">Design engine running</div>
      <ol className="space-y-2">
        {stages.map((s, i) => {
          const state = i < active ? "done" : i === active ? "running" : "pending";
          return (
            <li key={s} className="flex items-center gap-3 text-sm">
              {state === "done" && <span className="text-lime-400">✓</span>}
              {state === "running" && (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-volt border-t-transparent" />
              )}
              {state === "pending" && <span className="text-slate-600">·</span>}
              <span
                className={
                  state === "running"
                    ? "text-volt"
                    : state === "done"
                      ? "text-slate-400"
                      : "text-slate-400"
                }
              >
                {s}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-center text-[11px] text-slate-500">
        Indicative stages — actual timing varies by design complexity
        {elapsedSec !== undefined && ` · ${elapsedSec}s elapsed`}
      </p>
    </div>
  );
}

export function ErrorPanel({
  message,
  details,
  onRetry,
}: {
  /** Raw technical message from the API/engine — never shown as the headline. */
  message: string;
  details?: string[];
  onRetry: () => void;
}) {
  return (
    <div className="panel mx-auto max-w-lg border-rose-400/40">
      <div className="panel-title text-rose-400">Design failed</div>
      <p className="text-sm text-slate-300">{friendlyErrorMessage(message)}</p>
      <details className="mt-2 text-xs text-slate-500">
        <summary className="cursor-pointer select-none hover:text-slate-300">
          Technical details
        </summary>
        <p className="mt-1 rounded border border-ink-600 bg-ink-900 p-2 font-mono text-[11px] text-slate-400">
          {message}
        </p>
        {details && details.length > 0 && (
          <ul className="mt-2 list-inside list-disc">
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </details>
      <div className="mt-4 flex gap-3">
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
        <a href="/" className="btn border-slate-600 bg-transparent text-slate-400">
          Back to copilot
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (1) Header stats
// ---------------------------------------------------------------------------

export function StatsRow({ result }: { result: DesignResult }) {
  const density = chosenPowerDensity(result);
  const stats: { key: string; label: ReactNode; value: string }[] = [
    { key: "topology", label: "Topology", value: result.topology.name },
    { key: "efficiency", label: "Efficiency", value: fmtPct(result.efficiencyPct, 2) },
    { key: "loss", label: "Total loss", value: fmtW(result.losses.totalW) },
    // Compact, grouped, no-cents formatting for a headline stat tile — exact
    // cents belong in the BOM line items (BomPanel), not here.
    { key: "bom", label: <><Term k="bom">BOM</Term> cost</>, value: fmtUsdCompact(result.bomCostUsd) },
    { key: "fsw", label: <Term k="fsw">fsw</Term>, value: fmtHz(result.fswHz) },
    {
      key: "density",
      label: <Term k="power-density">Power density</Term>,
      value: density !== undefined ? fmtPowerDensity(density) : "—",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s) => (
        <div key={s.key} className="stat">
          <div className="stat-label">{s.label}</div>
          <div className="stat-value text-base leading-snug">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// (2) Topology rationale
// ---------------------------------------------------------------------------

export function RationalePanel({
  rationale,
  assumptions,
  unrecognized,
  confidence,
}: {
  rationale: string[];
  assumptions?: string[];
  unrecognized?: string[];
  confidence?: number;
}) {
  return (
    <div className="panel">
      <div className="panel-title">Topology rationale</div>
      <ul className="space-y-1.5 text-sm text-slate-300">
        {rationale.map((r) => (
          <li key={r} className="flex gap-2">
            <span className="text-volt">▸</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
      {assumptions && assumptions.length > 0 && (
        <div className="mt-4 border-t border-ink-700 pt-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            Copilot assumptions
            {confidence !== undefined && ` · confidence ${(confidence * 100).toFixed(0)}%`}
          </div>
          <ul className="mt-1 space-y-1 text-xs text-slate-400">
            {assumptions.map((a) => (
              <li key={a}>• {a}</li>
            ))}
          </ul>
          {unrecognized && unrecognized.length > 0 && (
            <p className="mt-2 text-xs text-amber-500">
              Not understood: {unrecognized.join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// (5) Device table
// ---------------------------------------------------------------------------

export function DeviceTable({ devices }: { devices: DeviceLoss[] }) {
  return (
    <div className="panel">
      <div className="panel-title">Switch devices</div>
      <p className="mb-2 text-[11px] text-slate-500">
        Lower <Term k="rds-on">Rds(on)</Term> and <Term k="qg">Qg</Term> both cut losses; watch{" "}
        <Term k="tj">Tj</Term> against the thermal limit below.
      </p>
      <div className="overflow-x-auto">
        <table className="table-terminal">
          <thead>
            <tr>
              <th>Role</th>
              <th>Part</th>
              <th>Tech</th>
              <th>Pos × ∥</th>
              <th>
                <Term k="tj">Tj</Term>
              </th>
              <th>Loss</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={`${d.role}-${d.device.id}`}>
                <td className="whitespace-nowrap">{d.role}</td>
                <td className="whitespace-nowrap">
                  <span className="text-slate-200">{d.device.id}</span>{" "}
                  <span className="text-slate-500">{d.device.mfr}</span>
                  <div className="text-[10px] text-slate-500">
                    {d.device.vdsMaxV} V · {d.device.rdsOnMohm25} mΩ · {d.device.pkg}
                  </div>
                </td>
                <td>
                  <TechBadge tech={d.device.tech} />
                </td>
                <td className="whitespace-nowrap">
                  {d.positions} × {d.parallelPerPosition}
                </td>
                <td className="whitespace-nowrap">{fmtC(d.tjC, 0)}</td>
                <td className="whitespace-nowrap">{fmtW(d.totalW)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (6) Magnetics cards
// ---------------------------------------------------------------------------

export function MagneticsCards({ magnetics }: { magnetics: MagneticDesign[] }) {
  return (
    <div className="panel">
      <div className="panel-title">
        <Term k="magnetics">Magnetics</Term>
      </div>
      {magnetics.length === 0 ? (
        <p className="text-sm text-slate-500">No magnetic components required.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {magnetics.map((m, i) => (
            <div key={`${m.role}-${i}`} className="rounded-md border border-ink-600 bg-ink-700/40 p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-volt">
                  {m.role}
                </span>
                <span className="text-[10px] text-slate-500">
                  {m.core.id} · {m.material.id}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-slate-500">Turns</dt>
                <dd className="text-slate-300">
                  {m.turnsSecondary !== undefined
                    ? `${m.turnsPrimary}:${m.turnsSecondary}`
                    : m.turnsPrimary}
                </dd>
                <dt className="text-slate-500">Air gap</dt>
                <dd className="text-slate-300">{roundSig(m.airGapMm, 3)} mm</dd>
                <dt className="text-slate-500">L</dt>
                <dd className="text-slate-300">{roundSig(m.inductanceUh, 3)} µH</dd>
                <dt className="text-slate-500">B-peak</dt>
                <dd className="text-slate-300">{roundSig(m.bPeakT, 3)} T</dd>
                <dt className="text-slate-500">Core loss</dt>
                <dd className="text-slate-300">{fmtW(m.coreLossW)}</dd>
                <dt className="text-slate-500">Copper loss</dt>
                <dd className="text-slate-300">{fmtW(m.copperLossW)}</dd>
                <dt className="text-slate-500">ΔT hot-spot</dt>
                <dd className="text-slate-300">{fmtC(m.tempRiseC, 0)}</dd>
                <dt className="text-slate-500">Window fill</dt>
                <dd className="text-slate-300">{fmtPct(m.windowUtilization * 100, 0)}</dd>
              </dl>
              {m.notes && <p className="mt-2 text-[10px] text-slate-500">{m.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// (7) Thermal nodes with margin bars
// ---------------------------------------------------------------------------

const TONE_BAR: Record<ReturnType<typeof marginTone>, string> = {
  ok: "bg-lime-400",
  tight: "bg-amber-500",
  low: "bg-rose-400",
};
const TONE_TEXT: Record<ReturnType<typeof marginTone>, string> = {
  ok: "text-lime-400",
  tight: "text-amber-500",
  low: "text-rose-400",
};
const TONE_LABEL: Record<ReturnType<typeof marginTone>, string> = {
  ok: "OK",
  tight: "TIGHT",
  low: "LOW",
};

export function ThermalPanel({ thermal }: { thermal: ThermalReport }) {
  return (
    <div className="panel">
      <div className="panel-title">
        Thermal · {thermal.cooling} · {fmtC(thermal.ambientC, 0)} ambient
        {thermal.heatsink && ` · ${thermal.heatsink.id}`}
      </div>
      <div className="space-y-3">
        {thermal.nodes.map((n) => {
          const tone = marginTone(n.marginC);
          return (
            <div key={n.name}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-slate-300">{n.name}</span>
                <span className="text-slate-500">
                  {fmtC(n.tjC, 0)} / {fmtC(n.limitC, 0)} ·{" "}
                  <span className={TONE_TEXT[tone]}>
                    {TONE_LABEL[tone]} · <Term k="thermal-margin">margin</Term> {fmtC(n.marginC, 0)}
                  </span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-ink-700">
                <div
                  className={`h-full rounded ${TONE_BAR[tone]}`}
                  style={{ width: `${Math.max(2, marginBarFrac(n.marginC) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {thermal.notes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-ink-700 pt-2 text-[11px] text-slate-500">
          {thermal.notes.map((x) => (
            <li key={x}>• {x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// (8) Schematic
// ---------------------------------------------------------------------------

export function SchematicPanel({ svg }: { svg: string }) {
  return (
    <div className="panel">
      <div className="panel-title">Schematic</div>
      <div
        className="overflow-x-auto rounded bg-ink-900 p-2 [&_svg]:h-auto [&_svg]:max-w-none"
        // Our own generated SVG from the schematic engine — safe to inline.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="mt-2 text-[11px] text-slate-500">
        Exportable as a <Term k="spice">SPICE</Term> netlist via the export buttons above, for
        verification in your own tools.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (9) BOM
// ---------------------------------------------------------------------------

export function BomPanel({
  bom,
  totalUsd,
}: {
  bom: DesignResult["bom"];
  totalUsd: number;
}) {
  return (
    <div className="panel">
      <div className="mb-3 flex items-center justify-between">
        <span className="panel-title mb-0">
          <Term k="bom">Bill of materials</Term>
        </span>
        <button
          className="btn px-3 py-1 text-xs"
          onClick={() => downloadBlob(bomToCsv(bom, totalUsd), "voltforge-bom.csv", "text/csv")}
        >
          ↓ CSV
        </button>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="table-terminal">
          <thead>
            <tr>
              <th>Refs</th>
              <th>Part</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Ext</th>
            </tr>
          </thead>
          <tbody>
            {bom.map((l) => (
              <tr key={`${l.partId}-${l.ref.join()}`}>
                <td className="whitespace-nowrap">{l.ref.join(" ")}</td>
                <td className="whitespace-nowrap">
                  <span className="text-slate-200">{l.partId}</span>
                  <div className="text-[10px] text-slate-500">{l.mfr}</div>
                </td>
                <td>{l.description}</td>
                <td>{l.qty}</td>
                <td className="whitespace-nowrap text-amber-500">{fmtUsd(l.unitPriceUsd)}</td>
                <td className="whitespace-nowrap text-amber-500">{fmtUsd(l.extPriceUsd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="text-right font-bold text-slate-300">
                TOTAL
              </td>
              <td className="whitespace-nowrap font-bold text-amber-500">{fmtUsd(totalUsd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (10) Compliance
// ---------------------------------------------------------------------------

const SEV_BADGE: Record<"pass" | "warn" | "fail", string> = {
  pass: "border-lime-400/40 bg-lime-400/10 text-lime-400",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  fail: "border-rose-400/40 bg-rose-400/10 text-rose-400",
};

export function CompliancePanel({ compliance }: { compliance: ComplianceReport }) {
  return (
    <div className="panel">
      <div className="panel-title">
        Compliance ·{" "}
        <span className={compliance.passed ? "text-lime-400" : "text-rose-400"}>
          {compliance.passed ? "PASSED" : "ISSUES FOUND"}
        </span>
      </div>
      <ul className="space-y-2">
        {compliance.findings.map((f, i) => (
          <li key={`${f.rule}-${i}`} className="flex items-start gap-2 text-xs">
            <span
              className={`mt-0.5 inline-block w-11 shrink-0 rounded border px-1 py-0.5 text-center text-[10px] font-bold ${SEV_BADGE[f.severity]}`}
            >
              {f.severity.toUpperCase()}
            </span>
            <span>
              <span className="text-slate-300">{f.rule}</span>
              <span className="block text-slate-500">{f.detail}</span>
              {f.severity === "fail" && (
                <span className="block text-rose-300/80">
                  Consequence: {complianceConsequence(f.rule)}.
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (10b) Executive-persona condensed twin of Compliance + Warnings
// ---------------------------------------------------------------------------

/**
 * Executive persona's "risk & compliance" card: the verdict, the top FAIL
 * consequences, and a trimmed warnings list — everything a manager needs to
 * judge risk without the full itemized findings list (that stays in the
 * engineer persona's CompliancePanel + WarningsStrip). Carries id="warnings-strip"
 * so the title-bar warnings chip has somewhere to land in this persona too.
 */
export function ComplianceVerdictCard({
  compliance,
  warnings,
}: {
  compliance: ComplianceReport;
  warnings: string[];
}) {
  const verdict = complianceVerdict(compliance);
  const topFails = compliance.findings.filter((f) => f.severity === "fail").slice(0, 3);
  return (
    <div className="panel">
      <div className="panel-title">Risk & compliance verdict</div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-block rounded border px-2 py-1 text-xs font-bold ${
            verdict.passed
              ? "border-lime-400/40 bg-lime-400/10 text-lime-400"
              : "border-rose-400/40 bg-rose-400/10 text-rose-400"
          }`}
        >
          {verdict.passed ? "PASSED" : "ISSUES FOUND"}
        </span>
        <span className="text-sm text-slate-300">{verdict.headline}</span>
      </div>
      {topFails.length > 0 && (
        <ul className="mb-3 space-y-1.5 border-t border-ink-700 pt-2 text-xs text-slate-300">
          {topFails.map((f, i) => (
            <li key={`${f.rule}-${i}`}>
              <span className="font-semibold text-rose-400">{f.rule}</span> — {f.detail}
              <span className="block text-rose-300/70">
                Consequence: {complianceConsequence(f.rule)}.
              </span>
            </li>
          ))}
        </ul>
      )}
      <div id="warnings-strip">
        {warnings.length === 0 ? (
          <p className="text-xs text-slate-500">No design warnings.</p>
        ) : (
          <>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              {warnings.length} warning{warnings.length === 1 ? "" : "s"}
            </div>
            <ul className="space-y-1 text-xs text-amber-200/80">
              {warnings.slice(0, 3).map((w) => (
                <li key={w} className="flex gap-2">
                  <span className="text-amber-500">⚠</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
            {warnings.length > 3 && (
              <p className="mt-1 text-[10px] text-slate-500">
                +{warnings.length - 3} more — switch to Engineer view for the full list.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (11) Firmware
// ---------------------------------------------------------------------------

export function FirmwarePanel({ firmware }: { firmware?: FirmwarePackage }) {
  const [active, setActive] = useState(0);
  if (!firmware || firmware.files.length === 0) {
    return (
      <div className="panel">
        <div className="panel-title">Firmware</div>
        <p className="text-sm text-slate-500">
          No firmware generated for this design (analog control or unsupported target).
        </p>
      </div>
    );
  }
  const file = firmware.files[Math.min(active, firmware.files.length - 1)];
  return (
    <div className="panel">
      <div className="mb-3 flex items-center justify-between">
        <span className="panel-title mb-0">Firmware · {firmware.target}</span>
        <button
          className="btn px-3 py-1 text-xs"
          onClick={() => {
            const name = file.path.split("/").pop() ?? "firmware.c";
            downloadBlob(file.contents, name, "text/plain");
          }}
        >
          ↓ {file.path.split("/").pop()}
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1 border-b border-ink-700">
        {firmware.files.map((f, i) => (
          <button
            key={f.path}
            onClick={() => setActive(i)}
            className={`px-2 py-1 text-xs transition-colors ${
              i === active
                ? "border-b-2 border-volt text-volt"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {f.path.split("/").pop()}
          </button>
        ))}
      </div>
      <pre className="max-h-96 overflow-auto rounded bg-ink-900 p-3 text-[11px] leading-relaxed text-slate-300">
        {file.contents}
      </pre>
      <p className="mt-2 text-[11px] text-slate-500">{firmware.summary}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (12) Layout guidance
// ---------------------------------------------------------------------------

export function LayoutPanel({ layout }: { layout: LayoutGuidance }) {
  return (
    <div className="panel">
      <div className="panel-title">Layout guidance</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div
          className="overflow-x-auto rounded bg-ink-900 p-2 [&_svg]:h-auto [&_svg]:max-w-full"
          // Our own generated floorplan SVG — safe to inline.
          dangerouslySetInnerHTML={{ __html: layout.placementSvg }}
        />
        <div className="space-y-3 text-xs">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Stackup</div>
            <ol className="space-y-0.5 text-slate-300">
              {layout.stackup.map((s, i) => (
                <li key={s}>
                  <span className="text-slate-400">L{i + 1}</span> {s}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              Critical loops
            </div>
            <ul className="space-y-1 text-slate-300">
              {layout.criticalLoops.map((l) => (
                <li key={l.name}>
                  <span className="text-volt">{l.name}</span> ≤ {l.maxAreaMm2} mm²
                  <span className="block text-slate-500">{l.note}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Rules</div>
            <ul className="space-y-1 text-slate-400">
              {layout.rules.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (13) Warnings strip
// ---------------------------------------------------------------------------

export function WarningsStrip({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="panel border-amber-500/40 bg-amber-500/5">
      <div className="panel-title text-amber-500">Warnings</div>
      <ul className="space-y-1 text-xs text-amber-200/80">
        {warnings.map((w) => (
          <li key={w} className="flex gap-2">
            <span className="text-amber-500">⚠</span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
