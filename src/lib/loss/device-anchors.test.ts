/**
 * it2 anchor-part goldens and cross-DB physics invariants (U4, U9 partial).
 *
 * Unlike device.test.ts (inline fixtures only), this suite deliberately
 * couples the loss engine to the real data modules — the same pairing the
 * optimizer uses — and checks the §D1–§D9 hand computations against the
 * datasheet-grade DevicePhysics records for the three anchor parts.
 */
import { describe, expect, it } from "vitest";
import type { SwitchDevice, SwitchOperatingPoint } from "@/lib/types";
import { SWITCH_DEVICES, getSwitch } from "@/lib/data/devices";
import {
  getDevicePhysics,
  qossCoulombs,
  eossJoules,
} from "@/lib/data/devicePhysics";
import {
  deviceLoss,
  rdsOnAtTj,
  dynamicRonFactor,
  gateTimings,
  eCapHardJ,
  qNodeCoulombs,
  vsdV,
} from "./device";

const epc2218 = getSwitch("EPC2218")!;
const lmg3522 = getSwitch("LMG3522R030")!;
const c3m = getSwitch("C3M0075120K")!;

// ---------------------------------------------------------------------------
// Linear-capacitor identity (§D5 sanity gate, U4)
// ---------------------------------------------------------------------------

describe("linear-capacitor identity", () => {
  // ρ = Vref·Qoss/Eoss = 50·100 nC/2.5 µJ = 2 exactly → the family fit takes
  // the linear-C branch with C = 2·Eoss/Vref² = 2 nF.
  const linC: SwitchDevice = {
    id: "TEST-LINEAR-C",
    mfr: "TestCo",
    tech: "GaN",
    vdsMaxV: 100,
    idMaxA: 30,
    rdsOnMohm25: 5,
    rdsOnTempco: 0.01,
    qgNc: 5,
    qossNc: 100, // Qoss(50 V) = C·V with C = 2 nF
    eossUj: 2.5, // Eoss(50 V) = ½·C·V²
    qrrNc: 0,
    vgsDriveV: 5,
    vthV: 1.4,
    rthJCcPerW: 1,
    pkg: "BGA",
    priceUsd1k: 1,
    suppliers: ["dk"],
  };
  const C = 2e-9;
  const p = getDevicePhysics(linC);

  it("V·Qoss − Eoss equals Eoss exactly for a constant-C device (§D5)", () => {
    for (const v of [10, 25, 40, 50, 80]) {
      const q = qossCoulombs(p, v);
      const e = eossJoules(p, v);
      expect(q).toBeCloseTo(C * v, 15);
      expect(e).toBeCloseTo(0.5 * C * v * v, 15);
      // co-energy identity: V·Q − E = E ⇔ hard-switch cost = 2·(½CV²)
      expect(v * q - e).toBeCloseTo(e, 15);
    }
  });

  it("hard-switch pair cost E_cap = C·V² and Q_node = 2·C·V exactly (U4)", () => {
    for (const v of [20, 40, 60]) {
      expect(eCapHardJ(linC, v, 1)).toBeCloseTo(C * v * v, 15);
      expect(qNodeCoulombs(linC, v, 1)).toBeCloseTo(2 * C * v, 15);
    }
    // E_cap is exactly 2× the v1 "n·Eoss" bookkeeping in the linear limit.
    expect(eCapHardJ(linC, 50, 1)).toBeCloseTo(2 * eossJoules(p, 50), 15);
  });
});

// ---------------------------------------------------------------------------
// Whole-DB physics invariants (U4 acceptance)
// ---------------------------------------------------------------------------

describe("DevicePhysics invariants across the switch DB", () => {
  it("Qoss/Eoss are positive, monotone, and satisfy V·Qoss ≥ 2·Eoss for every part", () => {
    for (const d of SWITCH_DEVICES) {
      const p = getDevicePhysics(d);
      let qPrev = 0;
      let ePrev = 0;
      for (const frac of [0.2, 0.4, 0.5, 0.8, 1.0]) {
        const v = frac * d.vdsMaxV;
        const q = qossCoulombs(p, v);
        const e = eossJoules(p, v);
        expect(q).toBeGreaterThan(qPrev);
        expect(e).toBeGreaterThan(ePrev);
        // §D5: co-energy ≥ energy (equality only for the linear-C fallback
        // used on DB entries whose frozen Qoss/Eoss pair has ρ ≤ 2).
        expect(v * q).toBeGreaterThanOrEqual(2 * e * (1 - 1e-9));
        // Co(tr) = Q/V ≥ Co(er) = 2E/V² — same statement, datasheet form.
        expect(q / v).toBeGreaterThanOrEqual(((2 * e) / (v * v)) * (1 - 1e-9));
        qPrev = q;
        ePrev = e;
      }
    }
  });

  it("r(Tj) anchors and k_dyn defaults are sane for every part", () => {
    for (const d of SWITCH_DEVICES) {
      const p = getDevicePhysics(d);
      expect(p.rNorm100).toBeGreaterThan(1);
      expect(p.rNorm150).toBeGreaterThan(p.rNorm100);
      expect(p.kDynHard).toBeGreaterThanOrEqual(p.kDynSoft);
      expect(p.kDynSoft).toBeGreaterThanOrEqual(1);
      if (d.tech !== "GaN") {
        // §D2: dynamic Rds(on) is a GaN-only mechanism.
        expect(p.kDynHard).toBe(1);
        expect(dynamicRonFactor(d, 0)).toBe(1);
      }
      // §D1 monotonicity of the r(Tj) power law.
      expect(rdsOnAtTj(d, 150)).toBeGreaterThan(rdsOnAtTj(d, 100));
      expect(rdsOnAtTj(d, 100)).toBeGreaterThan(rdsOnAtTj(d, 25));
    }
  });
});

// ---------------------------------------------------------------------------
// EPC2218 goldens (§D1, §D3, §D5)
// ---------------------------------------------------------------------------

describe("anchor: EPC2218", () => {
  const p = getDevicePhysics(epc2218);

  it("reproduces datasheet Qoss/Eoss at 50 V within 5 %", () => {
    // Hand computation (§D5 power law, record γ = 0.2787, C0 = 4.5064 nF):
    //   Qoss(50) = C0/(1−γ)·50^(1−γ) = 4.5064e-9/0.7213·16.806 = 105.0 nC
    //   Eoss(50) = C0/(2−γ)·50^(2−γ) = 4.5064e-9/1.7213·840.5  = 2.200 µJ
    // (datasheet: 105 nC / 2.2 µJ at VDS = 50 V)
    expect(qossCoulombs(p, 50) / 105e-9).toBeCloseTo(1, 2);
    expect(eossJoules(p, 50) / 2.2e-6).toBeCloseTo(1, 2);
  });

  it("r(150 °C) hits the datasheet point within 2 % (§D1 acceptance)", () => {
    // Hand: R25·rNorm150 = 2.4 mΩ·2.05 = 4.92 mΩ
    expect(rdsOnAtTj(epc2218, 150) / (2.4e-3 * 2.05)).toBeCloseTo(1, 2);
    expect(rdsOnAtTj(epc2218, 100) / (2.4e-3 * 1.5)).toBeCloseTo(1, 2);
  });

  it("gate-charge-partition times match the §D3 hand computation", () => {
    // Hand (record: Qgs2 = 1.6 nC, Qgd = 2.3 nC, Rg,int = 0.4 Ω, ext on 2.0 Ω,
    // ext off 0.7 Ω, gfs = 57 S, Vth = 1.4 V, Vdrv = 5 V, Vlo = 0), IL = 20 A:
    //   Vpl  = 1.4 + 20/57                       = 1.7509 V
    //   t_cr = 1.6n·2.4/(5 − (1.4+1.7509)/2)     = 1.121 ns
    //   t_vf = 2.3n·2.4/(5 − 1.7509)             = 1.699 ns
    //   t_vr = 2.3n·1.1/(1.7509 − 0)             = 1.445 ns
    //   t_cf = 1.6n·1.1/((1.4+1.7509)/2 − 0)     = 1.117 ns
    const t = gateTimings(epc2218, 20, 48);
    const vPl = 1.4 + 20 / 57;
    expect(t.vPlV).toBeCloseTo(vPl, 6);
    expect(t.tCrS).toBeCloseTo((1.6e-9 * 2.4) / (5 - (1.4 + vPl) / 2), 12);
    expect(t.tVfS).toBeCloseTo((2.3e-9 * 2.4) / (5 - vPl), 12);
    expect(t.tVrS).toBeCloseTo((2.3e-9 * 1.1) / vPl, 12);
    expect(t.tCfS).toBeCloseTo((1.6e-9 * 1.1) / ((1.4 + vPl) / 2), 12);
    // v2 sanity: nanosecond-scale edges, not the v1 0.5·Qg/1.5 A ≈ 5.2 ns blur
    for (const x of [t.tCrS, t.tVfS, t.tVrS, t.tCfS]) {
      expect(x).toBeGreaterThan(0.2e-9);
      expect(x).toBeLessThan(5e-9);
    }
  });

  it("hard-switched 48 V half-bridge Coss loss = fsw·V·Qoss(V) within 5 % (§D5)", () => {
    // Hand: Qoss(48) = 105 nC·(48/50)^0.7213 = 101.96 nC
    //       E_cap    = 48·101.96 nC = 4.894 µJ → ×500 kHz = 2.447 W
    const op: SwitchOperatingPoint = {
      role: "buck-hs",
      positions: 1,
      vOffV: 48,
      iRmsA: 20,
      iAvgA: 15,
      iOnA: 25,
      iOffA: 35,
      fswHz: 500e3,
      dutyEff: 0.25,
      zvs: false,
      deadTimeFrac: 0,
    };
    const d = deviceLoss(epc2218, op, 1, 100);
    const hand = 500e3 * 48 * 105e-9 * Math.pow(48 / 50, 1 - 0.2787);
    expect(d.cossW / hand).toBeCloseTo(1, 2);
  });
});

// ---------------------------------------------------------------------------
// LMG3522R030 goldens (integrated driver, slew-programmed edges)
// ---------------------------------------------------------------------------

describe("anchor: LMG3522R030", () => {
  const p = getDevicePhysics(lmg3522);

  it("reproduces the 325 V contract Qoss/Eoss within 5 %", () => {
    // Hand: fit calibrated on Qoss(325) = 70 nC, Eoss(325) = 10 µJ.
    expect(qossCoulombs(p, 325) / 70e-9).toBeCloseTo(1, 2);
    expect(eossJoules(p, 325) / 10e-6).toBeCloseTo(1, 2);
    // E_cap(325) = 325·70 nC = 22.75 µJ (§D5 matched pair)
    expect(eCapHardJ(lmg3522, 325, 1) / 22.75e-6).toBeCloseTo(1, 2);
  });

  it("r(Tj) anchors: 30 mΩ → 43.5 mΩ @100 °C, 58.5 mΩ @150 °C within 2 %", () => {
    expect(rdsOnAtTj(lmg3522, 100) / (30e-3 * 1.45)).toBeCloseTo(1, 2);
    expect(rdsOnAtTj(lmg3522, 150) / (30e-3 * 1.95)).toBeCloseTo(1, 2);
  });

  it("uses the programmed slew for voltage edges: t_vf = V/(50 V/ns)", () => {
    const t = gateTimings(lmg3522, 10, 400);
    expect(t.tVfS).toBeCloseTo(8e-9, 12); // 400 V / 50 V/ns
    expect(t.tVrS).toBeCloseTo(8e-9, 12);
    // current phases from Q/Ig: 0.8 nC / 2 A = 0.4 ns
    expect(t.tCrS).toBeCloseTo(0.4e-9, 12);
    expect(t.tCfS).toBeCloseTo(0.4e-9, 12);
  });
});

// ---------------------------------------------------------------------------
// C3M0075120K goldens (SiC, tabulated Coss integrals)
// ---------------------------------------------------------------------------

describe("anchor: C3M0075120K", () => {
  const p = getDevicePhysics(c3m);

  it("table reproduces Eoss(600 V) = 15 µJ and Qoss(600 V) = 76.5 nC", () => {
    // Grid points of the table integrated from
    // Coss(v) = 44.4 pF + 1056 pF/(1 + v/12 V) — see devicePhysics.ts.
    expect(eossJoules(p, 600) / 15e-6).toBeCloseTo(1, 3);
    expect(qossCoulombs(p, 600) / 76.462e-9).toBeCloseTo(1, 3);
    // §D5 hard-switch pair cost: 600·76.462 nC = 45.88 µJ — and the co-energy
    // exceeds twice the stored energy (ρ = 3.06 > 2).
    expect(eCapHardJ(c3m, 600, 1) / 45.877e-6).toBeCloseTo(1, 3);
    expect(600 * qossCoulombs(p, 600)).toBeGreaterThan(2 * eossJoules(p, 600));
  });

  it("r(Tj): 75 mΩ → 84.75 mΩ @100 °C, 100.5 mΩ @150 °C within 2 % (§D1 SiC band)", () => {
    expect(rdsOnAtTj(c3m, 100) / (75e-3 * 1.13)).toBeCloseTo(1, 2);
    expect(rdsOnAtTj(c3m, 150) / (75e-3 * 1.34)).toBeCloseTo(1, 2);
    // SiC r(150) ≈ 1.34 sits inside the §D1 SiC band 1.25–1.5.
    expect(rdsOnAtTj(c3m, 150) / rdsOnAtTj(c3m, 25)).toBeGreaterThan(1.25);
    expect(rdsOnAtTj(c3m, 150) / rdsOnAtTj(c3m, 25)).toBeLessThan(1.5);
  });

  it("body-diode Vsd = 4.4 V at 25 °C falling 2 mV/°C; no k_dyn (§D8, §D2)", () => {
    expect(vsdV(c3m, 10, 25)).toBeCloseTo(4.4, 9);
    expect(vsdV(c3m, 10, 125)).toBeCloseTo(4.4 - 0.002 * 100, 9);
    expect(dynamicRonFactor(c3m, 0)).toBe(1);
    expect(dynamicRonFactor(c3m, 1)).toBe(1);
  });

  it("§D3 timings with the real Rg,int = 10.5 Ω land in the datasheet range", () => {
    // Hand (Qgs2 = 7 nC, Qgd = 21 nC, RgOn = 15.5 Ω, RgOff = 13 Ω, gfs = 5 S,
    // Vth = 2.5, Vdrv = 15, Vlo = −4), IL = 20 A → Vpl = 6.5 V:
    //   t_cr = 7n·15.5/(15 − 4.5)  = 10.33 ns   t_vf = 21n·15.5/8.5 = 38.3 ns
    //   t_vr = 21n·13/10.5         = 26.0 ns    t_cf = 7n·13/8.5    = 10.7 ns
    const t = gateTimings(c3m, 20, 800);
    expect(t.vPlV).toBeCloseTo(6.5, 6);
    expect(t.tCrS).toBeCloseTo((7e-9 * 15.5) / 10.5, 11);
    expect(t.tVfS).toBeCloseTo((21e-9 * 15.5) / 8.5, 11);
    expect(t.tVrS).toBeCloseTo((21e-9 * 13) / 10.5, 11);
    expect(t.tCfS).toBeCloseTo((7e-9 * 13) / 8.5, 11);
  });

  it("GaN's k_dyn raises hard-switched conduction; EPC2218 sits in the JEP173 LV class", () => {
    expect(dynamicRonFactor(epc2218, 0)).toBeCloseTo(1.05, 9);
    expect(dynamicRonFactor(epc2218, 1)).toBeCloseTo(1.02, 9);
    expect(dynamicRonFactor(epc2218, 0.5)).toBeCloseTo(1.035, 9);
  });
});
