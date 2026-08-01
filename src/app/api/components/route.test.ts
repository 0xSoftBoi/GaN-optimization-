import { describe, expect, it } from "vitest";
import type {
  CapacitorPart,
  ControllerPart,
  CoreShape,
  GateDriver,
  Heatsink,
  SwitchDevice,
} from "@/lib/types";
import { GET } from "./route";

function get(query: string): Promise<Response> {
  return GET(new Request(`http://test/api/components${query}`));
}

describe("GET /api/components — validation", () => {
  it("400 when kind is missing", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.join(" ")).toMatch(/kind/);
  });

  it("400 on an unknown kind", async () => {
    expect((await get("?kind=flux-capacitor")).status).toBe(400);
  });

  it("400 on an unknown tech", async () => {
    expect((await get("?kind=switch&tech=Ge")).status).toBe(400);
  });

  it("400 on non-numeric or negative numeric filters", async () => {
    expect((await get("?kind=switch&minVdsV=lots")).status).toBe(400);
    expect((await get("?kind=switch&maxRdsOnMohm=-3")).status).toBe(400);
  });
});

describe("GET /api/components — switch catalog", () => {
  it("returns the full switch catalog as an array", async () => {
    const res = await get("?kind=switch");
    expect(res.status).toBe(200);
    const items = (await res.json()) as SwitchDevice[];
    expect(items.length).toBeGreaterThanOrEqual(40);
    for (const d of items.slice(0, 5)) {
      expect(typeof d.id).toBe("string");
      expect(d.vdsMaxV).toBeGreaterThan(0);
      expect(d.rdsOnMohm25).toBeGreaterThan(0);
    }
  });

  it("tech filter returns only that technology", async () => {
    const items = (await (await get("?kind=switch&tech=GaN")).json()) as SwitchDevice[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((d) => d.tech === "GaN")).toBe(true);
  });

  it("minVdsV filter is respected and monotonic", async () => {
    const v600 = (await (await get("?kind=switch&minVdsV=600")).json()) as SwitchDevice[];
    const v900 = (await (await get("?kind=switch&minVdsV=900")).json()) as SwitchDevice[];
    expect(v600.length).toBeGreaterThan(0);
    expect(v600.every((d) => d.vdsMaxV >= 600)).toBe(true);
    expect(v900.length).toBeLessThanOrEqual(v600.length);
  });

  it("maxRdsOnMohm filter is respected", async () => {
    const items = (await (
      await get("?kind=switch&maxRdsOnMohm=10")
    ).json()) as SwitchDevice[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((d) => d.rdsOnMohm25 <= 10)).toBe(true);
  });

  it("filters compose (subset of the unfiltered catalog)", async () => {
    const all = (await (await get("?kind=switch")).json()) as SwitchDevice[];
    const filtered = (await (
      await get("?kind=switch&tech=GaN&minVdsV=600&maxRdsOnMohm=100")
    ).json()) as SwitchDevice[];
    expect(filtered.length).toBeLessThanOrEqual(all.length);
    expect(
      filtered.every((d) => d.tech === "GaN" && d.vdsMaxV >= 600 && d.rdsOnMohm25 <= 100),
    ).toBe(true);
  });

  it("q free-text search matches part ids / manufacturers case-insensitively", async () => {
    const all = (await (await get("?kind=switch")).json()) as SwitchDevice[];
    const mfr = all[0].mfr;
    const items = (await (
      await get(`?kind=switch&q=${encodeURIComponent(mfr.toLowerCase())}`)
    ).json()) as SwitchDevice[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(all.length);
  });

  it("q with garbage returns an empty array, not an error", async () => {
    const res = await get("?kind=switch&q=zzz-no-such-part-9000");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /api/components — other catalogs", () => {
  it("driver", async () => {
    const items = (await (await get("?kind=driver")).json()) as GateDriver[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].peakSourceA).toBeGreaterThan(0);
  });

  it("controller", async () => {
    const items = (await (await get("?kind=controller")).json()) as ControllerPart[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].coreMhz).toBeGreaterThan(0);
  });

  it("capacitor", async () => {
    const items = (await (await get("?kind=capacitor")).json()) as CapacitorPart[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].capUf).toBeGreaterThan(0);
  });

  it("heatsink", async () => {
    const items = (await (await get("?kind=heatsink")).json()) as Heatsink[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].rthSaCPerWNatural).toBeGreaterThan(0);
  });

  it("core", async () => {
    const items = (await (await get("?kind=core")).json()) as CoreShape[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].aeMm2).toBeGreaterThan(0);
    expect(items[0].veMm3).toBeGreaterThan(0);
  });
});
