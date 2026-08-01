import { describe, expect, it } from "vitest";
import type { FirmwarePackage } from "@/lib/types";
import { BUCK_SPEC, postJson, postRaw } from "../_lib/test-fixtures";
import { POST } from "./route";

describe("POST /api/firmware — validation", () => {
  it("400 on malformed JSON", async () => {
    expect((await POST(postRaw("<xml/>"))).status).toBe(400);
  });

  it("400 on a bad spec", async () => {
    const res = await POST(postJson({ spec: { poutW: 100 } }));
    expect(res.status).toBe(400);
  });

  it("400 on an unknown target", async () => {
    const res = await POST(postJson({ spec: BUCK_SPEC, target: "ATmega328" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/target/);
  });
});

describe("POST /api/firmware — happy path", () => {
  it("defaults to STM32G474 and returns a complete package", async () => {
    const res = await POST(postJson({ spec: BUCK_SPEC }));
    expect(res.status).toBe(200);
    const fw = (await res.json()) as FirmwarePackage;
    expect(fw.target).toBe("STM32G474");
    expect(fw.files.length).toBeGreaterThan(0);
    expect(typeof fw.summary).toBe("string");
    expect(fw.files.some((f) => f.path === "config.h")).toBe(true);
    for (const f of fw.files) {
      expect(f.path.length).toBeGreaterThan(0);
      expect(f.contents.length).toBeGreaterThan(0);
    }
  });

  it("honors target=TMS320F280049 and emits different sources than the STM32 build", async () => {
    const stm = (await (
      await POST(postJson({ spec: BUCK_SPEC }))
    ).json()) as FirmwarePackage;
    const res = await POST(postJson({ spec: BUCK_SPEC, target: "TMS320F280049" }));
    expect(res.status).toBe(200);
    const c2000 = (await res.json()) as FirmwarePackage;
    expect(c2000.target).toBe("TMS320F280049");
    expect(c2000.files.length).toBeGreaterThan(0);
    const stmAll = stm.files.map((f) => f.contents).join("\n");
    const c2000All = c2000.files.map((f) => f.contents).join("\n");
    expect(c2000All).not.toEqual(stmAll);
  });
});
