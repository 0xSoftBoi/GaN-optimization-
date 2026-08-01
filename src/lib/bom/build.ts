/**
 * BOM builder.
 *
 * Pricing hand-off (documented design choice, see src/lib/schematic/build.ts):
 * `buildSchematic` annotates every component it emits with a structural
 * `meta` field ({ mfr, description, unitPriceUsd, suppliers }) on top of the
 * frozen NetlistComponent shape. `buildBom` reads that field when present and
 * falls back to a conservative per-kind price table otherwise, so it also
 * works on bare NetlistComponents from other sources.
 */

import type { BomLine, NetlistComponent, Schematic } from "@/lib/types";

interface Meta {
  mfr: string;
  description: string;
  unitPriceUsd: number;
  suppliers: string[];
}

type MaybeAnnotated = NetlistComponent & { meta?: Meta };

/** Conservative unit-price fallbacks (USD @ 1k) when no meta is attached. */
const FALLBACK_PRICE_USD: Record<NetlistComponent["kind"], number> = {
  switch: 2.5,
  diode: 0.28,
  inductor: 2.2,
  transformer: 6.5,
  capacitor: 0.38,
  resistor: 0.02,
  driver: 1.2,
  controller: 3.8,
  connector: 1.4,
};

const REF_ORDER = ["Q", "D", "T", "L", "C", "R", "U", "J"];

function refKey(ref: string): [number, number] {
  const m = /^([A-Za-z]+)(\d+)/.exec(ref);
  const p = m ? REF_ORDER.indexOf(m[1].toUpperCase()) : -1;
  return [p === -1 ? REF_ORDER.length : p, m ? parseInt(m[2], 10) : 0];
}

const natural = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });
const round2 = (x: number): number => Math.round(x * 100) / 100;

export function buildBom(sch: Schematic, extras?: BomLine[]): { lines: BomLine[]; totalUsd: number } {
  // Group identical partIds; unpriced generic parts group by kind+value.
  const groups = new Map<string, MaybeAnnotated[]>();
  for (const c of sch.components as MaybeAnnotated[]) {
    const key = c.partId ?? `generic-${c.kind}-${c.value}`;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }

  const lines: BomLine[] = [];
  for (const [key, g] of groups) {
    const first = g[0];
    const meta = g.find((c) => c.meta)?.meta;
    const qty = g.length;
    const unit = round2(meta?.unitPriceUsd ?? FALLBACK_PRICE_USD[first.kind]);
    lines.push({
      ref: g.map((c) => c.ref).sort(natural),
      partId: key,
      mfr: meta?.mfr ?? "generic",
      description: meta?.description ?? `${first.kind} ${first.value}`,
      qty,
      unitPriceUsd: unit,
      extPriceUsd: round2(qty * unit),
      suppliers: [...(meta?.suppliers ?? [])],
    });
  }

  // Extras: merge into an existing line on partId match, else append.
  for (const e of extras ?? []) {
    const hit = lines.find((l) => l.partId === e.partId);
    if (hit) {
      hit.ref = [...hit.ref, ...e.ref].sort(natural);
      hit.qty += e.qty;
      hit.extPriceUsd = round2(hit.extPriceUsd + e.extPriceUsd);
    } else {
      lines.push({ ...e, ref: [...e.ref], suppliers: [...e.suppliers] });
    }
  }

  lines.sort((a, b) => {
    const ka = refKey(a.ref[0] ?? "");
    const kb = refKey(b.ref[0] ?? "");
    return ka[0] - kb[0] || ka[1] - kb[1];
  });

  const totalUsd = round2(lines.reduce((s, l) => s + l.extPriceUsd, 0));
  return { lines, totalUsd };
}
