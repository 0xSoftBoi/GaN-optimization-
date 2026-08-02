"use client";

/**
 * /docs — static methodology page. What each engine models, the key
 * equations in plain text, assumptions, validity limits, and the API.
 * No data fetching — this page is documentation.
 */

import { Term } from "@/components/ui/term";

const SPEC_JSON = `{
  "spec": {
    "name": "5 kW bidirectional 800V→48V",
    "conversion": "dc-dc",
    "vinMinV": 680, "vinNomV": 800, "vinMaxV": 880,
    "voutV": 48, "poutW": 5000,
    "bidirectional": true, "isolated": true,
    "ambientC": 40, "cooling": "forced-air"
  }
}`;

const TOC: { id: string; label: string }[] = [
  { id: "topology", label: "Topology" },
  { id: "loss", label: "Loss" },
  { id: "magnetics", label: "Magnetics" },
  { id: "thermal", label: "Thermal" },
  { id: "control", label: "Control" },
  { id: "simulation", label: "Simulation" },
  { id: "outputs", label: "Outputs" },
  { id: "compliance", label: "Compliance" },
  { id: "optimizer", label: "Optimizer" },
  { id: "copilot", label: "Copilot" },
  { id: "economics-methodology", label: "Economics" },
  { id: "business-assumptions", label: "Business assumptions" },
  { id: "api", label: "API" },
];

function TableOfContents() {
  return (
    <nav
      aria-label="On this page"
      className="sticky top-14 z-30 -mx-4 border-b border-ink-600 bg-ink-900/95 px-4 py-2 backdrop-blur"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {TOC.map((t) => (
          <a key={t.id} href={`#${t.id}`} className="text-slate-400 transition-colors hover:text-volt">
            {t.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  /** One line: why this section matters commercially, ahead of the physics. */
  lead?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="panel scroll-mt-24">
      <h2 className="panel-title">{title}</h2>
      {lead && <p className="mb-3 text-sm font-medium text-slate-200">{lead}</p>}
      <div className="space-y-3 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

function Eq({ children }: { children: React.ReactNode }) {
  return (
    <code className="block overflow-x-auto rounded border border-ink-600 bg-ink-900 px-3 py-2 text-xs text-volt/90">
      {children}
    </code>
  );
}

function Curl({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded border border-ink-600 bg-ink-900 px-3 py-2 text-xs text-slate-300">
      {children}
    </pre>
  );
}

export default function DocsPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold text-slate-100">Methodology</h1>
        <span className="text-xs text-slate-400">
          what the engines model, and where the models stop
        </span>
      </div>

      <TableOfContents />

      <div className="panel border-[#f59e0b]/40">
        <p className="text-sm text-[#f59e0b]">
          Every number VoltForge produces is a design-exploration estimate built
          from datasheet parameters and standard analytical methods. Estimates
          rank candidates and size components well; they are not a substitute
          for bench measurement. Validate on hardware before production.
        </p>
      </div>

      <Section
        id="topology"
        title="Topology engine"
        lead="Why it matters commercially: picking the right circuit topology is the single biggest lever on both efficiency and BOM cost — get it wrong and no amount of tuning later recovers it."
      >
        <p>
          Eleven topologies (buck family, boost, LLC half/full bridge, PSFB,
          DAB, totem-pole PFC, flyback, forward active-clamp) carry practical
          power windows, isolation/bidirectionality flags, and soft-switching
          class. A spec is scored against each: hard disqualifiers first
          (isolation demanded but not offered, power far outside the window),
          then graded fit — conversion ratio vs the topology&apos;s comfortable
          range, power level, soft-switching benefit at the implied frequency.
          The winner&apos;s operating points (per-position V<sub>off</sub>,
          I<sub>rms</sub>, I<sub>on</sub>/I<sub>off</sub>, duty, ZVS flag,
          dead-time fraction) are computed from idealized steady-state
          waveforms — ripple included, parasitics excluded.
        </p>
        <p className="text-xs text-slate-500">
          Assumes CCM steady state at nominal input unless the sweep says
          otherwise. Line/load transients do not influence topology choice.
        </p>
      </Section>

      <Section
        id="loss"
        title="Loss engine"
        lead="Why it matters commercially: every watt counted here is a watt your energy bill and cooling budget pay for, every year the converter runs."
      >
        <p>Per switch position, five loss terms are summed across parallel devices:</p>
        <Eq>
          Pcond = Irms² · Rds(on)(Tj), with Rds(T) = R25 · (1 + k·(T − 25)) — datasheet tempco
        </Eq>
        <Eq>
          Psw = 0.5 · Voff · (Ion·ton + Ioff·toff) · fsw — V·I overlap, transition times from
          Qg and driver current; zero at ZVS turn-on
        </Eq>
        <Eq>Pcoss = Eoss · fsw (hard-switched only) · Pgate = Qg · Vgs · fsw</Eq>
        <Eq>
          Pdead = Vsd · Iavg · tdead-fraction — GaN third-quadrant conduction is priced, Qrr
          added for Si/SiC body diodes (Qrr = 0 for GaN)
        </Eq>
        <p>
          Magnetics core loss uses the Steinmetz fit{" "}
          <code className="text-volt/90">Pv[kW/m³] = k · f^α · B^β</code> (iGSE
          correction for non-sinusoidal flux), copper loss uses Dowell&apos;s
          AC-resistance factor per layer count and skin depth. Capacitor loss
          is ESR · I<sub>rms</sub>².
        </p>
        <p className="text-xs text-slate-500">
          Valid roughly 50 kHz–2 MHz with 100–500 kHz Steinmetz fits.
          Package/layout parasitic ringing, common-source inductance, and EMI
          filter losses are not modeled.
        </p>
      </Section>

      <Section
        id="magnetics"
        title="Magnetics design"
        lead="Why it matters commercially: magnetics are usually the biggest, priciest, hottest parts in the box — sizing them wrong inflates BOM cost and blows the thermal budget at once."
      >
        <p>
          Core selection is by area product:{" "}
          <code className="text-volt/90">Ap = Ae·Aw ≥ (L·Ipk·Irms) / (Bmax·J·ku)</code>{" "}
          over a catalog of PQ/E cores in ferrites like 3C97/N97/ML91S. Turns
          from flux balance, air gap from the required A<sub>L</sub>{" "}
          (fringing-corrected), wire from current density with litz strands
          chosen against skin depth. Losses: iGSE core + Dowell copper;
          hot-spot rise from an empirical thermal-resistance-vs-surface-area
          fit. Window utilization is checked (ku ≤ ~0.4 solid, ~0.3 litz).
        </p>
        <p className="text-xs text-slate-500">
          B<sub>peak</sub> is capped below B<sub>sat</sub> with margin;
          proximity effect beyond Dowell&apos;s 1-D assumption (e.g. gap
          fringing onto windings) is not resolved.
        </p>
      </Section>

      <Section
        id="thermal"
        title="Thermal engine"
        lead="Why it matters commercially: thermal margin is what stands between a shipped product and a field return — it is the single biggest driver of warranty risk."
      >
        <p>
          A junction→case→sink→ambient resistance chain per device:{" "}
          <code className="text-volt/90">Tj = Tamb + P·(RthJC + RthCS + RthSA)</code>.
          Heatsinks come from the catalog (natural or 400 LFM forced ratings);
          liquid/cold-plate cooling uses fixed effective sink resistances.
          Because losses depend on Tj (Rds tempco) and Tj depends on losses,
          the engine iterates loss ↔ temperature to a fixed point and reports
          per-node margins against the Tj limit (default 125 °C).
        </p>
        <p className="text-xs text-slate-500">
          Steady-state only — no transient thermal impedance (Zth) curves, no
          board conduction spreading model beyond the lumped chain.
        </p>
      </Section>

      <Section
        id="control"
        title="Control design"
        lead="Why it matters commercially: a badly tuned loop shows up as instability or slow response under a real load step — a field failure, not just a spec-sheet number."
      >
        <p>
          Averaged small-signal models per topology (buck-family LC, boost
          with RHP zero, resonant approximations) feed a compensator designer:
          type-2/type-3 or PI placed for a target crossover (typically
          fsw/10–fsw/20) and ≥45° phase margin. Digital coefficients come from
          the bilinear transform at the switching-rate sample frequency:
        </p>
        <Eq>H(z) = (b0 + b1·z⁻¹ + b2·z⁻²) / (1 + a1·z⁻¹ + a2·z⁻²), s → 2·fs·(1−z⁻¹)/(1+z⁻¹)</Eq>
        <p className="text-xs text-slate-500">
          Small-signal validity only; large-signal slew, current-limit
          behavior, and burst modes are firmware concerns, not modeled here.
        </p>
      </Section>

      <Section
        id="simulation"
        title="Switching simulation"
        lead="Why it matters commercially: waveform-level checks catch ripple and stress problems before they become a compliance finding or a reliability surprise in the field."
      >
        <p>
          Piecewise-linear state-space integration of the switching cell
          (ideal switches + L/C/ESR) over ≥6 periods to steady state, yielding
          inductor current ripple, output voltage ripple, and waveform traces.
          Topologies without a PWL model fall back gracefully with a note.
        </p>
      </Section>

      <Section
        id="outputs"
        title="Schematic, BOM, layout guidance"
        lead="Why it matters commercially: this is what a buyer, contract manufacturer, or fab actually receives — netlist, priced BOM, and layout guidance ready to hand off."
      >
        <p>
          The schematic generator emits a netlist, a one-line SVG rendering,
          and a SPICE .cir netlist for external verification. The BOM engine
          rolls the chosen parts into priced lines (1k-volume pricing,
          supplier lists, alternates). Layout guidance encodes wide-bandgap
          practice: minimized hard-switched loop area targets, gate-loop
          separation, stackup recommendation, and critical-loop area limits in
          mm².
        </p>
      </Section>

      <Section
        id="compliance"
        title="Compliance checks"
        lead="Why it matters commercially: a compliance fail caught here is a five-minute redesign; the same fail caught in certification testing is a missed schedule and a re-spin."
      >
        <p>
          Rule-based review of the finished design: device voltage derating
          (peak stress ≤ 80% of rating), junction-temperature margin ≥ 15 °C,
          creepage/clearance vs the IEC 62368-1 table for the working voltage
          and pollution degree, output-ripple spec conformance, and
          isolation/bidirectionality consistency between spec and topology.
          Findings are pass/warn/fail — a fail blocks the compliance gate, not
          the design output.
        </p>
        <p className="text-xs text-slate-500">
          This is a pre-check, not certification. EMC (CISPR 32) and safety
          agency testing remain lab work.
        </p>
      </Section>

      <Section
        id="optimizer"
        title="Optimizer & Pareto exploration"
        lead={
          <>
            Why it matters commercially: this is the step that turns &quot;a design&quot;
            into &quot;the best available trade-off for your spec&quot; — see{" "}
            <Term k="pareto">Pareto</Term> — the number an executive scanning /optimize
            actually looks at.
          </>
        }
      >
        <p>
          The composition root scores topologies, then sweeps the top
          candidates across the switch catalog × log-spaced switching
          frequencies (100 kHz–1 MHz, or around a forced fsw). Every candidate
          gets operating points, parallel-device count, full losses, magnetics,
          thermal iteration, and cost. Feasibility = thermal OK + spec ceilings
          met. A candidate is Pareto-optimal when no feasible candidate is
          simultaneously better on efficiency, BOM cost, and power density.
          The winner is picked from the front and composed into the complete
          deliverable (schematic → BOM → compliance → compensator → simulation
          → firmware → efficiency curve at 10–100% load).
        </p>
      </Section>

      <Section
        id="copilot"
        title="Copilot parser"
        lead="Why it matters commercially: one typed sentence in, a fully priced, fully engineered design out — no waiting on a distributor FAE for a first-pass answer."
      >
        <p>
          The natural-language front end is a deterministic parser: it
          extracts power (&quot;5kW&quot;), voltage pairs (&quot;800V to
          48V&quot;), direction, isolation, frequency, ambient, and cooling
          from the prompt, fills gaps with engineering defaults, and reports
          every assumption plus any unrecognized fragments alongside a
          confidence score. No LLM in the loop — same prompt, same spec, every
          time.
        </p>
      </Section>

      <Section
        id="economics-methodology"
        title="Economics methodology"
        lead="Why it matters commercially: this is the exact math behind every $/yr, payback, and CO2 number shown on /economics and elsewhere on the site."
      >
        <p>
          <Term k="tco">Fleet economics</Term> compares this design&apos;s efficiency curve
          against a flat baseline efficiency, processing the same delivered output energy,
          over a weighted load-duty profile. All formulas are per unit unless noted.
        </p>
        <Eq>E_out [MWh/yr] = P_out[W] × loadPct/100 × hours/yr / 1e6, summed over profile points (weights normalized to 1)</Eq>
        <Eq>E_in [MWh/yr] = E_out / η(loadPct) — this design&apos;s interpolated efficiency curve</Eq>
        <Eq>E_in,base [MWh/yr] = E_out / η_baseline — the flat baseline efficiency</Eq>
        <Eq>$ saved/yr (per unit) = (E_in,base − E_in) × price [$/MWh]</Eq>
        <Eq>Fleet $/yr = $ saved/yr (per unit) × fleet units; Horizon $ = Fleet $/yr × horizon years (undiscounted)</Eq>
        <Eq>Payback [months] = BOM cost [$] / $ saved/yr (per unit) × 12 — null when savings ≤ 0</Eq>
        <Eq>CO2 avoided [t/yr] = (E_in,base − E_in) × fleet units × carbon intensity [kg/MWh] / 1000</Eq>
        <p>
          Every input to these formulas — energy price, operating hours, baseline efficiency,
          fleet size, horizon, load profile, carbon intensity — is a user-adjustable field.{" "}
          <code className="text-volt/90">defaultAssumptions()</code> in{" "}
          <code className="text-volt/90">src/lib/economics</code> supplies clearly-labeled
          starting points, never asserted facts; <code className="text-volt/90">/api/economics</code>{" "}
          echoes the fully-resolved assumption set back so the UI never displays a hidden
          default. Nothing in this module fetches or looks up live market data.
        </p>
      </Section>

      <Section
        id="business-assumptions"
        title="Business assumptions"
        lead="Why it matters commercially: the defaults below are honest starting points, not looked-up facts — set them to match your own tariff, grid, and duty cycle before treating any $ or CO2 number as final."
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Energy price — default $70/MWh
        </h3>
        <p className="text-xs text-slate-400">
          Retail industrial electricity in the US has recently run roughly $60–110/MWh
          (source: U.S. Energy Information Administration, <em>Electric Power Monthly</em>,
          eia.gov/electricity/monthly); EU industrial rates are often $100–250/MWh (source:
          Eurostat, &quot;Electricity price statistics&quot;, ec.europa.eu/eurostat); wholesale
          hub prices can sit at $20–60/MWh depending on the ISO/RTO. Pick the number your
          meter actually pays.
        </p>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Grid carbon intensity — default 350 kg CO2/MWh
        </h3>
        <p className="text-xs text-slate-400">
          Grid carbon intensity varies enormously by region: the world average is on the
          order of 400–450 kg CO2/MWh (source: IEA, <em>Global Energy Review: CO2
          Emissions</em>, iea.org; Ember, <em>Global Electricity Review</em>,
          ember-climate.org), the US grid roughly 350–400 (EPA eGRID, epa.gov/egrid), the EU
          roughly 250, hydro/nuclear-heavy grids under 50, coal-heavy grids 700+. Set it to
          your region, not the default.
        </p>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Baseline efficiency — default 96.5% flat
        </h3>
        <p className="text-xs text-slate-400">
          A flat &quot;titanium-class&quot; reference: the 80 PLUS Titanium certification tier
          requires roughly 96% efficiency at 50% load (230 V). 96.5% flat is a deliberately
          tough, clearly-labeled comparison baseline — swap in your own incumbent&apos;s
          measured efficiency curve for a fairer comparison where you have one.
        </p>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Operating hours &amp; load profile — default 8760 h/yr, datacenter-weighted
        </h3>
        <p className="text-xs text-slate-400">
          8760 h/yr (24×365) assumes continuous duty; derate it for intermittent operation
          (e.g. ~2000–2900 h/yr is typical of business-hours-only equipment). The default
          load-duty profile weights 60–90% load most heavily, typical of a well-utilized rack
          power system — override it if your fleet&apos;s duty cycle differs.
        </p>
        <p className="text-xs text-[#f59e0b]">
          None of these figures are fetched, audited, or asserted as current market data —
          they are editable engineering assumptions with typical published ranges quoted
          above for context. Validate against your own tariff and grid data before using the
          $ or CO2 numbers commercially.
        </p>
      </Section>

      <Section id="api" title="API">
        <p className="text-xs text-slate-500">
          All endpoints are local to this deployment. POST bodies are JSON;
          spec fields follow SI units (V, W, Hz, °C).
        </p>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          GET /api/components — catalog query
        </h3>
        <Curl>{`curl "https://voltforge.example/api/components?kind=switch&tech=GaN&minVdsV=600&q=navitas"
# kind: switch | driver | controller | capacitor | heatsink | core
# switch-only filters: tech, minVdsV, maxRdsOnMohm; q = free text (all kinds)`}</Curl>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          POST /api/design — full DesignResult
        </h3>
        <Curl>{`curl -X POST https://voltforge.example/api/design \\
  -H "content-type: application/json" \\
  -d '${SPEC_JSON.replace(/\n/g, "\n  ")}'`}</Curl>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          POST /api/optimize — candidate space + winner summary
        </h3>
        <Curl>{`curl -X POST https://voltforge.example/api/optimize \\
  -H "content-type: application/json" \\
  -d '{"spec": { ...same spec object... }}'
# -> {"candidates": [...], "bestSummary": {"topologyId", "efficiencyPct", "bomCostUsd", "fswHz", "deviceId"}}`}</Curl>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          POST /api/copilot — prompt → parse + full design
        </h3>
        <Curl>{`curl -X POST https://voltforge.example/api/copilot \\
  -H "content-type: application/json" \\
  -d '{"prompt": "Design a 5 kW bidirectional converter, 800 V bus to 48 V rack, forced air, 40 C"}'`}</Curl>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          POST /api/firmware — control firmware package
        </h3>
        <Curl>{`curl -X POST https://voltforge.example/api/firmware \\
  -H "content-type: application/json" \\
  -d '{"spec": { ...spec... }, "target": "STM32G474"}'
# target: STM32G474 (default) | TMS320F280049`}</Curl>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          POST /api/spice — SPICE netlist (text/plain)
        </h3>
        <Curl>{`curl -X POST https://voltforge.example/api/spice \\
  -H "content-type: application/json" \\
  -d '{"spec": { ...spec... }}' -o design.cir`}</Curl>
      </Section>
    </div>
  );
}
