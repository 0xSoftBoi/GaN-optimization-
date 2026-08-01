import { describe, expect, it } from "vitest";
import { parsePrompt } from "./parse-prompt";

describe("parsePrompt — flagship datacenter prompt", () => {
  const p = parsePrompt(
    "Design a 5kW bidirectional converter, 800V bus to 48V, forced air, 40C",
  );

  it("extracts every explicit field", () => {
    expect(p.spec.poutW).toBe(5000);
    expect(p.spec.bidirectional).toBe(true);
    expect(p.spec.vinNomV).toBe(800);
    expect(p.spec.voutV).toBe(48);
    expect(p.spec.cooling).toBe("forced-air");
    expect(p.spec.ambientC).toBe(40);
    expect(p.spec.conversion).toBe("dc-dc");
  });

  it("fills the vin range at ±10% and defaults isolation on for a 16.7:1 ratio", () => {
    expect(p.spec.vinMinV).toBeCloseTo(720, 0);
    expect(p.spec.vinMaxV).toBeCloseTo(880, 0);
    expect(p.spec.isolated).toBe(true);
    expect(p.assumptions.join(" ")).toMatch(/ratio|8:1/i);
  });

  it("is confident and leaves nothing unrecognized", () => {
    expect(p.confidence).toBeGreaterThan(0.6);
    expect(p.unrecognized).toEqual([]);
  });
});

describe("parsePrompt — ac-dc / PFC", () => {
  it("parses '1kW 230Vac PFC front end' as ac-dc with gridVacRms 230", () => {
    const p = parsePrompt("1kW 230Vac PFC front end");
    expect(p.spec.conversion).toBe("ac-dc");
    expect(p.spec.gridVacRms).toBe(230);
    expect(p.spec.poutW).toBe(1000);
    // vin* is the rectified bus feeding the PFC: ~325 V nominal for 230 Vac.
    expect(p.spec.vinNomV).toBeGreaterThan(300);
    expect(p.spec.vinNomV).toBeLessThan(360);
    expect(p.spec.vinMinV).toBeLessThan(p.spec.vinNomV);
    expect(p.spec.vinMaxV).toBeGreaterThan(p.spec.vinNomV);
    // Default PFC output bus and mains-connected isolation default.
    expect(p.spec.voutV).toBe(400);
    expect(p.spec.isolated).toBe(true);
    expect(p.unrecognized).toEqual([]);
  });

  it("treats grid/mains keywords as ac-dc even without a Vac number", () => {
    const p = parsePrompt("3kW grid-tied rectifier to 48V");
    expect(p.spec.conversion).toBe("ac-dc");
    expect(p.spec.gridVacRms).toBe(230); // assumed, and recorded
    expect(p.assumptions.join(" ")).toMatch(/230 Vac/);
  });

  it("does not mistake 50/60 Hz line frequency for a switching frequency", () => {
    const p = parsePrompt("800W 230Vac 50Hz PFC");
    expect(p.spec.fswHz).toBeUndefined();
  });
});

describe("parsePrompt — defaults are recorded as assumptions", () => {
  const p = parsePrompt("300W 48V to 12V");

  it("applies the documented defaults", () => {
    expect(p.spec.conversion).toBe("dc-dc");
    expect(p.spec.ambientC).toBe(45);
    expect(p.spec.maxJunctionC).toBe(125);
    expect(p.spec.rippleVoutPct).toBe(1);
    expect(p.spec.cooling).toBe("natural"); // 300 W ≤ 500 W
    expect(p.spec.isolated).toBe(false); // 4:1 ratio ≤ 8
    expect(p.spec.vinMinV).toBeCloseTo(43.2, 1);
    expect(p.spec.vinMaxV).toBeCloseTo(52.8, 1);
  });

  it("writes one assumption per invented default", () => {
    const all = p.assumptions.join(" | ");
    expect(all).toMatch(/45\s*°?C/i); // ambient
    expect(all).toMatch(/125\s*°?C/i); // junction
    expect(all).toMatch(/ripple/i);
    expect(all).toMatch(/±10\s*%|10\s*%/); // vin range
    expect(all).toMatch(/non-isolated/i);
    expect(all).toMatch(/dc-dc/i);
    expect(p.assumptions.length).toBeGreaterThanOrEqual(5);
  });
});

describe("parsePrompt — garbage in, usable spec out", () => {
  const p = parsePrompt("Blorf the purple monkey dishwasher qux");

  it("still returns a complete, physically sane spec", () => {
    expect(p.spec.poutW).toBeGreaterThan(0);
    expect(p.spec.vinNomV).toBeGreaterThan(0);
    expect(p.spec.voutV).toBeGreaterThan(0);
    expect(p.spec.vinMinV).toBeLessThan(p.spec.vinNomV);
    expect(p.spec.vinMaxV).toBeGreaterThan(p.spec.vinNomV);
    expect(["natural", "forced-air", "liquid", "cold-plate"]).toContain(p.spec.cooling);
  });

  it("reports low confidence and collects the odd tokens", () => {
    expect(p.confidence).toBeLessThan(0.3);
    expect(p.unrecognized).toContain("blorf");
    expect(p.unrecognized).toContain("dishwasher");
    expect(p.unrecognized.length).toBeGreaterThanOrEqual(4);
  });
});

describe("parsePrompt — voltages", () => {
  it("parses 'from X down to Y' phrasing", () => {
    const p = parsePrompt("2kW from 400 V down to 12V");
    expect(p.spec.vinNomV).toBe(400);
    expect(p.spec.voutV).toBe(12);
  });

  it("parses a telecom input range and snaps the nominal to 48 V", () => {
    const p = parsePrompt("500W 36-75V in to 12V isolated brick");
    expect(p.spec.vinMinV).toBe(36);
    expect(p.spec.vinMaxV).toBe(75);
    expect(p.spec.vinNomV).toBe(48);
    expect(p.spec.voutV).toBe(12);
    expect(p.spec.isolated).toBe(true); // explicit keyword
  });

  it("parses tagged single voltages ('48V output', '800V dc link')", () => {
    const p = parsePrompt("1kW 800V dc link, 48V output");
    expect(p.spec.vinNomV).toBe(800);
    expect(p.spec.voutV).toBe(48);
  });

  it("handles boost direction (vout > vin)", () => {
    const p = parsePrompt("500W 12V to 48V boost");
    expect(p.spec.vinNomV).toBe(12);
    expect(p.spec.voutV).toBe(48);
    expect(p.spec.isolated).toBe(false); // 4:1, dc-dc
  });

  it("always keeps vinMin ≤ vinNom ≤ vinMax", () => {
    for (const prompt of [
      "5kW 800V to 48V",
      "1kW 230Vac PFC",
      "100W 36-75V in to 5V",
      "nonsense words only",
      "750W GPU rail",
    ]) {
      const { spec } = parsePrompt(prompt);
      expect(spec.vinMinV).toBeLessThanOrEqual(spec.vinNomV);
      expect(spec.vinMaxV).toBeGreaterThanOrEqual(spec.vinNomV);
    }
  });
});

describe("parsePrompt — cooling", () => {
  it("recognizes all four cooling styles", () => {
    expect(parsePrompt("1kW 48V to 12V liquid cooled").spec.cooling).toBe("liquid");
    expect(parsePrompt("1kW 48V to 12V on a cold plate").spec.cooling).toBe("cold-plate");
    expect(parsePrompt("1kW 48V to 12V with a fan").spec.cooling).toBe("forced-air");
    expect(parsePrompt("1kW 48V to 12V fanless").spec.cooling).toBe("natural");
    expect(parsePrompt("100W 24V to 5V passive cooling").spec.cooling).toBe("natural");
  });

  it("defaults forced-air above 500 W and natural below", () => {
    expect(parsePrompt("2kW 400V to 48V").spec.cooling).toBe("forced-air");
    expect(parsePrompt("200W 24V to 5V").spec.cooling).toBe("natural");
  });
});

describe("parsePrompt — keywords and scalar fields", () => {
  it("parses switching frequency", () => {
    expect(parsePrompt("1kW 48V to 12V at 500kHz").spec.fswHz).toBe(500_000);
    expect(parsePrompt("300W 48V to 12V at 2 MHz").spec.fswHz).toBe(2_000_000);
  });

  it("parses efficiency target and cost ceiling", () => {
    const p = parsePrompt("2kW 400V to 48V, 97% efficiency, $200 budget");
    expect(p.spec.targetEfficiencyPct).toBe(97);
    expect(p.spec.costCeilingUsd).toBe(200);
    expect(parsePrompt("1kW 48V to 12V under 150 USD").spec.costCeilingUsd).toBe(150);
  });

  it("reads a bare high percentage as an efficiency target", () => {
    expect(parsePrompt("3kW 800V to 48V, 98%").spec.targetEfficiencyPct).toBe(98);
  });

  it("parses ripple in % and in mV (converted to % of vout)", () => {
    expect(parsePrompt("1kW 48V to 12V with 0.5% ripple").spec.rippleVoutPct).toBe(0.5);
    const mv = parsePrompt("1kW 48V to 12V with 50mV ripple").spec.rippleVoutPct!;
    expect(mv).toBeGreaterThan(0.3);
    expect(mv).toBeLessThan(0.6); // 50 mV on 12 V ≈ 0.42 %
  });

  it("detects bidirectional synonyms and defaults to unidirectional", () => {
    expect(parsePrompt("2kW 800V to 400V regenerative charger").spec.bidirectional).toBe(true);
    expect(parsePrompt("2kW 800V to 400V").spec.bidirectional).toBe(false);
  });

  it("honors an explicit non-isolated request even at a >8:1 ratio", () => {
    const p = parsePrompt("1kW non-isolated 400V to 12V");
    expect(p.spec.isolated).toBe(false);
  });

  it("turns isolation on for the 'transformer' keyword at a low ratio", () => {
    expect(parsePrompt("500W 48V to 12V with transformer isolation").spec.isolated).toBe(true);
  });

  it("parses ambient and junction temperatures separately", () => {
    expect(parsePrompt("1kW 48V to 12V, 40C ambient").spec.ambientC).toBe(40);
    expect(parsePrompt("1kW 48V to 12V at 70 °C").spec.ambientC).toBe(70);
    const tj = parsePrompt("2kW 400V to 48V, Tj 150C");
    expect(tj.spec.maxJunctionC).toBe(150);
    expect(tj.spec.ambientC).toBe(45); // still the default
  });
});

describe("parsePrompt — datacenter idioms", () => {
  it("expands 'GPU rail' into a 48 V → 12 V module", () => {
    const p = parsePrompt("800W GPU rail");
    expect(p.spec.vinNomV).toBe(48);
    expect(p.spec.voutV).toBe(12);
    expect(p.spec.poutW).toBe(800);
    expect(p.assumptions.join(" ")).toMatch(/GPU/i);
  });

  it("expands 'rack power' into a 48 V / 3 kW shelf", () => {
    const p = parsePrompt("rack power shelf");
    expect(p.spec.voutV).toBe(48);
    expect(p.spec.poutW).toBe(3000);
  });
});

describe("parsePrompt — confidence behaves monotonically", () => {
  it("orders fully specified > partially specified > garbage", () => {
    const full = parsePrompt(
      "Design a 5kW bidirectional converter, 800V bus to 48V, forced air, 40C",
    ).confidence;
    const partial = parsePrompt("300W 48V to 12V").confidence;
    const garbage = parsePrompt("Blorf the purple monkey dishwasher qux").confidence;
    expect(full).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(garbage);
    for (const c of [full, partial, garbage]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("stays deterministic call-to-call", () => {
    const a = parsePrompt("1kW 230Vac PFC front end");
    const b = parsePrompt("1kW 230Vac PFC front end");
    expect(a).toEqual(b);
  });

  it("handles the empty prompt", () => {
    const p = parsePrompt("");
    expect(p.spec.poutW).toBeGreaterThan(0);
    expect(p.confidence).toBeLessThanOrEqual(0.1);
    expect(p.unrecognized).toEqual([]);
  });
});
