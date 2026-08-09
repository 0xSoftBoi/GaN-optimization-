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

## Workload-to-power integration

VoltForge can consume the versioned LCA-1 accelerator power trace and turn it
into a converter sizing input without discarding burst behavior. The integration
reports energy, peak/P95 power, load step, slew, and activity-state duty cycle;
it requires measured watts by default and keeps estimates visibly labeled.

See [LCA-1 workload power → VoltForge](./docs/LCA1_POWER_TRACE.md).

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
