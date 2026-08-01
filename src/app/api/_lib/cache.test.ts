import { describe, expect, it } from "vitest";
import { cachedDesign, designCache, LruCache } from "./cache";
import { BUCK_SPEC } from "./test-fixtures";

describe("LruCache", () => {
  it("stores and retrieves values", () => {
    const c = new LruCache<number>(3);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBe(2);
    expect(c.get("missing")).toBeUndefined();
    expect(c.size).toBe(2);
  });

  it("evicts the least recently used entry beyond capacity", () => {
    const c = new LruCache<number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.set("d", 4); // evicts "a"
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.size).toBe(3);
  });

  it("get() refreshes recency so a hit entry survives eviction", () => {
    const c = new LruCache<number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.get("a"); // "b" is now oldest
    c.set("d", 4);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
  });

  it("set() on an existing key overwrites without growing", () => {
    const c = new LruCache<number>(2);
    c.set("a", 1);
    c.set("a", 10);
    expect(c.get("a")).toBe(10);
    expect(c.size).toBe(1);
  });

  it("holds at most 20 entries at the default capacity", () => {
    const c = new LruCache<number>();
    for (let i = 0; i < 50; i++) c.set(`k${i}`, i);
    expect(c.size).toBe(20);
    expect(c.get("k29")).toBeUndefined();
    expect(c.get("k49")).toBe(49);
  });

  it("rejects capacity < 1", () => {
    expect(() => new LruCache(0)).toThrow();
  });
});

describe("cachedDesign", () => {
  it("returns the identical object for a repeated spec (memoized run)", () => {
    designCache.clear();
    const first = cachedDesign(BUCK_SPEC);
    const second = cachedDesign({ ...BUCK_SPEC });
    // Note: spread preserves key order here, so the JSON keys match.
    expect(second).toBe(first);
    expect(designCache.size).toBe(1);
  });

  it("produces a physically plausible design", () => {
    const r = cachedDesign(BUCK_SPEC);
    expect(r.efficiencyPct).toBeGreaterThan(80);
    expect(r.efficiencyPct).toBeLessThan(99.9);
    expect(r.losses.totalW).toBeGreaterThan(0);
    expect(r.losses.totalW).toBeLessThan(BUCK_SPEC.poutW * 0.25);
    expect(r.bomCostUsd).toBeGreaterThan(0);
  });
});
