"use client";

/**
 * /docs — static methodology page. What each engine models, the key
 * equations in plain text, assumptions, validity limits, and the API.
 * No data fetching — this page is documentation.
 */

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

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="panel">
      <h2 className="panel-title">{title}</h2>
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
        <span className="text-xs text-slate-500">
          what the engines model, and where the models stop
        </span>
      </div>

      <div className="panel border-[#f59e0b]/40">
        <p className="text-sm text-[#f59e0b]">
          Every number VoltForge produces is a design-exploration estimate built
          from datasheet parameters and standard analytical methods. Estimates
          rank candidates and size components well; they are not a substitute
          for bench measurement. Validate on hardware before production.
        </p>
      </div>

      <Section id="topology" title="Topology engine">
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

      <Section id="loss" title="Loss engine">
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

      <Section id="magnetics" title="Magnetics design">
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

      <Section id="thermal" title="Thermal engine">
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

      <Section id="control" title="Control design">
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

      <Section id="simulation" title="Switching simulation">
        <p>
          Piecewise-linear state-space integration of the switching cell
          (ideal switches + L/C/ESR) over ≥6 periods to steady state, yielding
          inductor current ripple, output voltage ripple, and waveform traces.
          Topologies without a PWL model fall back gracefully with a note.
        </p>
      </Section>

      <Section id="outputs" title="Schematic, BOM, layout guidance">
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

      <Section id="compliance" title="Compliance checks">
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

      <Section id="optimizer" title="Optimizer & Pareto exploration">
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

      <Section id="copilot" title="Copilot parser">
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
