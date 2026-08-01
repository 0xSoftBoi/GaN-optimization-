/**
 * Component-terminal logic: switch filtering, sorting, and figure-of-merit
 * math. Pure TS so it is unit-testable without a DOM.
 */

import type { SwitchDevice, SwitchTech } from "@/lib/types";

// ---------------------------------------------------------------------------
// Figure of merit
// ---------------------------------------------------------------------------

/** Classic hard-switching FoM: Rds(on)·Qg in mΩ·nC. Lower is better. */
export function fomMohmNc(d: Pick<SwitchDevice, "rdsOnMohm25" | "qgNc">): number {
  return d.rdsOnMohm25 * d.qgNc;
}

export interface FomBar {
  id: string;
  mfr: string;
  tech: SwitchTech;
  /** Rds·Qg, mΩ·nC. */
  fom: number;
  /** fom / best fom in the set (best = 1.0, larger = worse). */
  ratioToBest: number;
  /** fom / max fom in the set (0..1] — direct bar length. */
  fracOfWorst: number;
  best: boolean;
}

/**
 * Normalize the compared devices' FoM for the bar chart. Lower FoM is
 * better; the best device gets ratioToBest = 1.
 */
export function normalizedFomBars(devices: SwitchDevice[]): FomBar[] {
  if (devices.length === 0) return [];
  const foms = devices.map(fomMohmNc);
  const best = Math.min(...foms);
  const worst = Math.max(...foms);
  return devices.map((d, i) => ({
    id: d.id,
    mfr: d.mfr,
    tech: d.tech,
    fom: foms[i],
    ratioToBest: best > 0 ? foms[i] / best : 1,
    fracOfWorst: worst > 0 ? foms[i] / worst : 1,
    best: foms[i] === best,
  }));
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface SwitchFilter {
  /** Free-text over id / mfr / pkg / notes / suppliers, case-insensitive. */
  q: string;
  tech: SwitchTech | "all";
  /** Vds rating range, V. Undefined bound = open. */
  vdsMinV?: number;
  vdsMaxV?: number;
}

export const EMPTY_FILTER: SwitchFilter = { q: "", tech: "all" };

export function filterSwitches(rows: SwitchDevice[], f: SwitchFilter): SwitchDevice[] {
  const needle = f.q.trim().toLowerCase();
  return rows.filter((d) => {
    if (f.tech !== "all" && d.tech !== f.tech) return false;
    if (f.vdsMinV !== undefined && d.vdsMaxV < f.vdsMinV) return false;
    if (f.vdsMaxV !== undefined && d.vdsMaxV > f.vdsMaxV) return false;
    if (needle) {
      const hay = [d.id, d.mfr, d.pkg, d.notes ?? "", ...d.suppliers]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SwitchSortKey =
  | "id"
  | "mfr"
  | "tech"
  | "vdsMaxV"
  | "idMaxA"
  | "rdsOnMohm25"
  | "qgNc"
  | "qossNc"
  | "qrrNc"
  | "fom"
  | "priceUsd1k";

export type SortDir = "asc" | "desc";

function sortValue(d: SwitchDevice, key: SwitchSortKey): number | string {
  if (key === "fom") return fomMohmNc(d);
  return d[key];
}

/** Stable sort by column; strings case-insensitive, numbers numeric. */
export function sortSwitches(
  rows: SwitchDevice[],
  key: SwitchSortKey,
  dir: SortDir,
): SwitchDevice[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const va = sortValue(a.d, key);
      const vb = sortValue(b.d, key);
      let cmp: number;
      if (typeof va === "string" || typeof vb === "string") {
        cmp = String(va).toLowerCase().localeCompare(String(vb).toLowerCase());
      } else {
        cmp = va - vb;
      }
      return cmp !== 0 ? sign * cmp : a.i - b.i; // stable
    })
    .map((x) => x.d);
}

/**
 * Click-a-header state transition: same column toggles direction, a new
 * column starts at its natural direction (ascending for numbers where lower
 * is better feels right everywhere, so ascending always).
 */
export function nextSort(
  current: { key: SwitchSortKey; dir: SortDir },
  clicked: SwitchSortKey,
): { key: SwitchSortKey; dir: SortDir } {
  if (current.key === clicked) {
    return { key: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key: clicked, dir: "asc" };
}

// ---------------------------------------------------------------------------
// Compare tray
// ---------------------------------------------------------------------------

export const COMPARE_MAX = 4;

/** Toggle membership, enforcing the ≤4 tray limit (no-op when full). */
export function toggleCompare(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  if (ids.length >= COMPARE_MAX) return ids;
  return [...ids, id];
}
