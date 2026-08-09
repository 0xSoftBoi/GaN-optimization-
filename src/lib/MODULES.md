# VoltForge module contracts

All modules are pure TypeScript under `src/lib/<module>/`, import shared types from
`@/lib/types` (alias `@` → `src/`), and helpers from `@/lib/util`. `types.ts` is a
FROZEN CONTRACT — never edit it; module-internal types live in the module.
Every module ships vitest tests next to its code (`src/lib/<module>/<name>.test.ts`)
and each module's `index.ts` re-exports its public API.

Required public exports (exact names/signatures; extra exports welcome):

## data (`src/lib/data/`)
- `SWITCH_DEVICES: SwitchDevice[]` (≥40 real parts: Navitas, EPC, Infineon CoolGaN,
  GaN Systems, TI LMG, Wolfspeed, onsemi, ROHM, ST; include a few Si superjunction)
- `GATE_DRIVERS: GateDriver[]`, `CONTROLLERS: ControllerPart[]`,
  `CAPACITORS: CapacitorPart[]`, `HEATSINKS: Heatsink[]`
- `findSwitches(f: {tech?: SwitchTech; minVdsV?: number; minIdA?: number; maxRdsOnMohm?: number}): SwitchDevice[]`
- `getSwitch(id: string): SwitchDevice | undefined`

## data (magnetics tables live with the magnetics module owner)
- `CORE_MATERIALS: CoreMaterial[]`, `CORES: CoreShape[]`, `WIRES: WireSpec[]`
  exported from `src/lib/data/magnetics.ts`

## loss (`src/lib/loss/`)
- `deviceLoss(device: SwitchDevice, op: SwitchOperatingPoint, parallel: number, tjC: number): DeviceLoss`
- `pickParallelCount(device: SwitchDevice, op: SwitchOperatingPoint): number`
- `coreLossW(material: CoreMaterial, veMm3: number, fHz: number, bPkT: number): number`
- `acResistanceFactor(fHz: number, wire: WireSpec, layers: number): number` (Dowell)
- `capacitorLossW(cap: CapacitorPart, iRmsA: number): number`

## topology (`src/lib/topology/`)
- `TOPOLOGIES: TopologyInfo[]` (all TopologyId entries)
- `scoreTopologies(spec: DesignSpec): TopologyScore[]` (sorted best-first)
- `operatingPoints(id: TopologyId, spec: DesignSpec, fswHz: number): TopologyOperatingPoints`

## magnetics (`src/lib/magnetics/`)
- `designMagnetic(req: MagneticRequirement, ambientC: number): MagneticDesign`
  (area-product core pick from CORES, turns, gap, wire from WIRES, iGSE core loss
  via loss module or internal, Dowell copper loss, temp rise, window check)

## thermal (`src/lib/thermal/`)
- `solveThermal(losses: LossBreakdown, spec: DesignSpec, heatsinks?: Heatsink[]): ThermalReport`
  (per-device Tj from Rth chain; heatsink selection from the injected catalog —
  callers pass HEATSINKS from data; module keeps a small internal fallback list)
- `iterateThermal(spec: DesignSpec, evalLossesAtTj: (tjC: number) => LossBreakdown, heatsinks?: Heatsink[]): { losses: LossBreakdown; thermal: ThermalReport }`

## control (`src/lib/control/`)
- `designCompensator(id: TopologyId, spec: DesignSpec, fswHz: number, lUh: number, cOutUf: number): CompensatorDesign`

## simulation (`src/lib/simulation/`)
- `simulate(id: TopologyId, spec: DesignSpec, fswHz: number, lUh: number, cOutUf: number): SimulationResult`
  (PWL state-space, ≥6 switching periods, steady state; supports at least
  sync-buck, boost, dab; graceful `notes` fallback for others)

## workload-power (`src/lib/workload-power/`)
- `parsePowerTrace(value: unknown): PowerTrace` — strict LCA-1 schema-v1 parser
- `summarizePowerTrace(trace: PowerTrace, series?: PowerSeries): PowerTraceSummary`
  — trapezoidal energy plus peak/P95/load-step/slew/state-duty evidence
- `converterSpecFromPowerTrace(trace, base, options?): TraceDrivenDesignInput`
  — derives a normal `DesignSpec` from peak workload power while retaining the
  transient summary; measured watts are required unless estimates are explicit

## firmware (`src/lib/firmware/`)
- `generateFirmware(target: FirmwarePackage["target"], id: TopologyId, spec: DesignSpec, fswHz: number, comp: CompensatorDesign): FirmwarePackage`

## schematic (`src/lib/schematic/`)
- `buildSchematic(id: TopologyId, spec: DesignSpec, parts: {switches: DeviceLoss[]; magnetics: MagneticDesign[]; driver: GateDriver; controller: ControllerPart; caps: {part: CapacitorPart; qty: number}[]}): Schematic`
  (netlist + readable SVG one-line diagram + SPICE .cir netlist)

## bom (`src/lib/bom/`)
- `buildBom(sch: Schematic, extras?: BomLine[]): { lines: BomLine[]; totalUsd: number }`

## layout (`src/lib/layout/`)
- `layoutGuidance(id: TopologyId, spec: DesignSpec, fswHz: number): LayoutGuidance`

## compliance (`src/lib/compliance/`)
- `checkCompliance(result: Omit<DesignResult, "compliance" | "candidates">): ComplianceReport`
  (device voltage derating ≤80 %, Tj margin ≥15 °C, creepage/clearance vs
  IEC 62368-1 table for working voltage, ripple spec met, bidirectional/isolation
  consistency)

## copilot (`src/lib/copilot/`)
- `parsePrompt(prompt: string): CopilotParse` (deterministic regex/heuristic NLP:
  power "5kW", voltages "800V to 48V" / "48V output", "bidirectional",
  "isolated", frequency, ambient, cooling; sensible defaults + assumptions list)

## optimizer (`src/lib/optimizer/`)
- `designConverter(spec: DesignSpec): DesignResult` — THE composition root:
  score topologies → for top candidates sweep devices × fsw (logSpace 100k–1M or
  around spec.fswHz) → per candidate: operating points, parallel count, losses,
  magnetics, thermal iterate, cost → feasibility + Pareto set → pick winner →
  compose full DesignResult (schematic, bom, layout, compliance, compensator,
  simulation, firmware, efficiency curve at 10–100 % load).
- `optimize(spec: DesignSpec): { candidates: DesignCandidateSummary[]; best: DesignResult }`
