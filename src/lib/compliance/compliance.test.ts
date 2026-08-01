import { describe, expect, it } from "vitest";
import type {
  DesignSpec,
  DeviceLoss,
  SwitchDevice,
  ThermalReport,
  TopologyInfo,
} from "@/lib/types";
import {
  checkCompliance,
  creepageClearance,
  deviceStressV,
  FUNCTIONAL_INSULATION_PD2,
  type ComplianceInput,
} from "./index";

// ---------------------------------------------------------------------------
// Inline fixtures (no data-module import per module rules)
// ---------------------------------------------------------------------------

function makeDevice(over: Partial<SwitchDevice> = {}): SwitchDevice {
  return {
    id: "TEST-GAN-650",
    mfr: "TestCo",
    tech: "GaN",
    vdsMaxV: 650,
    idMaxA: 30,
    rdsOnMohm25: 50,
    rdsOnTempco: 0.01,
    qgNc: 6,
    qossNc: 60,
    eossUj: 8,
    qrrNc: 0,
    vgsDriveV: 6,
    vthV: 1.7,
    rthJCcPerW: 0.9,
    pkg: "PQFN 8x8",
    priceUsd1k: 3.5,
    suppliers: ["Digi-Key"],
    ...over,
  };
}

function makeDeviceLoss(
  device: SwitchDevice,
  role = "primary-hs",
): DeviceLoss {
  return {
    role,
    device,
    positions: 2,
    parallelPerPosition: 1,
    conductionW: 3,
    switchingW: 1.5,
    cossW: 0.3,
    gateW: 0.1,
    deadTimeW: 0.1,
    totalW: 5,
    tjC: 95,
  };
}

const SYNC_BUCK: TopologyInfo = {
  id: "sync-buck",
  name: "Synchronous buck",
  isolated: false,
  bidirectional: true,
  softSwitching: "partial",
  minPowerW: 10,
  maxPowerW: 5000,
  switchCount: 2,
  magnetics: ["output-inductor"],
  description: "Half-bridge step-down.",
};

function makeSpec(over: Partial<DesignSpec> = {}): DesignSpec {
  return {
    conversion: "dc-dc",
    vinMinV: 320,
    vinNomV: 380,
    vinMaxV: 400,
    voutV: 48,
    poutW: 1000,
    bidirectional: false,
    isolated: false,
    ambientC: 40,
    cooling: "forced-air",
    rippleVoutPct: 1,
    ...over,
  };
}

function makeThermal(worstMarginC: number): ThermalReport {
  return {
    ambientC: 40,
    cooling: "forced-air",
    nodes: [
      {
        name: "primary-hs",
        dissipationW: 2.5,
        tjC: 125 - worstMarginC,
        limitC: 125,
        marginC: worstMarginC,
      },
    ],
    worstMarginC,
    ok: worstMarginC >= 0,
    notes: [],
  };
}

function makeResult(over: Partial<ComplianceInput> = {}): ComplianceInput {
  const spec = over.spec ?? makeSpec();
  const device = makeDevice();
  return {
    spec,
    topology: SYNC_BUCK,
    topologyRationale: ["test fixture"],
    fswHz: 300e3,
    devices: [makeDeviceLoss(device)],
    losses: {
      devices: [makeDeviceLoss(device)],
      magneticsCoreW: 2,
      magneticsCopperW: 2,
      capacitorW: 0.5,
      overheadW: 1,
      totalW: 10.5,
    },
    efficiencyPct: 96.5,
    efficiencyCurve: [],
    magnetics: [],
    thermal: makeThermal(25),
    schematic: { nets: [], components: [], svg: "", spiceNetlist: "" },
    bom: [],
    bomCostUsd: 42,
    layout: { stackup: [], placementSvg: "", rules: [], criticalLoops: [] },
    warnings: [],
    ...over,
  };
}

function bySeverity(report: ReturnType<typeof checkCompliance>, sev: string) {
  return report.findings.filter((f) => f.severity === sev);
}

// ---------------------------------------------------------------------------
// checkCompliance
// ---------------------------------------------------------------------------

describe("checkCompliance", () => {
  it("passes a healthy design with no fail findings", () => {
    const report = checkCompliance(makeResult());
    expect(report.passed).toBe(true);
    expect(bySeverity(report, "fail")).toHaveLength(0);
    // 400 V on a 650 V GaN = 61.5 % → clean pass on derating.
    const derating = report.findings.find(
      (f) => f.rule === "device-vds-derating",
    )!;
    expect(derating.severity).toBe("pass");
  });

  it("flags a Vds derating violation as fail", () => {
    // 600 V stress on a 650 V device = 92 % > 80 % limit.
    const spec = makeSpec({ vinMinV: 500, vinNomV: 550, vinMaxV: 600 });
    const report = checkCompliance(makeResult({ spec }));
    const derating = report.findings.find(
      (f) => f.rule === "device-vds-derating",
    )!;
    expect(derating.severity).toBe("fail");
    expect(report.passed).toBe(false);
  });

  it("warns when Vds stress is close to (but under) the 80 % limit", () => {
    // 500 V / 650 V = 76.9 % → warn band, not fail.
    const spec = makeSpec({ vinMinV: 400, vinNomV: 450, vinMaxV: 500 });
    const report = checkCompliance(makeResult({ spec }));
    const derating = report.findings.find(
      (f) => f.rule === "device-vds-derating",
    )!;
    expect(derating.severity).toBe("warn");
    expect(report.passed).toBe(true);
  });

  it("grades Tj margin: >=15 pass, 0..15 warn, <0 fail", () => {
    const pass = checkCompliance(makeResult({ thermal: makeThermal(25) }));
    const warn = checkCompliance(makeResult({ thermal: makeThermal(10) }));
    const fail = checkCompliance(makeResult({ thermal: makeThermal(-5) }));
    const tj = (r: ReturnType<typeof checkCompliance>) =>
      r.findings.find((f) => f.rule === "tj-margin")!.severity;
    expect(tj(pass)).toBe("pass");
    expect(tj(warn)).toBe("warn");
    expect(tj(fail)).toBe("fail");
    expect(fail.passed).toBe(false);
  });

  it("fails on isolation mismatch between spec and topology", () => {
    const report = checkCompliance(
      makeResult({ spec: makeSpec({ isolated: true }) }), // sync-buck is not
    );
    const iso = report.findings.find(
      (f) => f.rule === "isolation-consistency",
    )!;
    expect(iso.severity).toBe("fail");
    expect(report.passed).toBe(false);
  });

  it("fails when spec is bidirectional but topology is not", () => {
    const flyback: TopologyInfo = {
      ...SYNC_BUCK,
      id: "flyback",
      name: "Flyback",
      isolated: true,
      bidirectional: false,
    };
    const report = checkCompliance(
      makeResult({
        spec: makeSpec({ bidirectional: true, isolated: true, vinMaxV: 60 }),
        topology: flyback,
      }),
    );
    const bd = report.findings.find(
      (f) => f.rule === "bidirectional-consistency",
    )!;
    expect(bd.severity).toBe("fail");
  });

  it("grades efficiency against the target when one is set", () => {
    const sev = (eff: number, target: number) =>
      checkCompliance(
        makeResult({
          spec: makeSpec({ targetEfficiencyPct: target }),
          efficiencyPct: eff,
        }),
      ).findings.find((f) => f.rule === "efficiency-target")!.severity;
    expect(sev(96.5, 95)).toBe("pass");
    expect(sev(94.5, 95)).toBe("warn");
    expect(sev(92, 95)).toBe("fail");
  });

  it("warns when the ripple spec is missing, fails when simulation exceeds it", () => {
    const missing = checkCompliance(
      makeResult({ spec: makeSpec({ rippleVoutPct: undefined }) }),
    );
    expect(
      missing.findings.find((f) => f.rule === "output-ripple")!.severity,
    ).toBe("warn");

    const simBad = checkCompliance(
      makeResult({
        simulation: {
          topologyId: "sync-buck",
          traces: [],
          voutRippleVpp: 2.0, // allowed: 1 % of 48 V = 0.48 Vpp
          inductorRippleApp: 3,
          notes: [],
        },
      }),
    );
    expect(
      simBad.findings.find((f) => f.rule === "output-ripple")!.severity,
    ).toBe("fail");
    expect(simBad.passed).toBe(false);
  });

  it("reports the creepage/clearance requirement for the working voltage", () => {
    const report = checkCompliance(makeResult());
    const ins = report.findings.find((f) => f.rule === "creepage-clearance")!;
    expect(ins.severity).toBe("pass");
    expect(ins.detail).toContain("mm"); // states required distances
  });
});

// ---------------------------------------------------------------------------
// Insulation table
// ---------------------------------------------------------------------------

describe("creepageClearance", () => {
  it("800 V working voltage needs more creepage than 48 V", () => {
    const lo = creepageClearance(48);
    const hi = creepageClearance(800);
    expect(hi.creepageMm).toBeGreaterThan(lo.creepageMm);
    expect(hi.clearanceMm).toBeGreaterThan(lo.clearanceMm);
    // Sanity vs the IEC-style table values.
    expect(lo.creepageMm).toBeCloseTo(1.2, 5);
    expect(hi.creepageMm).toBeCloseTo(8.0, 5);
  });

  it("is monotonic non-decreasing across the whole table", () => {
    let prev = creepageClearance(1);
    for (const row of FUNCTIONAL_INSULATION_PD2) {
      const cur = creepageClearance(row.workingV);
      expect(cur.creepageMm).toBeGreaterThanOrEqual(prev.creepageMm);
      expect(cur.clearanceMm).toBeGreaterThanOrEqual(prev.clearanceMm);
      prev = cur;
    }
  });

  it("extrapolates (and flags) beyond the 1000 V table end", () => {
    const beyond = creepageClearance(1500);
    expect(beyond.extrapolated).toBe(true);
    expect(beyond.creepageMm).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Device stress model
// ---------------------------------------------------------------------------

describe("deviceStressV", () => {
  const spec = makeSpec({ vinMinV: 700, vinNomV: 760, vinMaxV: 800, voutV: 48 });

  it("buck-family stress equals vinMax; boost stress equals vout", () => {
    expect(deviceStressV("sync-buck", "hs", spec)).toBe(800);
    const boostSpec = makeSpec({
      vinMinV: 200,
      vinNomV: 300,
      vinMaxV: 320,
      voutV: 400,
    });
    expect(deviceStressV("boost", "boost-sw", boostSpec)).toBe(400);
  });

  it("LLC secondary SR sees 2·Vout, primary sees the bus", () => {
    expect(deviceStressV("llc-half-bridge", "primary-hs", spec)).toBe(800);
    expect(deviceStressV("llc-half-bridge", "sr", spec)).toBe(96);
  });

  it("flyback primary sees Vin plus reflected voltage (> vinMax)", () => {
    expect(deviceStressV("flyback", "primary", spec)).toBeGreaterThan(
      spec.vinMaxV,
    );
  });
});
