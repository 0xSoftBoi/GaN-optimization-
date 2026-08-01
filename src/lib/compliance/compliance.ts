/**
 * VoltForge compliance / design-rule checker.
 *
 * Rule set (severity pass/warn/fail; report.passed = no fail):
 *  - Switch Vds derating <= 80 % of rating at topology-appropriate stress
 *  - Junction temperature margin >= 15 °C
 *  - Creepage/clearance requirement vs working voltage, IEC 62368-1-style
 *    (functional insulation, pollution degree 2, material group IIIa)
 *  - Output ripple spec present (and met, when a simulation is attached)
 *  - spec.isolated / spec.bidirectional vs chosen topology consistency
 *  - Efficiency vs target, when a target is set
 */
import type {
  ComplianceFinding,
  ComplianceReport,
  DesignResult,
  DesignSpec,
  TopologyId,
} from "@/lib/types";
import { roundSig } from "@/lib/util";

/** Everything checkCompliance needs — a DesignResult minus its own outputs. */
export type ComplianceInput = Omit<DesignResult, "compliance" | "candidates">;

/** Maximum allowed Vds stress as a fraction of the device rating. */
export const VDS_DERATING_MAX = 0.8;
/** Warn when Vds stress is within 10 % of the derating limit. */
export const VDS_DERATING_WARN = 0.72;
/** Required junction-temperature margin, °C. */
export const TJ_MARGIN_MIN_C = 15;

// ---------------------------------------------------------------------------
// Creepage / clearance table
// ---------------------------------------------------------------------------

export interface InsulationRow {
  /** Working voltage (RMS or DC), V — row applies up to this value. */
  workingV: number;
  /** Minimum clearance (through air), mm. */
  clearanceMm: number;
  /** Minimum creepage (along surface), mm. */
  creepageMm: number;
}

/**
 * IEC 62368-1-style minimums for FUNCTIONAL insulation, pollution degree 2,
 * material group IIIa (CTI 175–400), altitude <= 2000 m.
 * Creepage follows the classic IEC 60664-1 PD2/MG III column
 * (~V/100 mm above 200 V); clearance from the impulse-withstand tables.
 */
export const FUNCTIONAL_INSULATION_PD2: InsulationRow[] = [
  { workingV: 50, clearanceMm: 0.2, creepageMm: 1.2 },
  { workingV: 100, clearanceMm: 0.2, creepageMm: 1.4 },
  { workingV: 150, clearanceMm: 0.5, creepageMm: 1.6 },
  { workingV: 200, clearanceMm: 1.0, creepageMm: 2.0 },
  { workingV: 250, clearanceMm: 1.5, creepageMm: 2.5 },
  { workingV: 320, clearanceMm: 2.0, creepageMm: 3.2 },
  { workingV: 400, clearanceMm: 2.5, creepageMm: 4.0 },
  { workingV: 500, clearanceMm: 3.0, creepageMm: 5.0 },
  { workingV: 630, clearanceMm: 3.5, creepageMm: 6.3 },
  { workingV: 800, clearanceMm: 4.5, creepageMm: 8.0 },
  { workingV: 1000, clearanceMm: 5.5, creepageMm: 10.0 },
];

/**
 * Look up minimum clearance/creepage for a working voltage. Uses the next
 * higher table row; beyond 1000 V extrapolates linearly from the last rows
 * (flagged via `extrapolated`).
 */
export function creepageClearance(workingV: number): {
  clearanceMm: number;
  creepageMm: number;
  extrapolated: boolean;
} {
  const t = FUNCTIONAL_INSULATION_PD2;
  for (const row of t) {
    if (workingV <= row.workingV) {
      return {
        clearanceMm: row.clearanceMm,
        creepageMm: row.creepageMm,
        extrapolated: false,
      };
    }
  }
  const a = t[t.length - 2];
  const b = t[t.length - 1];
  const s = (workingV - b.workingV) / (b.workingV - a.workingV);
  return {
    clearanceMm: roundSig(b.clearanceMm + s * (b.clearanceMm - a.clearanceMm), 3),
    creepageMm: roundSig(b.creepageMm + s * (b.creepageMm - a.creepageMm), 3),
    extrapolated: true,
  };
}

// ---------------------------------------------------------------------------
// Device stress model
// ---------------------------------------------------------------------------

/**
 * Worst-case steady-state Vds a switch position sees, per topology.
 * Secondary-side roles are detected from the role string (sr / sec / rect).
 */
export function deviceStressV(
  topologyId: TopologyId,
  role: string,
  spec: DesignSpec,
): number {
  const secondary = /\b(sr|sec|secondary|rect|output)\b|sr-/i.test(role);
  switch (topologyId) {
    case "buck":
    case "sync-buck":
    case "interleaved-sync-buck":
      return spec.vinMaxV;
    case "boost":
      return Math.max(spec.voutV, spec.vinMaxV);
    case "totem-pole-pfc": {
      const gridPkV = spec.gridVacRms ? spec.gridVacRms * Math.SQRT2 : 0;
      return Math.max(spec.voutV, spec.vinMaxV, gridPkV);
    }
    case "llc-half-bridge":
    case "llc-full-bridge":
    case "psfb":
      // Center-tapped SR sees 2·Vout; primary bridge is clamped to the bus.
      return secondary ? 2 * spec.voutV : spec.vinMaxV;
    case "dab":
      // Full bridges on both sides: each clamped to its own port voltage.
      return secondary ? spec.voutV : spec.vinMaxV;
    case "flyback": {
      // Design point: reflected voltage ~0.8·Vin,nom (sets turns ratio n).
      const vReflV = 0.8 * spec.vinNomV;
      const n = vReflV / Math.max(spec.voutV, 1e-9);
      return secondary ? spec.voutV + spec.vinMaxV / n : spec.vinMaxV + vReflV;
    }
    case "forward-active-clamp":
      // Clamp holds Vds ≈ Vin/(1−D); D ≈ 0.38 worst case → ~1.6·Vin,max.
      return secondary ? 2 * spec.voutV : 1.6 * spec.vinMaxV;
  }
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

export function checkCompliance(result: ComplianceInput): ComplianceReport {
  const findings: ComplianceFinding[] = [];
  const spec = result.spec;
  const topo = result.topology;

  // ---- 1. Vds derating per switch position -------------------------------
  for (const d of result.devices) {
    const stressV = deviceStressV(topo.id, d.role, spec);
    const ratedV = d.device.vdsMaxV;
    const ratio = stressV / ratedV;
    const pct = roundSig(100 * ratio, 3);
    const detail =
      `${d.role}: ${d.device.id} sees ${roundSig(stressV, 3)} V of ` +
      `${ratedV} V rating (${pct} %; limit ${100 * VDS_DERATING_MAX} %).`;
    findings.push({
      rule: "device-vds-derating",
      severity:
        ratio > VDS_DERATING_MAX
          ? "fail"
          : ratio > VDS_DERATING_WARN
            ? "warn"
            : "pass",
      detail,
    });
  }

  // ---- 2. Junction temperature margin ------------------------------------
  const marginC = result.thermal.worstMarginC;
  findings.push({
    rule: "tj-margin",
    severity: marginC < 0 ? "fail" : marginC < TJ_MARGIN_MIN_C ? "warn" : "pass",
    detail:
      `Worst junction margin ${roundSig(marginC, 3)} °C ` +
      `(required >= ${TJ_MARGIN_MIN_C} °C below Tj,max).`,
  });

  // ---- 3. Creepage / clearance requirement -------------------------------
  const gridPkV = spec.gridVacRms ? spec.gridVacRms * Math.SQRT2 : 0;
  const workingV = Math.max(spec.vinMaxV, spec.voutV, gridPkV);
  const ins = creepageClearance(workingV);
  findings.push({
    rule: "creepage-clearance",
    severity: ins.extrapolated ? "warn" : "pass",
    detail:
      `Working voltage ${roundSig(workingV, 3)} V → minimum clearance ` +
      `${ins.clearanceMm} mm, creepage ${ins.creepageMm} mm ` +
      `(IEC 62368-1-style, functional insulation, PD2, MG IIIa)` +
      (ins.extrapolated ? " — beyond table, linearly extrapolated." : "."),
  });

  // ---- 4. Output ripple spec ---------------------------------------------
  if (spec.rippleVoutPct === undefined) {
    findings.push({
      rule: "output-ripple",
      severity: "warn",
      detail: "No output ripple spec given; default 1 % Vpp assumed.",
    });
  } else {
    const allowedVpp = (spec.rippleVoutPct / 100) * spec.voutV;
    if (result.simulation) {
      const simVpp = result.simulation.voutRippleVpp;
      findings.push({
        rule: "output-ripple",
        severity: simVpp <= allowedVpp ? "pass" : "fail",
        detail:
          `Simulated ripple ${roundSig(simVpp, 3)} Vpp vs allowed ` +
          `${roundSig(allowedVpp, 3)} Vpp (${spec.rippleVoutPct} % of ` +
          `${spec.voutV} V).`,
      });
    } else {
      findings.push({
        rule: "output-ripple",
        severity: "pass",
        detail:
          `Ripple spec present: ${spec.rippleVoutPct} % ` +
          `(${roundSig(allowedVpp, 3)} Vpp); no simulation attached to verify.`,
      });
    }
  }

  // ---- 5. Isolation / bidirectional consistency --------------------------
  findings.push({
    rule: "isolation-consistency",
    severity: spec.isolated === topo.isolated ? "pass" : "fail",
    detail:
      `Spec requires ${spec.isolated ? "an isolated" : "a non-isolated"} ` +
      `converter; ${topo.name} is ${topo.isolated ? "isolated" : "non-isolated"}.`,
  });
  if (spec.bidirectional && !topo.bidirectional) {
    findings.push({
      rule: "bidirectional-consistency",
      severity: "fail",
      detail: `Spec requires bidirectional power flow; ${topo.name} is unidirectional.`,
    });
  } else {
    findings.push({
      rule: "bidirectional-consistency",
      severity: "pass",
      detail: spec.bidirectional
        ? `${topo.name} supports the required bidirectional power flow.`
        : "Unidirectional spec; no constraint.",
    });
  }

  // ---- 6. Efficiency vs target (when set) --------------------------------
  if (spec.targetEfficiencyPct !== undefined) {
    const eff = result.efficiencyPct;
    const target = spec.targetEfficiencyPct;
    findings.push({
      rule: "efficiency-target",
      severity: eff >= target ? "pass" : eff >= target - 1 ? "warn" : "fail",
      detail:
        `Full-load efficiency ${roundSig(eff, 4)} % vs target ${target} %.`,
    });
  }

  return {
    findings,
    passed: !findings.some((f) => f.severity === "fail"),
  };
}
