# ⚡ VoltForge — the AI Power Delivery Platform

**"CUDA for power electronics."** Spec in → complete GaN/SiC converter design out.

AI datacenters are power-constrained: every GPU rack needs multiple AC/DC and
DC/DC conversion stages, and wide-bandgap devices (GaN, SiC) are how the industry
escapes silicon's efficiency ceiling. VoltForge is the software layer that
automatically optimizes power conversion around them.

## What it does

Enter a requirement — input/output voltage, power, thermal constraints — or a
plain-English prompt:

> "Design a 5 kW bidirectional converter, 800 V bus to 48 V rack, forced air, 40 °C"

VoltForge generates:

- **Optimal topology** — scored selection across buck/boost, LLC, PSFB, DAB,
  totem-pole PFC, flyback, forward
- **Optimized switch selection** — real GaN/SiC parts (Navitas, EPC, Infineon,
  GaN Systems, TI, Wolfspeed, onsemi, ROHM) swept across switching frequency
- **Loss analysis** — conduction (with tempco), switching, Coss, gate, dead-time,
  iGSE core loss, Dowell AC copper loss
- **Magnetic design** — core selection, turns, air gap, litz sizing
- **Thermal simulation** — Rth network with loss↔Tj iteration, heatsink pick
- **Schematic** — netlist, SVG diagram, SPICE export
- **PCB layout guidance** — power-loop limits, stackup, placement floorplan
- **Controller firmware** — generated C for STM32G4 / TI C2000 with computed
  compensator coefficients
- **BOM** — pricing, suppliers, alternates
- **Compliance checks** — derating, creepage/clearance (IEC 62368-1), margins

Plus a **component terminal** ("Bloomberg for power electronics") and a
**Pareto explorer** for efficiency vs cost vs density trade-offs.

## Example runs

Six `designConverter(spec)` calls, unedited, spanning the power/topology range
the engine covers — from a 150 W point-of-load to a 10 kW bidirectional brick,
DC-DC and AC-DC. Every field below (topology, device, switching frequency,
efficiency, loss, BOM cost, thermal margin) is engine output, not a projection.

| Spec | Topology | Switch | fsw | Efficiency | Loss | BOM | Tj margin |
|---|---|---|---|---|---|---|---|
| 150 W, 12 V → 5 V | Buck (async) | EPC2218 (GaN) | 316 kHz | 97.37 % | 4.0 W | $18 | 37.6 °C |
| 600 W, 48 V → 12 V sync buck, natural convection | Synchronous buck | EPC2218 (GaN) | 100 kHz | 97.81 % | 13.5 W | $31 | 19.6 °C |
| 1 kW, isolated 400 V → 48 V | Dual active bridge | NV6117 (GaN) | 178 kHz | 98.13 % | 19.1 W | $66 | 15.6 °C |
| 3 kW, totem-pole PFC, 230 Vac | Totem-pole PFC | NV6128 (GaN) | 100 kHz | 98.52 % | 45.0 W | $80 | 21.6 °C |
| 5 kW, bidirectional isolated, 800 V → 48 V (flagship) | Dual active bridge | G3R75MT12J (SiC) | 178 kHz | 96.91 % | 159.6 W | $162 | 9.9 °C |
| 10 kW, bidirectional isolated, 800 V → 48 V, liquid-cooled | Dual active bridge | G3R75MT12J (SiC) | 316 kHz | 94.16 % | 620.7 W | $198 | 8.7 °C |

Notes from these runs:

- The optimizer correctly separates regimes: low-power non-isolated stages land
  on GaN buck/sync-buck; the 3 kW AC front end lands on totem-pole PFC in GaN;
  isolated/bidirectional bricks land on DAB in either GaN (1 kW) or SiC
  (5–10 kW), consistent with the device doctrine in `MASTERPLAN.md` §2.1.
- The 5 kW and 10 kW DAB runs cleared every gate (`compliancePassed: true`,
  `thermalOk: true`) but with thin junction margin (<10 °C) and also emitted a
  magnetics hot-spot warning that overshoots physically at high dissipation —
  a known v1 fidelity gap in the `Rth ≈ 36/√Ve` core-surface estimate, already
  scoped for the `TECHPLAN.md` it3 magnetics-core iteration. Shown here
  unfiltered rather than cherry-picked, in keeping with the project's
  "physics sanity over marketing" rule.
- Full sweep sizes (`candidateCount`, the number of topology × device × fsw
  points actually evaluated per run) ranged 40–120; each run completed in
  well under 150 ms.

Reproduce these yourself: `POST /api/design` with any spec, or `designConverter(spec)`
directly from `@/lib/optimizer` — see `src/lib/MODULES.md`.

## Stack

Next.js 15 · TypeScript · Tailwind · Vitest. The engineering core is pure,
dependency-free TypeScript under `src/lib/` — see `src/lib/MODULES.md`.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engineering-core test suite
npm run typecheck
npm run build
```

## Roadmap

See [GOAL.md](./GOAL.md) — feature-parity checklist and iteration log.

> Models are physics-based estimates for design exploration — validate on
> hardware before production.
