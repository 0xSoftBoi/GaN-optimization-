# GOAL — VoltForge: the AI Power Delivery Platform

> "CUDA for power electronics" + "the Bloomberg Terminal for power electronics."
> Spec in → complete, sellable converter design out.

**Strategy is governed by [MASTERPLAN.md](./MASTERPLAN.md)** (researched & sourced,
2026-08-01). Where this checklist and the master plan conflict, the master plan
wins. Key corrections adopted: the real incumbent is free vendor reference
designs + FAE support, so we sell NRE substitution and trust, not seats vs a $0
anchor; pricing is $500–1,000/mo floating seats + $10–25k per-design runs +
vendor sponsorship (never $5k/mo seats); near-term volume is 54V ORv3-class
PSUs (5.5–18.3 kW LLC + totem-pole PFC) and ±400 V with 800 V demo-ready for the
2027–28 wave; the trust loop (ngspice CI round-trip, LTspice/PLECS/KiCad export,
calibration vs published measured designs within ±0.5 %) is a v1 feature; fab
analytics is parked (see MASTERPLAN §7).

## Mission

AI datacenters are power-constrained. Every GPU rack needs multiple AC/DC and DC/DC
stages, and GaN/SiC devices (Navitas, EPC, Infineon, TI, Wolfspeed) are how the
industry escapes silicon's efficiency ceiling. The opportunity is not another
transistor — it is the software layer that automatically optimizes power conversion
around wide-bandgap devices.

VoltForge takes a requirement — input voltage, output voltage, power, thermal
constraints, or a plain-English prompt like "design a 5 kW bidirectional converter" —
and generates: optimal topology, optimized switch selection, magnetic design,
loss/efficiency analysis, thermal simulation, schematic + SPICE netlist, PCB layout
guidance, controller firmware, BOM with pricing/suppliers, and compliance checks.

Target customers (ranked — MASTERPLAN §6.1): second-tier PSU makers chasing the
800 V wave (Megmeet, Chicony, AcBel), module makers & design houses (Vicor, Flex
Power Modules, Murata), hyperscaler power teams as spec-setting design partners,
challenger silicon vendors as sponsors. Revenue stacks three layers: floating
seats ($500–1,000/mo), per-design runs ($10–25k vs $50–200k NRE), and
Transim-style vendor sponsorship.

## Product pillars

1. **Design Engine** ("CUDA for power electronics") — deterministic, physics-based
   generation and optimization of complete converter designs.
2. **AI Copilot** — natural-language front end: prompt → spec → full design.
3. **Component Terminal** ("Bloomberg for power electronics") — every GaN/SiC
   transistor, magnetics, drivers, controllers: parameters, thermal models,
   pricing, suppliers — searchable and comparable.
4. **Trust Loop** — every generated design self-validates: ngspice round-trip in
   CI, LTspice/SIMPLIS/PLECS + KiCad export so engineers verify in tools they
   already trust, and a public calibration set vs measured vendor reference
   designs (±0.5 % efficiency gate before any public accuracy claim).

(Fab analytics is PARKED per MASTERPLAN §7 — re-open triggers documented there.)

## Feature-parity checklist

### M0 — Foundation
- [x] Repo scaffold: Next.js 15 + TypeScript + Tailwind + Vitest + CI
- [x] Frozen domain type contract (`src/lib/types.ts`)
- [x] Goal + module contracts documented

### M1 — Engineering core (pure TS, fully unit-tested)
- [ ] Component database: ≥40 real GaN/SiC/Si switches with datasheet parameters
- [ ] Component database: gate drivers, controllers, capacitors, heatsinks
- [ ] Magnetics database: core materials (Steinmetz), cores, wire table
- [ ] Loss engine: conduction (tempco), hard/soft switching, Coss, gate, dead-time,
      iGSE core loss, Dowell AC copper loss, capacitor ESR
- [ ] Topology engine: buck/boost/sync-buck/interleaved, LLC, PSFB, DAB,
      totem-pole PFC, flyback, forward — selection scoring + operating points
- [ ] Magnetics design engine: area-product core selection, turns, gap, litz, losses
- [ ] Thermal engine: Rth network, loss↔Tj iteration, heatsink selection
- [ ] Control engine: averaged small-signal models, compensator design, digital coeffs
- [ ] Simulation engine: switching waveforms (PWL state-space), ripple, efficiency curves
- [ ] Firmware generator: C code for STM32G4 + TI C2000 with generated loop coeffs
- [ ] Schematic generator: netlist + SVG render + SPICE export
- [ ] BOM generator: lines, pricing, suppliers, alternates
- [ ] Compliance engine: derating, creepage/clearance (IEC 62368-1), thermal margins
- [ ] PCB layout guidance: power-loop geometry, stackup, placement floorplan
- [ ] Copilot NL parser: "5kW bidirectional 800V→48V" → DesignSpec
- [ ] Optimizer: topology × device × fsw sweep, Pareto (efficiency/cost/density),
      recommended design composition

### M2 — Platform
- [ ] API: /api/design, /api/copilot, /api/components, /api/optimize, /api/firmware, /api/spice
- [ ] UI: landing + copilot prompt
- [ ] UI: design workbench (loss waterfall, efficiency curves, thermal, magnetics,
      BOM, schematic, firmware, compliance)
- [ ] UI: component terminal (filter/sort/compare)
- [ ] UI: Pareto explorer
- [ ] Docs page: methodology + model assumptions

### M3 — Quality & deployment
- [ ] Full test suite green (`npm test`), typecheck green, `next build` green
- [ ] End-to-end integration test: "Design a 5kW bidirectional converter" → complete result
- [ ] CI on GitHub Actions
- [ ] Deployed (Vercel) and reachable

### M4 — Sell-ready depth + trust loop (v2, loop iterations)
- [ ] ORv3 PSU path first-class: LLC + totem-pole PFC at 3–18.3 kW with 97.5 %+
      peak-efficiency designs; 48/54V→12V IBC path
- [ ] Calibration harness: reproduce ≥3 published measured reference designs
      (TI PMP23126, Infineon 3 kW class, Navitas Ruby-class) within ±0.5 %;
      publish comparison in /docs — gate for public accuracy claims
- [ ] ngspice round-trip validation of generated netlists in CI
- [ ] KiCad s-expression schematic export; LTspice netlist export
- [ ] BOM: live pricing/availability fields + region-aware second sourcing
- [ ] Multi-objective optimizer honoring density (W/in³) + cost ceilings
- [ ] Device DB ≥80 parts with provenance flags (vendor-claimed vs characterized)
      and normalized FIT/reliability fields
- [ ] Export pack: printable design report, compliance doc pack, firmware bundle
- [ ] Claude-API-powered copilot mode (falls back to deterministic parser)
- [ ] Account/tiering stub: free tier limits, team tier, per-design runs

### M5 — 800 V-native suite (v3; replaces parked fab analytics)
- [ ] 800V→50/12/6V design paths (stacked LLC / ISOP, matrix-transformer
      magnetics) demo-ready; ±400 V Mt. Diablo variants
- [ ] EMI pre-compliance estimator: filter auto-design + CISPR 32 conducted
      risk scoring (framed as risk reduction, never "will pass")
- [ ] Firmware-HIL evidence pack: auto-generated loop-stability tests
- [ ] Rack-level power-tree modeling (shelf → busbar → blade)

## Loop protocol

Each `/loop` iteration: (1) read this file + MASTERPLAN.md §9 KPI table (and
TECHPLAN.md when present), pick the highest-leverage unchecked items; (2)
implement; (3) `npm run typecheck && npm test && npm run build`; (4) fix
failures; (5) deploy; (6) check items off, append a line to the iteration log
below; (7) commit + push to `claude/ai-power-delivery-platform-ghcmyl`.
Standing gates: all three commands green every loop; no public accuracy claims
ahead of the calibration set.

## Iteration log

- 2026-08-01 · it0 · Scaffold + goal established.
