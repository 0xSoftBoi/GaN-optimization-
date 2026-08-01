/**
 * VoltForge — shared domain types. FROZEN CONTRACT.
 *
 * Every engine module imports from this file and MUST NOT modify it.
 * Module-internal types live inside the module; anything that crosses a
 * module boundary lives here.
 *
 * UNIT CONVENTIONS (SI unless the name says otherwise):
 *  - voltage V, current A, power W, frequency Hz, resistance Ω,
 *    capacitance F, inductance H, energy J, temperature °C
 *  - name suffixes override: `rdsOnMohm25` = mΩ, `qgNc` = nC, `aeMm2` = mm²,
 *    `priceUsd1k` = USD at 1k volume
 *  - Steinmetz: Pv [kW/m³] = k · f[Hz]^alpha · B[T]^beta
 */

// ---------------------------------------------------------------------------
// Design specification
// ---------------------------------------------------------------------------

export type Cooling = "natural" | "forced-air" | "liquid" | "cold-plate";

export interface DesignSpec {
  name?: string;
  conversion: "dc-dc" | "ac-dc";
  /** DC input range (for ac-dc this is the rectified bus the PFC feeds). */
  vinMinV: number;
  vinNomV: number;
  vinMaxV: number;
  voutV: number;
  poutW: number;
  bidirectional: boolean;
  isolated: boolean;
  /** Optional user-forced switching frequency; optimizer sweeps when absent. */
  fswHz?: number;
  ambientC: number;
  /** Default 125 °C if absent. */
  maxJunctionC?: number;
  cooling: Cooling;
  /** Peak-peak output ripple as % of vout. Default 1. */
  rippleVoutPct?: number;
  targetEfficiencyPct?: number;
  costCeilingUsd?: number;
  heightLimitMm?: number;
  /** ac-dc only: grid RMS voltage (e.g. 230). */
  gridVacRms?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export type SwitchTech = "GaN" | "SiC" | "Si";

export interface SwitchDevice {
  /** Manufacturer part number, e.g. "NV6128". */
  id: string;
  mfr: string;
  tech: SwitchTech;
  vdsMaxV: number;
  /** Continuous drain current at 25 °C case. */
  idMaxA: number;
  /** Typical Rds(on) in mΩ at 25 °C, rated Vgs. */
  rdsOnMohm25: number;
  /**
   * Normalized Rds(on) temperature coefficient per °C above 25:
   * R(T) = R25 · (1 + k·(T − 25)). GaN ≈ 0.009–0.012, SiC ≈ 0.004–0.007.
   */
  rdsOnTempco: number;
  qgNc: number;
  /** Output charge at half rated Vds. */
  qossNc: number;
  /** Stored Coss energy at half rated Vds, µJ. */
  eossUj: number;
  /** Reverse-recovery charge, nC. 0 for GaN. */
  qrrNc: number;
  vgsDriveV: number;
  vthV: number;
  rthJCcPerW: number;
  pkg: string;
  priceUsd1k: number;
  suppliers: string[];
  /** Half-bridge integration, integrated driver, etc. */
  notes?: string;
}

export interface GateDriver {
  id: string;
  mfr: string;
  channels: 1 | 2;
  isolated: boolean;
  peakSourceA: number;
  peakSinkA: number;
  /** Common-mode transient immunity, V/ns. */
  cmtiVPerNs: number;
  propDelayNs: number;
  priceUsd1k: number;
  suppliers: string[];
  notes?: string;
}

export interface ControllerPart {
  id: string;
  mfr: string;
  family: "STM32G4" | "C2000" | "analog-pwm" | "digital-pwm";
  coreMhz: number;
  pwmResolutionPs: number;
  adcBits: number;
  priceUsd1k: number;
  suppliers: string[];
  notes?: string;
}

export type CapDielectric = "C0G" | "X7R" | "film" | "electrolytic" | "polymer";

export interface CapacitorPart {
  id: string;
  mfr: string;
  dielectric: CapDielectric;
  capUf: number;
  voltageV: number;
  esrMohm: number;
  /** RMS ripple-current rating. */
  iRmsA: number;
  priceUsd1k: number;
  suppliers: string[];
}

export interface Heatsink {
  id: string;
  mfr: string;
  /** Sink-to-ambient thermal resistance at natural convection. */
  rthSaCPerWNatural: number;
  /** Sink-to-ambient with 400 LFM forced air (if rated). */
  rthSaCPerWForced?: number;
  heightMm: number;
  footprintMm: [number, number];
  priceUsd: number;
}

// ---------------------------------------------------------------------------
// Magnetics
// ---------------------------------------------------------------------------

export interface CoreMaterial {
  /** e.g. "3C97", "N97", "ML91S". */
  id: string;
  mfr: string;
  /** Steinmetz Pv[kW/m³] = k · f[Hz]^alpha · B[T]^beta (100–500 kHz fit). */
  steinmetzK: number;
  steinmetzAlpha: number;
  steinmetzBeta: number;
  bsatT: number;
  /** Relative permeability. */
  muR: number;
  maxTempC: number;
}

export interface CoreShape {
  /** e.g. "PQ32/20", "E42/21/15". */
  id: string;
  mfr: string;
  materialId: string;
  aeMm2: number;
  /** Winding window area. */
  awMm2: number;
  veMm3: number;
  /** Magnetic path length. */
  leMm: number;
  /** Mean length per turn. */
  mltMm: number;
  priceUsd: number;
}

export interface WireSpec {
  /** e.g. "AWG16", "litz-420x38". */
  id: string;
  type: "solid" | "litz" | "foil";
  copperAreaMm2: number;
  strandCount?: number;
  strandDiaMm?: number;
  /** DC resistance per meter at 20 °C, mΩ/m. */
  rdcMohmPerM: number;
}

export type MagneticRole =
  | "output-inductor"
  | "resonant-inductor"
  | "transformer"
  | "pfc-inductor"
  | "coupled-inductor";

export interface MagneticDesign {
  role: MagneticRole;
  core: CoreShape;
  material: CoreMaterial;
  /** Primary turns (or the single winding's turns for inductors). */
  turnsPrimary: number;
  turnsSecondary?: number;
  airGapMm: number;
  wirePrimary: WireSpec;
  wireSecondary?: WireSpec;
  /** Target/achieved inductance (magnetizing for transformers). */
  inductanceUh: number;
  bPeakT: number;
  coreLossW: number;
  copperLossW: number;
  /** Estimated hot-spot temperature rise above ambient. */
  tempRiseC: number;
  windowUtilization: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export type TopologyId =
  | "buck"
  | "sync-buck"
  | "interleaved-sync-buck"
  | "boost"
  | "llc-half-bridge"
  | "llc-full-bridge"
  | "psfb"
  | "dab"
  | "totem-pole-pfc"
  | "flyback"
  | "forward-active-clamp";

export interface TopologyInfo {
  id: TopologyId;
  name: string;
  isolated: boolean;
  bidirectional: boolean;
  softSwitching: "none" | "partial" | "full";
  /** Practical power window in W. */
  minPowerW: number;
  maxPowerW: number;
  switchCount: number;
  magnetics: MagneticRole[];
  description: string;
}

export interface TopologyScore {
  topology: TopologyInfo;
  /** 0–100; higher = better fit for the spec. */
  score: number;
  rationale: string[];
  /** Hard disqualification (score forced to 0). */
  disqualified?: string;
}

/**
 * Electrical operating point of one switch position — the interface between
 * the topology engine (which computes it) and the loss engine (which prices it).
 */
export interface SwitchOperatingPoint {
  role: string; // e.g. "primary-hs", "sr", "pfc-fast-leg"
  /** Number of identical positions with this stress (e.g. 4 in a full bridge). */
  positions: number;
  vOffV: number;
  iRmsA: number;
  iAvgA: number;
  /** Current at turn-on / turn-off for switching-loss estimation. */
  iOnA: number;
  iOffA: number;
  fswHz: number;
  dutyEff: number;
  /** True when topology gives ZVS at this position (kills turn-on + Coss loss). */
  zvs: boolean;
  /** Fraction of period spent conducting in reverse (dead-time) — GaN Vsd cost. */
  deadTimeFrac: number;
}

export interface TopologyOperatingPoints {
  topologyId: TopologyId;
  switchPoints: SwitchOperatingPoint[];
  magnetics: MagneticRequirement[];
  /** Output capacitor RMS current — sizes the cap bank. */
  capRmsA: number;
  notes: string[];
}

export interface MagneticRequirement {
  role: MagneticRole;
  inductanceUh: number;
  iPeakA: number;
  iRmsA: number;
  /** Volt-seconds applied (for transformer core sizing), V·µs. */
  voltSecondsVus: number;
  turnsRatio?: number;
  acFluxFraction: number;
  fswHz: number;
}

// ---------------------------------------------------------------------------
// Losses
// ---------------------------------------------------------------------------

export interface DeviceLoss {
  role: string;
  device: SwitchDevice;
  positions: number;
  parallelPerPosition: number;
  conductionW: number;
  switchingW: number;
  cossW: number;
  gateW: number;
  deadTimeW: number;
  /** Total across all positions and parallel devices. */
  totalW: number;
  /** Junction temperature this loss set was evaluated at. */
  tjC: number;
}

export interface LossBreakdown {
  devices: DeviceLoss[];
  magneticsCoreW: number;
  magneticsCopperW: number;
  capacitorW: number;
  /** Housekeeping: control, fans, aux supplies. */
  overheadW: number;
  totalW: number;
}

// ---------------------------------------------------------------------------
// Thermal
// ---------------------------------------------------------------------------

export interface ThermalNode {
  name: string;
  dissipationW: number;
  tjC: number;
  limitC: number;
  marginC: number;
}

export interface ThermalReport {
  ambientC: number;
  cooling: Cooling;
  heatsink?: Heatsink;
  nodes: ThermalNode[];
  worstMarginC: number;
  ok: boolean;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Control & firmware
// ---------------------------------------------------------------------------

export interface CompensatorDesign {
  kind: "type-2" | "type-3" | "pi";
  crossoverHz: number;
  phaseMarginDeg: number;
  /** Analog prototype: gains/poles/zeros in Hz. */
  kp: number;
  ki: number;
  kd?: number;
  polesHz: number[];
  zerosHz: number[];
  /** Digital biquad coefficients at fsw sample rate (bilinear transform). */
  b: number[];
  a: number[];
  sampleHz: number;
  notes: string[];
}

export interface FirmwareFile {
  path: string;
  contents: string;
}

export interface FirmwarePackage {
  target: "STM32G474" | "TMS320F280049";
  files: FirmwareFile[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Schematic / BOM / layout / compliance
// ---------------------------------------------------------------------------

export interface NetlistComponent {
  ref: string; // "Q1", "L1", "C3"
  kind:
    | "switch"
    | "diode"
    | "inductor"
    | "transformer"
    | "capacitor"
    | "resistor"
    | "driver"
    | "controller"
    | "connector";
  value: string;
  partId?: string;
  pins: Record<string, string>; // pin name -> net name
}

export interface Schematic {
  nets: string[];
  components: NetlistComponent[];
  svg: string;
  spiceNetlist: string;
}

export interface BomLine {
  ref: string[];
  partId: string;
  mfr: string;
  description: string;
  qty: number;
  unitPriceUsd: number;
  extPriceUsd: number;
  suppliers: string[];
  alternates?: string[];
}

export interface ComplianceFinding {
  rule: string;
  severity: "pass" | "warn" | "fail";
  detail: string;
}

export interface ComplianceReport {
  findings: ComplianceFinding[];
  passed: boolean;
}

export interface LayoutGuidance {
  stackup: string[];
  placementSvg: string;
  rules: string[];
  criticalLoops: { name: string; maxAreaMm2: number; note: string }[];
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export interface WaveformTrace {
  name: string;
  unit: string;
  t: number[]; // seconds
  v: number[];
}

export interface SimulationResult {
  topologyId: TopologyId;
  traces: WaveformTrace[];
  voutRippleVpp: number;
  inductorRippleApp: number;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Design result (what the platform sells)
// ---------------------------------------------------------------------------

export interface EfficiencyPoint {
  loadPct: number;
  efficiencyPct: number;
  lossW: number;
}

export interface DesignCandidateSummary {
  topologyId: TopologyId;
  deviceId: string;
  fswHz: number;
  efficiencyPct: number;
  bomCostUsd: number;
  powerDensityWPerL: number;
  feasible: boolean;
  /** True when on the efficiency/cost/density Pareto front. */
  pareto: boolean;
}

export interface DesignResult {
  spec: DesignSpec;
  topology: TopologyInfo;
  topologyRationale: string[];
  fswHz: number;
  devices: DeviceLoss[];
  losses: LossBreakdown;
  efficiencyPct: number;
  efficiencyCurve: EfficiencyPoint[];
  magnetics: MagneticDesign[];
  thermal: ThermalReport;
  compensator?: CompensatorDesign;
  simulation?: SimulationResult;
  schematic: Schematic;
  bom: BomLine[];
  bomCostUsd: number;
  compliance: ComplianceReport;
  layout: LayoutGuidance;
  firmware?: FirmwarePackage;
  /** Explored candidate space, for the Pareto explorer. */
  candidates: DesignCandidateSummary[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Copilot
// ---------------------------------------------------------------------------

export interface CopilotParse {
  spec: DesignSpec;
  assumptions: string[];
  confidence: number; // 0–1
  unrecognized: string[];
}
