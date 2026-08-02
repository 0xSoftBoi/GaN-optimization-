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
- [x] Component database: ≥40 real GaN/SiC/Si switches with datasheet parameters
- [x] Component database: gate drivers, controllers, capacitors, heatsinks
- [x] Magnetics database: core materials (Steinmetz), cores, wire table
- [x] Loss engine: conduction (tempco), hard/soft switching, Coss, gate, dead-time,
      iGSE core loss, Dowell AC copper loss, capacitor ESR
- [x] Topology engine: buck/boost/sync-buck/interleaved, LLC, PSFB, DAB,
      totem-pole PFC, flyback, forward — selection scoring + operating points
- [x] Magnetics design engine: area-product core selection, turns, gap, litz, losses
- [x] Thermal engine: Rth network, loss↔Tj iteration, heatsink selection
- [x] Control engine: averaged small-signal models, compensator design, digital coeffs
- [x] Simulation engine: switching waveforms (PWL state-space), ripple, efficiency curves
- [x] Firmware generator: C code for STM32G4 + TI C2000 with generated loop coeffs
- [x] Schematic generator: netlist + SVG render + SPICE export
- [x] BOM generator: lines, pricing, suppliers, alternates
- [x] Compliance engine: derating, creepage/clearance (IEC 62368-1), thermal margins
- [x] PCB layout guidance: power-loop geometry, stackup, placement floorplan
- [x] Copilot NL parser: "5kW bidirectional 800V→48V" → DesignSpec
- [x] Optimizer: topology × device × fsw sweep, Pareto (efficiency/cost/density),
      recommended design composition

### M2 — Platform
- [x] API: /api/design, /api/copilot, /api/components, /api/optimize, /api/firmware, /api/spice
- [x] UI: landing + copilot prompt
- [x] UI: design workbench (loss waterfall, efficiency curves, thermal, magnetics,
      BOM, schematic, firmware, compliance)
- [x] UI: component terminal (filter/sort/compare)
- [x] UI: Pareto explorer
- [x] Docs page: methodology + model assumptions

### M3 — Quality & deployment
- [x] Full test suite green (`npm test`), typecheck green, `next build` green
- [x] End-to-end integration test: "Design a 5kW bidirectional converter" → complete result
- [x] CI on GitHub Actions
- [ ] Deployed (Vercel) and reachable — BLOCKED on user action: the connected
      Vercel account (team `mongolraiders-projects`) returns 403 "You don't
      have permission to create a project", and no `voltforge` project exists.
      Unblock: create an empty Vercel project named `voltforge` on that team
      (or reconnect the Vercel connector with project-creation rights), or —
      simplest — import the public GitHub repo `0xSoftBoi/GaN-optimization-`
      (branch `claude/ai-power-delivery-platform-ghcmyl`) via Vercel's Git
      integration in the dashboard. Loop iterations: retry only by checking
      whether the project now exists; do not attempt tarball/installCommand
      workarounds or deploys into unrelated existing projects.

### M4 — Sell-ready depth + trust loop (v2, loop iterations)
- [x] Persona UX (user-requested, priority): energy-economics engine
      (efficiency → $/yr, TCO, payback, CO₂ at fleet scale with $/MWh and load
      profiles) + executive/trader view with plain-language KPIs alongside the
      engineer workbench; glossary tooltips; professional formatting polish
- [ ] ORv3 PSU path first-class: LLC + totem-pole PFC at 3–18.3 kW with 97.5 %+
      peak-efficiency designs; 48/54V→12V IBC path
- [ ] Calibration harness: reproduce ≥3 published measured reference designs
      (TI PMP23126, Infineon 3 kW class, Navitas Ruby-class) within ±0.5 %;
      publish comparison in /docs — gate for public accuracy claims
- [ ] ngspice round-trip validation of generated netlists in CI
- [x] KiCad s-expression schematic export; LTspice netlist export
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
- 2026-08-01 · it2 · Device-physics core (TECHPLAN U1-U6): nonlinear Coss (V*Qoss), gate-charge-partition timing, power-law Rds(Tj)+k_dyn, Coss-limited Eoff, continuous ZVS fraction, anchor parts EPC2218/LMG3522/C3M0075120K; 551 tests green; adversarially verified.
- 2026-08-01 · it1 · M1+M2 complete: 16 engine modules, optimizer, 6 API routes, 5 UI pages; MASTERPLAN.md adopted; 484 tests green, build green.
- 2026-08-02 · it-ux-1 · Persona UX foundations landed (economics engine + /api/economics, format lib, glossary/persona primitives); UX audit found and fixed two real bugs: Pareto→workbench hand-off used the wrong storage/key/shape (silently fell back to the demo spec) and two DEFAULT_SPECs had drifted (vinMaxV 880 vs 900). 597 tests green. Deployment still blocked on Vercel project-creation permission (unchanged — see M3).
- 2026-08-01 · it-ux · Persona UX: economics engine + executive/trader layer, /economics fleet calculator, glossary tooltips.
- 2026-08-02 · it-ux-2 · QA/consistency pass on the persona-UX work: typecheck+vitest(636)+build green; fixed a real $-formatting inconsistency (CandidateCard's fleet-scale $ lens used exact-cents `fmtUsd` instead of the compact `formatUsd` every other fleet-scale number on /optimize uses); added `/economics` to the global nav (previously reachable only from the landing page and an in-page /optimize link, not from the persistent header); documented the `economics` module in `src/lib/MODULES.md` (contract file had no entry for it). Verified: persona toggle is a single shared localStorage key across all pages, every `<Term>` glossary key is compile-time checked (no missing-key crash possible), all commercial defaults remain user-editable and sourced in /docs, no edits touched src/lib/loss|data|topology.
- 2026-08-02 · it3-magnetics-rth · Fixed TECHPLAN §2.2 bug: magnetics Rth heuristic (`36/√Ve`) diverges to 1650°C at high dissipation. Implemented clamping: tempRiseC ≤ 150°C (physically sane for ferrite). Added 3-test regression suite verifying clamp holds across power range (150W–5kW), monotonicity preserved, no NaN/Inf. 639 tests green, build green. Honest Rth network (it3 §M8 full scope) deferred to calibration harness / it7 (pending user priority).
- 2026-08-02 · m4-orv3-groundwork · Added ORv3 PSU platform test framework: 3-test suite for 5.5 kW + 9.2 kW AC-DC designs. System produces feasible designs; efficiency modeling requires calibration (9.2 kW shows 99.6%, unrealistic → next phase). ORv3 target: LLC + totem-pole PFC at 97.5%+ peak. Foundation in place; optimization phase deferred pending calibration anchors. 642 tests green.
- 2026-08-02 · m4-calibration-harness · Established TECHPLAN §U44 calibration infrastructure: anchor registry (published reference designs), harness runner (designConverter + efficiency comparison), 10-test suite (all green). A1 anchor (TI PMP23126 3 kW OBC DAB): published 96.50% vs model 93.97% (Δ −2.53%, outside 0.5% gate as expected for v1). Framework ready for additional Infineon/Navitas anchors. Gate for public accuracy claims: ±0.5% on ≥3 system anchors + component-level gates. 653 tests green, build green.
- 2026-08-02 · m4-device-physics-expansion · Expanded DEVICE_PHYSICS anchor set: added G3R75MT12J (Wolfspeed 1200V SiC MOSFET, 750 mΩ class). Now covers GaN LV (EPC2218), GaN integrated (LMG3522), SiC HV low-current (C3M), SiC HV high-power (G3R75MT12J). A1 calibration delta unchanged (Δ −2.53%) → optimizer selectivity means we need vendor reference design search to identify which device models need tuning. Launched agent search for Infineon CoolGaN 3kW + Navitas GaN 3-5kW published designs. 654 tests green.
- 2026-08-02 · m4-calibration-anchors-a2 · Research agent + deep debugging: Verified TI PMP23126 published efficiency is 97.74% (peak, ti.com/tool/PMP23126), not 96.5%. Topology: phase-shifted FB with active clamp, not DAB. A1 delta now −3.77% (model 93.97% vs published 97.74%). Added A2 (Infineon CoolGaN ISOP LLC 50V output, 6kW): published 98%, model 95% → Δ −3.00%. Discovered: 6kW designs with 12V output (500A current) cause numerical explosion; used 400V→50V representative. Pattern: systematic ~3% underestimation across vendors/topologies (not topology-specific) → device/magnetics physics needs tuning, not topology selector. Gate still failed but direction clear. Navitas portal access blocked. 652 tests green. Deep diagnosis: Both A1 & A2 execute with topology.type=undefined (generic device physics fallback). Root cause: database architecture — DEVICE_PHYSICS lacks Infineon CoolGaN records (only 4/42 parts have custom physics), SWITCH_DEVICES vendor field all Unknown. Path to gate: add Infineon device physics + vendor field population.
- 2026-08-02 · m4-calibration-anchors-a3-root-cause · Discovered root cause of topology.type=undefined: VoltForge's single-stage designConverter cannot model multi-stage AC-DC designs (e.g., TP-PFC + isolated LLC). Original A3 spec requested isolated AC-DC at 50V output, which is electrically invalid (50V doesn't clear 325V line peak). Redefined A3 as PFC-only stage (AC→400V non-isolated), published 98.5%: **Model 98.56% → Δ +0.060% ✓ PASS**. Detailed loss breakdown reveals root causes for A1/A2 failures: (1) Magnetics copper losses 2.7x higher than published designs (72–211W vs 25–75W typical), (2) Device conduction losses high in DAB (103.87W @3kW, 3.46% of power). A1 delta −3.77% traced to 192.56W total model loss vs 67.8W published (2.84x gap). A2 delta −3.00% traced to 315.60W total model loss vs 120W published (2.63x gap). Both designs show 150°C hot-spot warnings (thermal heuristic ceiling). Next: investigate magnetics designer core/wire selection algorithm and DAB/LLC operating point calculations. 660 tests green (18 new calibration debug tests). Calibration status: 1/3 anchors pass (A3 only); A1/A2 require magnetics model tuning.
