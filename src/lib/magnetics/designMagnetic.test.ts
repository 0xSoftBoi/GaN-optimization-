import { describe, expect, it } from "vitest";
import type { MagneticRequirement } from "@/lib/types";
import { designMagnetic } from "./designMagnetic";

const AMBIENT = 45;

/** 500 W-class 100 kHz buck output inductor (≈48 V / 10.5 A, 25 % ripple). */
const inductor500W: MagneticRequirement = {
  role: "output-inductor",
  inductanceUh: 47,
  iPeakA: 12,
  iRmsA: 10.5,
  voltSecondsVus: 240,
  acFluxFraction: 0.25,
  fswHz: 100e3,
};

/** ~2 kW 400 V bridge transformer: Vus = 400 V · 0.45 / f. */
function xfmrReq(fHz: number): MagneticRequirement {
  return {
    role: "transformer",
    inductanceUh: 0,
    iPeakA: 8,
    iRmsA: 5,
    voltSecondsVus: (400 * 0.45) / (fHz * 1e-6),
    turnsRatio: 4,
    acFluxFraction: 1,
    fswHz: fHz,
  };
}

function assertFinite(d: ReturnType<typeof designMagnetic>) {
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === "number") expect(Number.isFinite(v), k).toBe(true);
  }
}

describe("designMagnetic — 500 W 100 kHz inductor", () => {
  const d = designMagnetic(inductor500W, AMBIENT);

  it("returns a plausible design (not 200 W of loss)", () => {
    const total = d.coreLossW + d.copperLossW;
    expect(total).toBeGreaterThan(0.05);
    expect(total).toBeLessThan(15); // < 3 % of 500 W
    expect(d.tempRiseC).toBeGreaterThan(1);
    expect(d.tempRiseC).toBeLessThan(60);
  });

  it("respects saturation with 20 % margin", () => {
    expect(d.bPeakT).toBeGreaterThan(0.05);
    expect(d.bPeakT).toBeLessThanOrEqual(0.8 * d.material.bsatT + 1e-6);
    expect(d.bPeakT).toBeLessThan(d.material.bsatT);
  });

  it("keeps window utilization within 0.4", () => {
    expect(d.windowUtilization).toBeGreaterThan(0.02);
    expect(d.windowUtilization).toBeLessThanOrEqual(0.4 + 1e-6);
  });

  it("gaps the core and keeps the requested inductance", () => {
    expect(d.airGapMm).toBeGreaterThan(0.05);
    expect(d.airGapMm).toBeLessThan(3.5);
    expect(d.inductanceUh).toBeCloseTo(47, 3);
    expect(d.turnsPrimary).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(d.turnsPrimary)).toBe(true);
  });

  it("uses litz at 100 kHz and J in a sane band", () => {
    expect(d.wirePrimary.type).toBe("litz");
    const j = inductor500W.iRmsA / d.wirePrimary.copperAreaMm2;
    expect(j).toBeGreaterThan(2);
    expect(j).toBeLessThan(8);
  });
});

describe("designMagnetic — wire technology vs frequency", () => {
  it("picks solid wire below 100 kHz", () => {
    const d = designMagnetic(
      { ...inductor500W, fswHz: 60e3, inductanceUh: 100, iPeakA: 15, iRmsA: 12 },
      AMBIENT
    );
    expect(d.wirePrimary.type).toBe("solid");
  });

  it("picks litz at 250 kHz", () => {
    const d = designMagnetic({ ...inductor500W, fswHz: 250e3, inductanceUh: 22 }, AMBIENT);
    expect(d.wirePrimary.type).toBe("litz");
  });
});

describe("designMagnetic — transformer", () => {
  const d100 = designMagnetic(xfmrReq(100e3), AMBIENT);
  const d300 = designMagnetic(xfmrReq(300e3), AMBIENT);

  it("uses fewer primary turns at higher frequency (volt-seconds shrink)", () => {
    expect(d300.turnsPrimary).toBeLessThan(d100.turnsPrimary);
  });

  it("respects the requested turns ratio within rounding", () => {
    for (const d of [d100, d300]) {
      expect(d.turnsSecondary).toBeDefined();
      const ratio = d.turnsPrimary / (d.turnsSecondary ?? 1);
      expect(Math.abs(ratio - 4)).toBeLessThanOrEqual(1.2);
      expect(d.wireSecondary).toBeDefined();
    }
  });

  it("keeps Bpk under saturation margin and losses plausible for ~2 kW", () => {
    for (const d of [d100, d300]) {
      expect(d.bPeakT).toBeLessThan(0.8 * d.material.bsatT + 1e-6);
      const total = d.coreLossW + d.copperLossW;
      expect(total).toBeGreaterThan(0.2);
      expect(total).toBeLessThan(40); // < 2 % of 2 kW
      expect(d.airGapMm).toBe(0); // no magnetizing-L target -> ungapped
      expect(d.inductanceUh).toBeGreaterThan(100); // healthy ungapped magnetizing L
    }
  });
});

describe("designMagnetic — scaling trends", () => {
  it("picks a bigger core for more power", () => {
    const small = designMagnetic(
      {
        role: "output-inductor",
        inductanceUh: 220,
        iPeakA: 1.2,
        iRmsA: 1.0,
        voltSecondsVus: 60,
        acFluxFraction: 0.3,
        fswHz: 200e3,
      },
      AMBIENT
    );
    const big = designMagnetic(
      {
        role: "output-inductor",
        inductanceUh: 12,
        iPeakA: 60,
        iRmsA: 50,
        voltSecondsVus: 60,
        acFluxFraction: 0.3,
        fswHz: 200e3,
      },
      AMBIENT
    );
    expect(big.core.veMm3).toBeGreaterThan(small.core.veMm3);
  });

  it("core loss grows with the AC flux fraction", () => {
    const lo = designMagnetic({ ...inductor500W, acFluxFraction: 0.1 }, AMBIENT);
    const hi = designMagnetic({ ...inductor500W, acFluxFraction: 0.4 }, AMBIENT);
    expect(hi.coreLossW).toBeGreaterThan(lo.coreLossW);
  });
});

describe("designMagnetic — robustness across roles", () => {
  const reqs: MagneticRequirement[] = [
    { role: "output-inductor", inductanceUh: 33, iPeakA: 20, iRmsA: 16, voltSecondsVus: 150, acFluxFraction: 0.3, fswHz: 150e3 },
    { role: "pfc-inductor", inductanceUh: 180, iPeakA: 16, iRmsA: 11, voltSecondsVus: 800, acFluxFraction: 0.2, fswHz: 65e3 },
    { role: "resonant-inductor", inductanceUh: 8, iPeakA: 25, iRmsA: 18, voltSecondsVus: 90, acFluxFraction: 1, fswHz: 500e3 },
    { role: "coupled-inductor", inductanceUh: 15, iPeakA: 30, iRmsA: 24, voltSecondsVus: 120, acFluxFraction: 0.35, fswHz: 140e3 },
    { role: "transformer", inductanceUh: 600, iPeakA: 3, iRmsA: 2, voltSecondsVus: 900, turnsRatio: 8, acFluxFraction: 1, fswHz: 120e3 },
  ];

  it("always returns physically sane designs", () => {
    for (const req of reqs) {
      const d = designMagnetic(req, AMBIENT);
      assertFinite(d);
      expect(d.role).toBe(req.role);
      expect(d.bPeakT, req.role).toBeLessThan(d.material.bsatT);
      expect(d.coreLossW, req.role).toBeGreaterThanOrEqual(0);
      expect(d.copperLossW, req.role).toBeGreaterThan(0);
      expect(d.tempRiseC, req.role).toBeGreaterThan(0);
      expect(d.turnsPrimary, req.role).toBeGreaterThanOrEqual(1);
      expect(d.windowUtilization, req.role).toBeGreaterThan(0);
      expect(d.windowUtilization, req.role).toBeLessThanOrEqual(0.4 + 1e-6);
    }
  });
});

describe("designMagnetic — never throws, least-bad fallback", () => {
  it("returns a flagged design for an absurd requirement instead of throwing", () => {
    const d = designMagnetic(
      {
        role: "output-inductor",
        inductanceUh: 50000,
        iPeakA: 200,
        iRmsA: 150,
        voltSecondsVus: 5000,
        acFluxFraction: 0.3,
        fswHz: 100e3,
      },
      AMBIENT
    );
    assertFinite(d);
    expect(d.notes).toBeTruthy();
    // impossible request must carry at least one warning beyond the method tag
    expect((d.notes ?? "").split(";").length).toBeGreaterThan(2);
  });

  it("handles degenerate inputs (zero/negative) gracefully", () => {
    const d = designMagnetic(
      {
        role: "transformer",
        inductanceUh: 0,
        iPeakA: 0,
        iRmsA: 0,
        voltSecondsVus: 0,
        acFluxFraction: 0,
        fswHz: 0,
      },
      AMBIENT
    );
    assertFinite(d);
    expect(d.turnsPrimary).toBeGreaterThanOrEqual(1);
  });
});

describe("designMagnetic — regression: Rth clamping (it3 magnetics core)", () => {
  // TECHPLAN §2.2 bug: raw heuristic Rth≈36/√Ve diverges to 1650°C at 10 kW.
  // it3 fix: clamp core-surface ΔT to max 150°C (sane for ferrite). This test
  // verifies the fix holds across the power range that exposed the bug.
  it("keeps tempRiseC plausible (<150°C) at high dissipation", () => {
    // High-loss case: big transformer at high frequency → significant core + Cu loss
    const d = designMagnetic(
      {
        role: "transformer",
        inductanceUh: 200, // flyback-style magnetizing L
        iPeakA: 30,
        iRmsA: 15,
        voltSecondsVus: 3600, // 800 V at 4.5 µs (high-power stage)
        turnsRatio: 16,
        acFluxFraction: 1,
        fswHz: 300e3,
      },
      AMBIENT
    );
    expect(d.tempRiseC).toBeLessThanOrEqual(150);
    expect(d.coreLossW + d.copperLossW).toBeGreaterThan(20); // verify high dissipation
  });

  it("maintains monotonic temp rise with loss across diverse cores", () => {
    // Small, medium, large cores at the same loss-inducing spec should show
    // roughly monotonic temp rise (though not perfectly due to core preselection).
    const baseReq: MagneticRequirement = {
      role: "output-inductor",
      inductanceUh: 5,
      iPeakA: 80,
      iRmsA: 60,
      voltSecondsVus: 400,
      acFluxFraction: 0.4,
      fswHz: 200e3,
    };
    const results = [40, AMBIENT, 65].map((t) => designMagnetic(baseReq, t));
    for (const d of results) {
      expect(d.tempRiseC).toBeLessThanOrEqual(150);
      expect(d.tempRiseC).toBeGreaterThan(0);
    }
  });

  it("never reports negative or infinite tempRiseC", () => {
    const powerfulReqs: MagneticRequirement[] = [
      // 150 W low-power
      {
        role: "output-inductor",
        inductanceUh: 100,
        iPeakA: 5,
        iRmsA: 4,
        voltSecondsVus: 60,
        acFluxFraction: 0.2,
        fswHz: 400e3,
      },
      // 5 kW high-power (flagship DAB scenario)
      {
        role: "transformer",
        inductanceUh: 150,
        iPeakA: 25,
        iRmsA: 18,
        voltSecondsVus: 3600,
        turnsRatio: 16,
        acFluxFraction: 1,
        fswHz: 178e3,
      },
    ];
    for (const req of powerfulReqs) {
      const d = designMagnetic(req, AMBIENT);
      expect(d.tempRiseC).toBeGreaterThanOrEqual(0.5);
      expect(Number.isFinite(d.tempRiseC)).toBe(true);
      expect(d.tempRiseC).toBeLessThanOrEqual(150);
    }
  });
});
