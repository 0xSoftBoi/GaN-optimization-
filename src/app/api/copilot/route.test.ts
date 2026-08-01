import { describe, expect, it } from "vitest";
import type { CopilotParse, DesignResult } from "@/lib/types";
import { postJson, postRaw } from "../_lib/test-fixtures";
import { POST } from "./route";

describe("POST /api/copilot — input validation", () => {
  it("400 on a non-JSON body", async () => {
    const res = await POST(postRaw("{{nope"));
    expect(res.status).toBe(400);
  });

  it("400 when prompt is missing", async () => {
    const res = await POST(postJson({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/prompt/);
  });

  it("400 on an empty / whitespace prompt", async () => {
    expect((await POST(postJson({ prompt: "" }))).status).toBe(400);
    expect((await POST(postJson({ prompt: "   " }))).status).toBe(400);
  });

  it("400 on a non-string prompt", async () => {
    const res = await POST(postJson({ prompt: 42 }));
    expect(res.status).toBe(400);
  });

  it("400 on an absurdly long prompt", async () => {
    const res = await POST(postJson({ prompt: "x".repeat(5000) }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/copilot — happy path", () => {
  it("parses a natural-language spec and returns a full design", async () => {
    const res = await POST(
      postJson({
        prompt: "Design a 3kW isolated dc-dc, 400V bus to 48V, forced air, 45C ambient",
      }),
    );
    expect(res.status).toBe(200);
    const { parse, result } = (await res.json()) as {
      parse: CopilotParse;
      result: DesignResult;
    };

    // Parse fidelity
    expect(parse.spec.poutW).toBe(3000);
    expect(parse.spec.vinNomV).toBe(400);
    expect(parse.spec.voutV).toBe(48);
    expect(parse.spec.isolated).toBe(true);
    expect(parse.spec.cooling).toBe("forced-air");
    expect(parse.spec.ambientC).toBe(45);
    expect(parse.confidence).toBeGreaterThan(0);
    expect(parse.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(parse.assumptions)).toBe(true);

    // Design plausibility: isolated request must yield an isolated topology.
    expect(result.topology.isolated).toBe(true);
    expect(result.efficiencyPct).toBeGreaterThan(85);
    expect(result.efficiencyPct).toBeLessThan(99.5);
    expect(result.bom.length).toBeGreaterThan(0);
  });
});
