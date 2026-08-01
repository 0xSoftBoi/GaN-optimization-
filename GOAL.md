# GOAL — VoltForge: the AI Power Delivery Platform

> "CUDA for power electronics" + "the Bloomberg Terminal for power electronics."
> Spec in → complete, sellable converter design out.

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

Target customers: OEMs building AI-datacenter power supplies, power-supply design
houses, component vendors, research labs. Model: recurring SaaS, $500–5,000 per
engineer per month.

## Product pillars

1. **Design Engine** ("CUDA for power electronics") — deterministic, physics-based
   generation and optimization of complete converter designs.
2. **AI Copilot** — natural-language front end: prompt → spec → full design.
3. **Component Terminal** ("Bloomberg for power electronics") — every GaN/SiC
   transistor, magnetics, drivers, controllers: parameters, thermal models,
   pricing, suppliers — searchable and comparable.
4. **Fab Analytics** (phase 2) — yield/defect analytics for GaN epitaxy and wafer
   production (foundries, IDMs).

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

### M4 — Sell-ready depth (loop iterations)
- [ ] AC/DC front ends: totem-pole PFC design path fully wired to grid specs
- [ ] Multi-objective optimizer refinements (density targets, cost ceilings honored)
- [ ] Device DB breadth: ≥80 parts, refreshed pricing
- [ ] Reliability data (FIT, lifetime) per device family
- [ ] Export pack: design report (printable), SPICE netlist, firmware bundle
- [ ] Claude-API-powered copilot mode (falls back to deterministic parser)
- [ ] Account/tiering stub for SaaS packaging

### M5 — Fab analytics (phase 2)
- [ ] Wafer-map defect ingestion + yield statistics module
- [ ] Defect classification model interface (CV hook)
- [ ] Epitaxy process-window analytics

## Loop protocol

Each `/loop` iteration: (1) read this file, pick the highest-leverage unchecked
items; (2) implement; (3) `npm run typecheck && npm test && npm run build`;
(4) fix failures; (5) deploy; (6) check items off, append a line to the iteration
log below; (7) commit + push to `claude/ai-power-delivery-platform-ghcmyl`.

## Iteration log

- 2026-08-01 · it0 · Scaffold + goal established.
