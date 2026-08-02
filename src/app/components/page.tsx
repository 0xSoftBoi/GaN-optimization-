"use client";

/**
 * /components — the component terminal ("Bloomberg for power electronics").
 * Kind tabs fetch /api/components; the switches view is a dense sortable
 * table with text/tech/Vds filters and a ≤4-part compare tray.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CapacitorPart,
  ControllerPart,
  CoreShape,
  GateDriver,
  Heatsink,
  SwitchDevice,
  SwitchTech,
} from "@/lib/types";
import CompareTray from "@/components/explore/CompareTray";
import TechBadge from "@/components/explore/TechBadge";
import { Term } from "@/components/ui/term";
import { fmtNum, fmtUsd } from "@/components/explore/format";
import {
  filterSwitches,
  fomMohmNc,
  nextSort,
  sortSwitches,
  toggleCompare,
  COMPARE_MAX,
  type SortDir,
  type SwitchSortKey,
} from "@/components/explore/switch-logic";

const PRICE_LABEL = "$ @ 1k qty";

/** Fixed-height pulsing placeholder rows so the table frame doesn't collapse while loading. */
function SkeletonRows({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c}>
              <div
                className="h-3 animate-pulse rounded bg-ink-700/70"
                style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

const KINDS = [
  { kind: "switch", label: "Switches" },
  { kind: "driver", label: "Drivers" },
  { kind: "controller", label: "Controllers" },
  { kind: "capacitor", label: "Capacitors" },
  { kind: "heatsink", label: "Heatsinks" },
  { kind: "core", label: "Cores" },
] as const;
type Kind = (typeof KINDS)[number]["kind"];

const TECH_OPTIONS: (SwitchTech | "all")[] = ["all", "GaN", "SiC", "Si"];

interface SwitchColumn {
  key: SwitchSortKey;
  label: string;
  header?: React.ReactNode;
  render: (d: SwitchDevice) => React.ReactNode;
  align?: "right";
  /** Pins this column to the left edge of the horizontally-scrolling table. */
  sticky?: boolean;
}

const SWITCH_COLUMNS: SwitchColumn[] = [
  {
    key: "id",
    label: "Part",
    sticky: true,
    render: (d) => <span className="text-slate-200">{d.id}</span>,
  },
  { key: "mfr", label: "Mfr", render: (d) => d.mfr },
  { key: "tech", label: "Tech", render: (d) => <TechBadge tech={d.tech} /> },
  { key: "vdsMaxV", label: "Vds (V)", render: (d) => fmtNum(d.vdsMaxV), align: "right" },
  { key: "idMaxA", label: "Id (A)", render: (d) => fmtNum(d.idMaxA), align: "right" },
  {
    key: "rdsOnMohm25",
    label: "Rds (mΩ)",
    header: (
      <>
        <Term k="rds-on">Rds</Term> (mΩ)
      </>
    ),
    render: (d) => fmtNum(d.rdsOnMohm25),
    align: "right",
  },
  {
    key: "qgNc",
    label: "Qg (nC)",
    header: (
      <>
        <Term k="qg">Qg</Term> (nC)
      </>
    ),
    render: (d) => fmtNum(d.qgNc),
    align: "right",
  },
  { key: "qossNc", label: "Qoss (nC)", render: (d) => fmtNum(d.qossNc), align: "right" },
  {
    key: "qrrNc",
    label: "Qrr (nC)",
    header: (
      <>
        <Term k="qrr">Qrr</Term> (nC)
      </>
    ),
    render: (d) => fmtNum(d.qrrNc),
    align: "right",
  },
  {
    key: "fom",
    label: "FoM Rds·Qg",
    header: (
      <>
        <Term k="fom">FoM</Term> Rds·Qg
      </>
    ),
    render: (d) => fmtNum(fomMohmNc(d)),
    align: "right",
  },
  { key: "priceUsd1k", label: PRICE_LABEL, render: (d) => fmtUsd(d.priceUsd1k), align: "right" },
];

interface GenericColumn<T> {
  label: string;
  header?: React.ReactNode;
  render: (row: T) => React.ReactNode;
  /** Pins this column to the left edge of the horizontally-scrolling table. */
  sticky?: boolean;
}

const PART_COL = { label: "Part", sticky: true } as const;

/** Column sets for the non-switch catalogs. */
function genericColumns(kind: Kind): GenericColumn<unknown>[] {
  switch (kind) {
    case "driver": {
      const cols: GenericColumn<GateDriver>[] = [
        { ...PART_COL, render: (d) => <span className="text-slate-200">{d.id}</span> },
        { label: "Mfr", render: (d) => d.mfr },
        { label: "Ch", render: (d) => d.channels },
        { label: "Isolated", render: (d) => (d.isolated ? "yes" : "no") },
        {
          label: "Src/Sink (A)",
          render: (d) => `${fmtNum(d.peakSourceA)} / ${fmtNum(d.peakSinkA)}`,
        },
        {
          label: "CMTI (V/ns)",
          header: (
            <>
              <Term k="cmti">CMTI</Term> (V/ns)
            </>
          ),
          render: (d) => fmtNum(d.cmtiVPerNs),
        },
        { label: "tpd (ns)", render: (d) => fmtNum(d.propDelayNs) },
        { label: PRICE_LABEL, render: (d) => fmtUsd(d.priceUsd1k) },
        { label: "Suppliers", render: (d) => d.suppliers.join(", ") },
      ];
      return cols as GenericColumn<unknown>[];
    }
    case "controller": {
      const cols: GenericColumn<ControllerPart>[] = [
        { ...PART_COL, render: (d) => <span className="text-slate-200">{d.id}</span> },
        { label: "Mfr", render: (d) => d.mfr },
        { label: "Family", render: (d) => d.family },
        { label: "Core (MHz)", render: (d) => fmtNum(d.coreMhz) },
        { label: "PWM res (ps)", render: (d) => fmtNum(d.pwmResolutionPs) },
        { label: "ADC (bits)", render: (d) => d.adcBits },
        { label: PRICE_LABEL, render: (d) => fmtUsd(d.priceUsd1k) },
        { label: "Suppliers", render: (d) => d.suppliers.join(", ") },
      ];
      return cols as GenericColumn<unknown>[];
    }
    case "capacitor": {
      const cols: GenericColumn<CapacitorPart>[] = [
        { ...PART_COL, render: (d) => <span className="text-slate-200">{d.id}</span> },
        { label: "Mfr", render: (d) => d.mfr },
        { label: "Dielectric", render: (d) => d.dielectric },
        { label: "C (µF)", render: (d) => fmtNum(d.capUf) },
        { label: "V", render: (d) => fmtNum(d.voltageV) },
        { label: "ESR (mΩ)", render: (d) => fmtNum(d.esrMohm) },
        { label: "Irms (A)", render: (d) => fmtNum(d.iRmsA) },
        { label: PRICE_LABEL, render: (d) => fmtUsd(d.priceUsd1k) },
      ];
      return cols as GenericColumn<unknown>[];
    }
    case "heatsink": {
      const cols: GenericColumn<Heatsink>[] = [
        { ...PART_COL, render: (d) => <span className="text-slate-200">{d.id}</span> },
        { label: "Mfr", render: (d) => d.mfr },
        { label: "Rth s-a nat (°C/W)", render: (d) => fmtNum(d.rthSaCPerWNatural) },
        { label: "Rth s-a 400LFM", render: (d) => fmtNum(d.rthSaCPerWForced) },
        { label: "Height (mm)", render: (d) => fmtNum(d.heightMm) },
        { label: "Footprint (mm)", render: (d) => `${d.footprintMm[0]} × ${d.footprintMm[1]}` },
        { label: "$", render: (d) => fmtUsd(d.priceUsd) },
      ];
      return cols as GenericColumn<unknown>[];
    }
    case "core": {
      const cols: GenericColumn<CoreShape>[] = [
        { label: "Core", sticky: true, render: (d) => <span className="text-slate-200">{d.id}</span> },
        { label: "Mfr", render: (d) => d.mfr },
        { label: "Material", render: (d) => d.materialId },
        { label: "Ae (mm²)", render: (d) => fmtNum(d.aeMm2) },
        { label: "Aw (mm²)", render: (d) => fmtNum(d.awMm2) },
        { label: "Ve (mm³)", render: (d) => fmtNum(d.veMm3) },
        { label: "le (mm)", render: (d) => fmtNum(d.leMm) },
        { label: "MLT (mm)", render: (d) => fmtNum(d.mltMm) },
        { label: "$", render: (d) => fmtUsd(d.priceUsd) },
      ];
      return cols as GenericColumn<unknown>[];
    }
    default:
      return [];
  }
}

export default function ComponentTerminalPage() {
  const [kind, setKind] = useState<Kind>("switch");
  const [cache, setCache] = useState<Partial<Record<Kind, unknown[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switch-view state
  const [q, setQ] = useState("");
  const [tech, setTech] = useState<SwitchTech | "all">("all");
  const [vdsMin, setVdsMin] = useState("");
  const [vdsMax, setVdsMax] = useState("");
  const [sort, setSort] = useState<{ key: SwitchSortKey; dir: SortDir }>({
    key: "fom",
    dir: "asc",
  });
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const load = useCallback(
    async (k: Kind) => {
      if (cache[k]) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/components?kind=${k}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const items = (await res.json()) as unknown[];
        setCache((c) => ({ ...c, [k]: items }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [cache],
  );

  useEffect(() => {
    void load(kind);
  }, [kind, load]);

  const switches = (cache.switch ?? []) as SwitchDevice[];

  const visibleSwitches = useMemo(() => {
    const vMin = vdsMin.trim() === "" ? undefined : Number(vdsMin);
    const vMax = vdsMax.trim() === "" ? undefined : Number(vdsMax);
    const filtered = filterSwitches(switches, {
      q,
      tech,
      vdsMinV: Number.isFinite(vMin as number) ? vMin : undefined,
      vdsMaxV: Number.isFinite(vMax as number) ? vMax : undefined,
    });
    return sortSwitches(filtered, sort.key, sort.dir);
  }, [switches, q, tech, vdsMin, vdsMax, sort]);

  const compared = useMemo(
    () =>
      compareIds
        .map((id) => switches.find((d) => d.id === id))
        .filter((d): d is SwitchDevice => d !== undefined),
    [compareIds, switches],
  );

  const rows: unknown[] = cache[kind] ?? [];
  const cols = genericColumns(kind);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold text-slate-100">Component Terminal</h1>
        <span className="text-xs text-slate-500">
          every wide-bandgap part, searchable and comparable
        </span>
      </div>

      {/* Kind tabs */}
      <div className="flex flex-wrap gap-1 border-b border-ink-600">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => setKind(k.kind)}
            className={`rounded-t-md px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
              kind === k.kind
                ? "border border-b-0 border-ink-600 bg-ink-800 text-volt"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="panel overflow-x-auto p-0" aria-busy="true" aria-label={`loading ${kind} catalog`}>
          <table className={`table-terminal ${kind === "switch" ? "min-w-[900px]" : "min-w-[700px]"}`}>
            <thead>
              <tr>
                {kind === "switch" ? (
                  <>
                    <th className="w-8">Cmp</th>
                    {SWITCH_COLUMNS.map((c) => (
                      <th key={c.key} className={c.align === "right" ? "text-right" : ""}>
                        {c.header ?? c.label}
                      </th>
                    ))}
                    <th>Suppliers</th>
                  </>
                ) : (
                  cols.map((c) => <th key={c.label}>{c.header ?? c.label}</th>)
                )}
              </tr>
            </thead>
            <tbody>
              <SkeletonRows cols={kind === "switch" ? SWITCH_COLUMNS.length + 2 : Math.max(cols.length, 1)} />
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <div className="panel border-[#fb7185]/40 text-sm text-[#fb7185]">
          The component catalog could not be loaded.
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-[#fb7185]/80">technical details</summary>
            <p className="mt-1 text-xs text-[#fb7185]/70">{error}</p>
          </details>
          <button type="button" className="btn mt-2 px-3 py-1 text-xs" onClick={() => void load(kind)}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && kind === "switch" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="block grow sm:max-w-xs">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                Search
              </span>
              <input
                className="input"
                placeholder="part, mfr, package, supplier…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                Tech
              </span>
              <select
                className="input"
                value={tech}
                onChange={(e) => setTech(e.target.value as SwitchTech | "all")}
              >
                {TECH_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block w-24">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                Vds ≥ (V)
              </span>
              <input
                className="input"
                inputMode="decimal"
                value={vdsMin}
                onChange={(e) => setVdsMin(e.target.value)}
              />
            </label>
            <label className="block w-24">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                Vds ≤ (V)
              </span>
              <input
                className="input"
                inputMode="decimal"
                value={vdsMax}
                onChange={(e) => setVdsMax(e.target.value)}
              />
            </label>
            <div className="pb-2 text-xs text-slate-400">
              {visibleSwitches.length} / {switches.length} parts
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            Select up to {COMPARE_MAX} parts (checkbox column) to compare side by side.
          </p>

          {compared.length > 0 && (
            <CompareTray
              devices={compared}
              onRemove={(id) => setCompareIds((ids) => ids.filter((x) => x !== id))}
              onClear={() => setCompareIds([])}
            />
          )}

          <div className="panel relative overflow-x-auto p-0">
            <table className="table-terminal min-w-[900px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 w-8 bg-ink-800">
                    <span title={`compare up to ${COMPARE_MAX}`}>Cmp</span>
                  </th>
                  {SWITCH_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      aria-sort={
                        sort.key === c.key
                          ? sort.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      className={`${c.align === "right" ? "text-right" : ""} ${
                        c.sticky ? "sticky left-8 z-20 bg-ink-800" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-volt"
                        onClick={() => setSort((s) => nextSort(s, c.key))}
                      >
                        {c.header ?? c.label}
                        {sort.key === c.key && (
                          <span className="text-volt">{sort.dir === "asc" ? "▲" : "▼"}</span>
                        )}
                      </button>
                      {c.key === "fom" && (
                        <span className="ml-1 normal-case text-slate-500">(lower = better)</span>
                      )}
                    </th>
                  ))}
                  <th>Suppliers</th>
                </tr>
              </thead>
              <tbody>
                {visibleSwitches.map((d) => (
                  <tr key={d.id}>
                    <td className="sticky left-0 z-10 bg-ink-800">
                      <input
                        type="checkbox"
                        className="accent-cyan-400"
                        checked={compareIds.includes(d.id)}
                        disabled={!compareIds.includes(d.id) && compareIds.length >= COMPARE_MAX}
                        onChange={() => setCompareIds((ids) => toggleCompare(ids, d.id))}
                        aria-label={
                          compareIds.length >= COMPARE_MAX && !compareIds.includes(d.id)
                            ? `compare ${d.id} (disabled — remove another part first, limit ${COMPARE_MAX})`
                            : `compare ${d.id}`
                        }
                      />
                    </td>
                    {SWITCH_COLUMNS.map((c) => (
                      <td
                        key={c.key}
                        className={`${c.align === "right" ? "text-right tabular-nums" : ""} ${
                          c.sticky ? "sticky left-8 z-10 bg-ink-800" : ""
                        }`}
                      >
                        {c.render(d)}
                      </td>
                    ))}
                    <td className="max-w-40 truncate text-slate-400" title={d.suppliers.join(", ")}>
                      {d.suppliers.join(", ")}
                    </td>
                  </tr>
                ))}
                {visibleSwitches.length === 0 && (
                  <tr>
                    <td colSpan={SWITCH_COLUMNS.length + 2} className="py-6 text-center text-slate-400">
                      no parts match the current filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 top-0 h-full w-6 bg-gradient-to-l from-ink-800 to-transparent"
            />
          </div>
        </>
      )}

      {!loading && !error && kind !== "switch" && (
        <div className="panel relative overflow-x-auto p-0">
          <table className="table-terminal min-w-[700px]">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.label} className={c.sticky ? "sticky left-0 z-20 bg-ink-800" : ""}>
                    {c.header ?? c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.label} className={c.sticky ? "sticky left-0 z-10 bg-ink-800" : ""}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(cols.length, 1)} className="py-6 text-center text-slate-400">
                    empty catalog
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 h-full w-6 bg-gradient-to-l from-ink-800 to-transparent"
          />
        </div>
      )}
    </div>
  );
}
