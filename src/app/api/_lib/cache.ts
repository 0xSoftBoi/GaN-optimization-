/**
 * VoltForge API — tiny in-memory LRU shared by the heavy routes
 * (/api/design, /api/copilot, /api/optimize, /api/firmware, /api/spice).
 *
 * A full designConverter() run sweeps topologies × devices × fsw, so repeat
 * requests for the same spec (common when a UI fetches /design then /spice
 * then /firmware) must not recompute. Keyed on JSON.stringify(spec) — the
 * validator builds spec objects with a deterministic key order, so equal
 * specs serialize identically.
 *
 * Module-level state is per server instance (fine for a single Vercel
 * lambda / dev server; a cold start simply begins empty).
 */

import { designConverter } from "@/lib/optimizer";
import type { DesignResult, DesignSpec } from "@/lib/types";

/** Least-recently-used cache over string keys. Map preserves insertion
 *  order, so the first key is always the least recently used. */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(readonly capacity: number = 20) {
    if (!(capacity >= 1)) throw new Error(`LruCache capacity must be >= 1, got ${capacity}`);
  }

  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    // Refresh recency: re-insert at the tail.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

/** One shared cache of full design runs, 20 entries. */
export const designCache = new LruCache<DesignResult>(20);

/** Run the optimizer composition root, memoized on the serialized spec. */
export function cachedDesign(spec: DesignSpec): DesignResult {
  const key = JSON.stringify(spec);
  const hit = designCache.get(key);
  if (hit !== undefined) return hit;
  const result = designConverter(spec);
  designCache.set(key, result);
  return result;
}
