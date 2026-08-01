# VoltForge MASTER PLAN

*Strategy lead · 2026-08-01 · Grounded in the August 2026 research packet. Every market claim carries its source inline. This document supersedes the strategic framing in GOAL.md where the two conflict (see §2.3).*

---

## 1. Thesis & one-line pitch

**One-liner:** VoltForge is the vendor-neutral design engine for the AI-datacenter power chain — spec in, physics-validated converter design out: topology, cross-vendor GaN/SiC selection, magnetics, thermal, schematic, BOM, firmware, and compliance in one loop.

**Thesis.** The AI-datacenter power transition (48V ORv3 today → 800VDC racks in 2027-28) forces a one-time redesign of every stage of the rack power chain, at exactly the moment power-electronics engineers are the scarcest they have ever been ($150-250k salaries, 4.2-month vacancy fills — https://spectrum.ieee.org/ai-data-centers-engineers-jobs). No tool today chains spec→topology→device→magnetics→thermal→schematic→BOM→firmware→compliance; a 2026 industry assessment confirms no credible end-to-end tool exists (https://www.protoflow.ai/blog/ai-pcb-design-2026-guide), and academic reviews call AI design synthesis "notably absent" (https://www.preprints.org/frontend/manuscript/8b15118f549fd1cb8cf1347f3b91fb2b/download_pub). The one structural advantage no incumbent can copy is neutrality: TI will never optimize across Infineon, Navitas, and EPC parts. We sell time-to-design-win against $50-200k NRE cycles (https://www.horizon-pss.com/news-events/cots-vs-custom-power-supplies-guide), not tool seats against a $0 price anchor.

**What we are not claiming:** full autonomy. The state of the art (PE-GPT, GenControl) automates narrow slices; LLMs demonstrably fail component selection (https://blog.jitx.com/jitx-corporate-blog/testing-generative-ai-for-circuit-board-design). VoltForge is deterministic physics cores + optimizer + curated data, with an LLM interface — a force multiplier for scarce senior engineers, never a replacement.

---

## 2. Market

### 2.1 Ground truth: the two-track power architecture

**Track 1 — shipping now (48/50V ORv3).** GB200 NVL72 racks draw ~120-132kW TDP (~192kW peak) from six 33kW power shelves on a 48V busbar (https://newsletter.semianalysis.com/p/gb200-hardware-architecture-and-component). Each shelf holds six 5.5kW PSUs at >97.5% peak efficiency (https://www.deltaww.com/en-US/products/orv3-server-power/ORV3-33kW-Power-System). GB300 runs 135-155kW. Vera Rubin VR200 NVL72 (2H26, reaffirmed by NVIDIA's CFO on the May 20, 2026 call) stretches this to 180-230kW with four 110kW shelves (six 18.3kW PSUs each) and a 5,000A+ liquid-cooled 50V busbar — the **last 54V generation** per Ming-Chi Kuo (https://newsletter.semianalysis.com/p/vera-rubin-extreme-co-design-an-evolution).

**Track 2 — 800VDC (2027-28).** NVIDIA's Kyber/Rubin Ultra (~600kW racks, NVL576, 2H2027) moves AC-DC conversion to facility level and makes rack power DC-DC only; claimed +5% end-to-end efficiency, 45% less copper (https://developer.nvidia.com/blog/nvidia-800-v-hvdc-architecture-will-power-the-next-generation-of-ai-factories/). Hyperscalers counter with OCP Mt. Diablo at ±400VDC (Meta/Microsoft/Google — https://techcommunity.microsoft.com/blog/azureinfrastructureblog/mt-diablo---disaggregated-power-fueling-the-next-wave-of-ai-platforms/4268799); the spec split is unresolved as of mid-2026 ("compromise rather than consensus"). TrendForce: mass 800V adoption begins only after Rubin Ultra in H2 2027, widespread deployment likely 2028. **The 800V-native design TAM is a 2027-28 story, not 2026.** Near-term paid design work is 54V ORv3 PSUs/shelves, ±400V products (Delta ships both in 2H26), and optional-800V retrofits.

**Device doctrine is settled:** SiC owns high-voltage front ends (PFC, 400-800V rectification, 3.3-10kV SSTs); GaN owns MHz-class stages (LLC, 48V→12V IBC, 800V→50/12/6V, VRMs) (https://newsletter.semianalysis.com/p/inside-the-800vdc-revolution-part). The efficiency bar: ORv3 requires 97.5% peak; 80 PLUS Ruby (Mar 2025) sets 96.5% @50% load. End-to-end grid-to-GPU improves only 82%→87.4% across the whole decade of architecture change — **winning designs are decided by tenths of a percent**, which means our physics must be EDA-grade, not rules-of-thumb.

**The two highest-value open design problems:**
1. **800V→50/12/6V rack DC-DC** — no settled topology (Infineon stacked-LLC 98.3%, EPC ISOP at ~1MHz, Navitas single-stage 800V→6V at 20kW/3,000A), MHz switching, matrix magnetics, liquid cooling (https://www.powerelectronicsnews.com/apec-2026-the-race-to-deliver-800-vdc-power-straight-to-the-gpu/). Genuinely open; arrives with Kyber.
2. **Vertical power delivery/VRM** — worst stage in the chain (~92%), 1,000-3,000A per GPU; Infineon calls it "the biggest opportunity in 30 years" (https://www.techinvestments.io/p/power-semis-in-the-ai-data-center) — but it is silicon-level co-design dominated by MPS/Infineon/Vicor/Empower. **We deprioritize VRM synthesis; we model it as a load.**

### 2.2 TAM/SAM with arithmetic

**Seat-based (bottom-up).** The ~15 named buyers (Delta, LiteOn, Flex, Megmeet, Chicony, AcBel, Vertiv, Vicor, Murata, hyperscaler teams, etc.) employ ~8,000-13,000 R&D staff plausibly touching power; true converter designers are ~3,000-6,000; floating licensing (the norm — PLECS concurrent, Frenetic floating, Altair Units) compresses paid seats to **~1,000-3,000**. IEEE PELS has only 13,000+ members worldwide including academics and students (https://www.ieee-pels.org/membership/); ~90 US job postings mention PLECS. Seat math:

- Realistic: 2,000 seats × $6k/yr = **$12M ARR**
- Heroic: 10,000 seats × $6k/yr = **$60M ARR ceiling** on pure per-seat SaaS

**Value-based (per-design).** Custom PSU NRE runs $50-200k over 3-6 months (https://tps-elektronik.com/en/battery-test-system-and-custom-power-supply-design/). The 800V transition forces every ODM/module maker to redesign PSUs, shelves, sidecar DC-DC, and aux stages: assume 20 target accounts × 5-15 new converter programs/yr = 100-300 designs/yr addressable; at $10-25k per design run (10-25% of NRE, per Quilter/DSO.ai per-project precedent — https://newsletter.semianalysis.com/p/eda-market-primer) = **$1.5-7.5M/yr near-term, scaling with the design wave**.

**Vendor-sponsorship (the Transim model).** Silicon vendors pay third parties to host design tools that are free to engineers (https://www.transim.com/About); 12+ vendors already contribute models to neutral PLECS (https://www.plexim.com/download/thermal_models). 10-15 challenger vendors (EPC, Navitas, PI, CGD, ROHM, onsemi) × $100-500k/yr sponsored placement/characterization = **$1-7M/yr**.

**SAM ≈ $15-75M ARR by 2029-30** across the three layers, expandable into EV OBC, solar, and aerospace verticals later. Context: the AI-server PSU market itself is ~$4B (2025) at ~$520 ASP and 31% GM (https://www.intelmarketresearch.com/ai-server-power-supply-market-24984); power-semi content is ~$100k/MW rack, ~$3.1B/yr (https://www.techinvestments.io/p/power-semis-in-the-ai-data-center). We are a picks-vendor to that stream, not a share of it. **This is a $30-75M ARR company on the base plan — venture-scale outcomes require the per-design and sponsorship layers to work, or vertical expansion. Plan accordingly.**

### 2.3 Corrections to prior assumptions

GOAL.md's framing is wrong or unsupported in six places:

1. **Pricing ($500-5,000/engineer/mo).** The $500-1,000/mo band is defensible (PLECS lease ~CHF3,500/yr, Altium $2-7.5k/yr, Xpedition $2,999/yr). **$5,000/mo has no documented per-seat comparable anywhere in power-electronics software** — no public evidence anyone pays >$10k/yr/seat for power-specific tools (SIMPLIS is quote-only with zero public price records). At Megmeet, annualized R&D budget per engineer is ~$56k all-in — a $60k seat exceeds the cost of the engineer. High ACV must be account-level and value-based (per-design, ELA), never per-seat.
2. **"Bloomberg Terminal" pillar.** Model access is not a moat — every vendor gives away SPICE/PLECS models free. The defensible asset is *cleaned, independently characterized, cross-vendor-comparable* data (dynamic RDS(on), normalized FIT/reliability, magnetics loss), which nobody has because JEDEC JC-70 documents are guidelines, not mandatory quals (https://www.jedec.org/committees/jc-70), and distributor parametric data is demonstrably incomplete.
3. **800V timing.** The repo's flagship example ("800V→48V") targets a design wave that ramps 2027-28. Near-term revenue comes from 54V ORv3 (5.5-18.3kW PSUs, 33-110kW shelves) and ±400V. Both generations must be first-class.
4. **Compliance engine scope.** IEC 62368-1 creepage/derating is fine, but there is no settled DC rulebook for 800VDC — NEC support expected ~2029, maturity 2032-35, four competing grounding schemes (https://newsletter.semianalysis.com/p/inside-the-800vdc-revolution-part). Position compliance output as pre-compliance risk reduction, never "will pass."
5. **Target-customer list.** "OEMs building AI-datacenter power supplies" is dominated by ~15 firms; Delta alone holds ~50% of merchant PSUs. GOAL.md's flat customer list must become the ranked ICP in §6.
6. **Fab analytics (pillar 4).** No demand evidence in research; the fab side is in overcapacity distress (Wolfspeed Ch11, SiC utilization ~50-70% through 2027-28 — https://www.semiconductor-today.com/news_items/2025/dec/yole-181225.shtml). Parked — see §7.

---

## 3. Competitive landscape

| Tool / company | What it does | Price anchor | Whitespace vs VoltForge |
|---|---|---|---|
| TI WEBENCH Power Designer (https://webench.ti.com/power-designer/) | Spec→IC→sim→BOM→layout export, TI parts only | Free | No cross-vendor, no magnetics construction, no firmware; documented 7% efficiency miss vs real PCB |
| TI Power Stage Designer (https://www.ti.com/tool/POWERSTAGE-DESIGNER) | 21-topology calculator, loop/FET-loss tools | Free | Calculations only; no schematic/BOM/firmware |
| Infineon Solution Finder / IPOSIM (https://solutionfinder.infineon.com/) | Product finder + PLECS-based loss/thermal | Free | Infineon-only; device evaluation, not design |
| MPS DC/DC Designer (https://www.monolithicpower.com/en/design-tools/design-tools/dc-dc-designer-online.html) | Circuit around chosen MPS regulator | Free | MPS-only |
| onsemi Elite Power Simulator (https://www.onsemi.com/design/tools-software/elite-power-simulator) | PLECS sim + self-service model generator | Free | onsemi-only; evaluation not synthesis |
| Wolfspeed SpeedFit (https://www.wolfspeed.com/tools-and-support/power/speedfit/) | SiC device/topology comparison, thermal | Free | No schematic/magnetics/BOM/firmware |
| EPC GaN Power Bench (https://epc-co.com/epc/design-support/gan-power-bench) | Calculators, models, cross-refs | Free | Support tools, not design |
| Vicor PowerBench / Flex Power Designer (https://www.vicorpower.com/Vicor-tools/power-system-designer) | Power-chain block diagrams w/ loss analysis | Free | Own-modules only |
| ADI Power Studio (Oct 2025) (https://www.analog.com/en/newsroom/press-releases/2025/10-14-2025-adi-launches-adi-power-studio-new-web-based-tools.html) | Power-tree planner + IC designer, LTspice/SIMPLIS export | Free | ADI-only; explicitly "first phase" of connected workflow — incumbents are moving |
| PI Expert (https://power.com/design-support/pi-expert) | Spec→complete auto-generated design | Free | PI silicon only; **proof vendors will build auto-design when it sells chips** |
| ROHM Solution Simulator / ST eDesignSuite+eDSim (https://www.rohm.com/solution-simulator) | Full-circuit verification, electro-thermal sim | Free | Single-vendor; verification only |
| PowerEsim (https://www.poweresim.com/intro.html) | 100+ topologies, turn-by-turn transformer, thermal/MTBF | Free (sponsor-funded) | Dated; no GaN/SiC optimization, firmware, or datacenter focus |
| Navitas Design Center + vendor reference designs (https://www.semiconductor-today.com/news_items/2024/jul/navitas-260724.shtml) | Complete tested 3.2-12kW PSU designs: schematic, BOM, layout, firmware | Free (FAE-delivered) | **The real incumbent.** Locked to sponsor silicon; static; goes stale as 800V churns topologies |
| PLECS (Plexim) (https://www.plexim.com/store/commercial) | System-level PE simulation, vendor thermal models | CHF 7k perpetual / ~3.5k/yr lease | Zero synthesis; our verification round-trip target |
| SIMPLIS/SIMetrix (https://www.simplistechnologies.com/product/simplis) | 10-50x-faster switching sim; VRM/POL standard | Quote-only per-seat | Verification only; our export target |
| PSIM (Altair→Siemens) (https://altair.com/newsroom/news-releases/Altair-Expands-Electronic-System-Design-Technology-with-Acquisition-of-Powersim) | Converter/drive simulation | Altair Units pool | No synthesis; big-EDA rollup precedent |
| LTspice / MATLAB-Simulink | SPICE sim / modeling | Free / $940/yr | Building blocks, not design tools |
| Ansys / Cadence Celsius/Sigrity (https://www.thepricer.org/ansys-cost/) | Multiphysics/PI analysis | $10-50k licenses; avg account $317k | Enterprise verification; no power-stage synthesis |
| Frenetic (https://www.frenetic.ai/pricing) | AI magnetics + Converter Assistant (topology, schematic, LTspice/PLECS/KiCad) | Quote-only; free Basic; PRO "coming soon" | Closest competitor, but: €1.5-3M revenue, declining (-4.6% 2024), loss-making, pivoted to magnetics manufacturing; converter AI is ~1yr old, free, no firmware/compliance/datacenter focus |
| GT-PowerForge (https://www.gtisoft.com/gt-powerforge-2/) | Auto-sweeps hundreds of topology/device candidates | Enterprise quote | Architecture exploration only; no schematic/BOM/firmware; aero/naval/EV focus |
| Monolith AI (https://www.monolithai.com/) | ML on engineering test data | Enterprise | Testing acceleration, not design |
| Circuit Mind / CELUS / Quilter / JITX / Flux.ai (https://www.circuitmind.io/) | AI schematic/BOM/layout for general electronics | $15-40M raised; Flux $20-158/mo; Quilter per-pin | No power depth: no control loops, magnetics, or EMI |
| PE-GPT / GenControl (academic) (https://arxiv.org/abs/2411.14214) | LLM+physics for modulation/control design | n/a | Narrow slices; validates difficulty of full synthesis |
| OpenMagnetics (https://openmagnetics.com/) | Open-source magnetics toolbox, 40+ models | Free | Magnetics only; a floor under Frenetic's wedge and ours |

**Honest verdict.** End-to-end spec-to-design does not exist — confirmed by independent 2026 assessment and academic review. But the whitespace is only half-vacant for good reasons: (a) the actual incumbent in our beachhead is *free, hardware-validated reference designs plus FAE armies*; (b) firmware and EMI automation are unoccupied partly because they are unsolved; (c) willingness-to-pay is anchored at $0-8k/yr. Our window: incumbents are vendor-locked and static while the 800V transition resets their design libraries; the closest funded competitor (Frenetic) is financially subscale; big-EDA/vendor AI responses (ADI Power Studio phases, CELUS-in-Xpedition) give us an estimated **2-3 year head start, not more**.

---

## 4. Differentiation & moat

**Why the stack compounds.** Each layer feeds the next: the physics engines (loss, magnetics, thermal, control) make the optimizer's Pareto sweeps trustworthy; the optimizer generates demand for breadth in the component DB; the component DB's gaps tell us exactly which parts to characterize next; every generated design that round-trips through ngspice/SIMPLIS/PLECS and (later) hardware produces measured-vs-predicted deltas that recalibrate the physics. The copilot is the interface, not the product. Frenetic has magnetics without the system; GT-PowerForge has sweeps without outputs; vendors have outputs without neutrality. Only the closed loop compounds.

**Data/network effects (the vendor flywheel).** Precedent is strong: 12+ manufacturers contribute ready-to-use models to neutral PLECS; vendors pay Transim to host design centers; Würth/Coilcraft embed in WEBENCH. Challenger vendors hungry for design-ins (EPC, Navitas, PI, CGD, ROHM, onsemi, post-Ch11 Wolfspeed) are the likely first contributors; TI/Infineon run closed ecosystems and will join last or never. The flywheel: more validated vendor models → better optimizer results → more designs generated → more design-win attribution data for vendors → vendors contribute/pay for placement. Crucially, vendor models are behavioral, sometimes encrypted, with documented convergence problems and missing physics (dynamic RDS(on) — https://www.mdpi.com/1996-1073/16/22/7643); **our independent characterization/validation layer is simultaneously the moat, the liability shield, and the reason vendors can't just bypass us**.

**What is defensible:**
- Cross-vendor neutrality (structurally impossible for any silicon vendor)
- The cleaned, characterized, cross-comparable device + magnetics + reliability dataset (JEDEC JC-70 leaves FIT data unstandardized; nobody has a machine-readable FIT database)
- Accumulated measured-vs-predicted validation corpus tied to real builds
- Firmware co-design (no free incumbent generates control firmware; digital-control skills are a documented bottleneck) and, if it demonstrably works, EMI pre-compliance — the two least-automated stages in every tool surveyed

**What is NOT defensible:**
- Algorithms and physics models (replicable; published literature)
- Model aggregation (vendors give models away)
- LLM interface (commodity)
- Topology libraries (public knowledge)
- First-mover position absent the data corpus — a Siemens/Altair or Infineon rollup can assemble our feature list by acquisition (Powersim→Altair→Siemens precedent)

---

## 5. Product roadmap (v1/v2/v3 on M1-M5)

**v1 — Credible engine (M1-M3, loops 1-10).** Ship the engineering core, but re-prioritized by research:

- **Target conversion stages first:** (1) LLC DC-DC + totem-pole PFC for 3-18.3kW ORv3-class PSUs — the volume design activity shipping now, with published vendor benchmarks to validate against (TI PMP23126 97.74%, Infineon 8kW, Navitas Ruby-class); (2) 48/54V→12V IBC; (3) 800V→50/12/6V exploration paths (stacked LLC, ISOP) to be demo-ready for the 2027 wave. Deprioritize: flyback/forward polish, VRM synthesis.
- **Trust loop is a v1 feature, not v2:** every generated design must export a runnable netlist and round-trip through **ngspice in CI** for self-validation, plus **LTspice/SIMPLIS/PLECS export** so engineers verify in tools they already trust — the single most important adoption lesson (WEBENCH's 7% miss; regulated teams treat AI output as "rough starting point" — https://arxiv.org/pdf/2507.09220).
- **Integration surface priorities, in order:** (1) KiCad s-expression schematic export (table stakes; Wolfspeed/Frenetic already ship KiCad files); (2) live Octopart/distributor pricing + availability in the BOM engine, with region-aware second-sourcing (Innoscience tariff/export-control exposure makes this genuinely valuable); (3) SPICE/LTspice netlist export; (4) firmware bundles for STM32G4/C2000 as planned.
- **Calibration KPI:** reproduce ≥5 published vendor reference designs' efficiency curves within ±0.5% before claiming anything publicly.

**v2 — Sell-ready + data moat (M4, loops ~8-16).**
- Device DB to ≥80 parts with normalized reliability (FIT/ppb) fields and explicit "vendor-claimed vs independently characterized" provenance flags; EOL/acquisition tracking as a first-class feature (GaN Systems, Transphorm precedents).
- Multi-objective optimizer honoring density (W/in³) and cost ceilings — the metrics vendors actually compete on (Navitas 2,600W/in³, Infineon 100W/in³ roadmap).
- Export pack: printable design report, compliance documentation pack (the artifact engineering managers pay for), firmware bundle, KiCad + SPICE.
- Claude-API copilot mode; account/tiering for the pricing structure in §6.
- Vendor partnership program v1: 2-3 challenger vendors contributing validated models with co-marketing.

**v3 — 800V-native suite (M5, redefined).** Replace fab analytics (parked, §7) with:
- 800V→50/12/6V design paths hardened (ISOP, stacked-LLC, matrix-transformer magnetics), ±400V Mt. Diablo variants, four grounding-scheme awareness.
- Firmware-HIL evidence pack (auto-generated tests proving loop stability) — the gate for anyone deploying generated control code on multi-kW hardware.
- EMI pre-compliance estimator (filter design + conducted-emissions risk scoring, never "guaranteed pass") — 50% first-pass EMC failure rates at $20k/test make this the highest-dollar pain (https://ge-emc.com/common-emc-test-failure-reasons-explained/).
- Rack-level power-tree modeling (shelf → busbar → blade) to speak the hyperscalers' language (GB300 power smoothing shows power+firmware are now co-designed at rack scale).

---

## 6. Go-to-market

### 6.1 ICP, ranked

1. **Second-tier PSU makers chasing the 800V wave** — Megmeet, Chicony, AcBel, Great Wall, Honor Electronic. They lack Delta-scale internal tooling, are ramping 5.5kW+ AI PSUs, and must catch a moving spec. Highest urgency, lowest internal-tool resistance.
2. **Module makers & power design houses** — Vicor ($600M+ 2026 revenue on the transition), Flex Power Modules (3 design sites — small teams, big programs), Murata; plus SST/sidecar challengers (DG Matrix, Heron, Novos) building brand-new products with no legacy library.
3. **Hyperscaler power teams as influencers, not revenue** — Google/Meta/NVIDIA teams number in the tens but set specs; land 1-2 as design partners for credibility and requirements, price per-project.
4. **Challenger silicon vendors as sponsors** — EPC, Navitas, PI, CGD, onsemi, ROHM: not seat buyers but flywheel funders (Transim precedent).
5. **Defer:** Delta/LiteOn (price pressure, internal tooling, ~$56k/engineer budget arithmetic) until reference proof exists; automotive OBC tier-1s (BorgWarner, Valeo, Vitesco) until v3+ given AEC/ASIL cycles.

### 6.2 Pricing & packaging

Benchmarks: PLECS ~CHF3.5-7k/yr; Altium $2-7.5k/yr; Xpedition $2,999/yr; Ansys account avg $317k (https://www.vendr.com/buyer-guides/ansys); Copilot $10-39/mo moving to usage credits; Flux metered ACUs; Quilter per-pin; DSO.ai ≈20% renewal uplift + per-project (https://newsletter.semianalysis.com/p/eda-market-primer). Usage-based is the direction of travel everywhere adjacent.

- **Free individual tier** (WEBENCH/SnapEDA/Frenetic-Basic pattern): limited designs/month, public parts DB. Seeds engineers bottom-up; answers "why not free?" by making the common case free.
- **Team: $500-1,000/mo floating seat** — inside the incumbent envelope ($8-20k/yr full stack), floating because that's the market norm.
- **Per-design runs: $10-25k** metered against $50-200k NRE — how hyperscaler projects and big programs pay.
- **Enterprise ELA / on-prem** for ODMs with IP-security demands; account-level 5-6-figure deals competing with existing Ansys/MathWorks lines (Vertiv ER&D $442M and growing 20%/yr — budget exists at account level).
- **Published transparent pricing** — rare in this market (SIMPLIS/Frenetic hide theirs); it differentiates and shortens cycles.
- **Do not sell $5k/mo seats.** No comparable exists; it maximizes rejection.

### 6.3 Land-and-expand motion

Free tier → 1-3-month pilot on one real design (a 5.5kW ORv3 PSU or 110kW-shelf DC-DC) with success criteria written down (predicted-vs-simulated within tolerance, hours saved) → floating team licenses → annual ELA. Expect 3-12 months to first PO at ODMs; run a Keysight-style startup/university free program to seed the next generation. The community converges annually at APEC — one venue, powerful reputation effects, and one public design failure travels fast. Sell to engineering managers/VPs on eliminated prototype spins ($20k EMC retests, 3-6-month slips) and unfillable $150-250k headcount; land with engineers via the tasks they hate: magnetics iteration, part search (half of engineers lose 1hr/day to it), loss/thermal bookkeeping, compliance documentation — never by challenging their design authority.

### 6.4 Vendor-partnership flywheel

Year 1: ingest public models from 3-5 challenger vendors, publish accuracy notes (measured-vs-claimed) — this earns trust with engineers *and* pressure-tests vendors. Year 2: paid tiers — sponsored placement in optimizer results (always labeled; neutrality is the product), co-marketed validated reference designs, characterization-as-a-service. The design-win attribution data we accumulate (which parts win which sockets at which specs) becomes the report vendors cannot get anywhere else.

---

## 7. Phase-2 fab analytics: verdict

**Park it.** Zero demand evidence in the research packet; the buyer set is financially distressed (Wolfspeed Ch11 with $4.6B debt cut; SiC overcapacity with ~50-70% utilization through 2027-28; ROHM's first loss in 12 years; power GaN devices only $355M in 2024 — https://www.semiconductor-today.com/news_items/2025/oct/yole-291025.shtml). It shares no code, no buyer, and no sales motion with the design platform, and M5 engineering effort has strictly higher-value alternatives (§5 v3).

**Re-open triggers (all three):** (1) core platform ≥$3M ARR with the design flywheel producing device-reliability data fabs want; (2) GaN capex cycle turns (Yole's 42% CAGR to ~$3B/2030 materializing on schedule, utilization recovering); (3) an anchor fab/IDM offers a paid pilot ≥$250k unprompted. Until then, the only fab-adjacent work we do is normalizing device reliability data — which serves the design product anyway.

---

## 8. Risks & kill criteria (top 5)

1. **Willingness-to-pay collapse.** Free vendor tools + reference designs + Frenetic's free tier absorb paid use cases; Frenetic's decade-to-€3M-declining-revenue trajectory is the base rate. *Mitigation:* three revenue layers (§6.2); sell NRE substitution, not tools; free tier absorbs the $0 anchor. *Kill criterion:* after 10 qualified pilots, <2 convert to ≥$10k/yr paid within 6 months → pivot to vendor-sponsored/per-design-only model or wind down.
2. **Trust failure / public design flop.** One VoltForge-derived board failing EMC or burning in the field spreads through the APEC-centered community permanently; LLM "connectivity hallucination" is documented. *Mitigation:* deterministic physics core (no LLM in the design path), ngspice CI round-trip, SIMPLIS/PLECS/LTspice export, published measured-vs-predicted, explicit "validate on hardware" framing. *Kill criterion:* if we cannot reproduce ≥5 published reference-design efficiency curves within ±0.5% by end of v1, do not launch commercially — fix physics first.
3. **800V timing slip.** Revenue tied to Kyber 2H27; TrendForce already trimmed Rubin's 2026 share 29%→22% on HBM4/power issues. *Mitigation:* 54V ORv3 + ±400V are v1 first-class targets; watch NVIDIA earnings (next: Aug 26, 2026) and HBM4 supply as leading indicators. *Kill criterion for the 800V bet only:* if Rubin Ultra slips past mid-2028, freeze 800V-specific work and double down on ORv3/±400V.
4. **Buyer concentration + Asian ODM price compression.** ~15 firms control volume; Delta ~50% merchant share; Megmeet's ~$56k/engineer all-in budget caps seat pricing. *Mitigation:* ranked ICP starts with second-tier makers; account-level value pricing; sponsorship revenue diversifies away from seats. *Kill criterion:* if after 18 months >70% of revenue depends on ≤2 logos, treat as acqui-position signal and run a strategic process.
5. **Incumbent/rollup response.** ADI Power Studio is explicitly phase one of a connected workflow; CELUS is inside Siemens Xpedition; PI Expert proves vendors build auto-design when it sells silicon; Powersim→Altair→Siemens shows rollup speed. Window: ~2-3 years. *Mitigation:* speed on the data corpus (the only non-replicable asset), vendor-neutrality positioning incumbents cannot copy, APEC-visible validation publications. *Kill criterion:* if a free vendor or big-EDA tool ships cross-vendor optimization with credible magnetics before we have 10 paying accounts, the independent path is dead — sell the data asset and team.

---

## 9. KPIs for the next 10 loop iterations

| Loop | KPI (cumulative, verifiable in-repo) |
|---|---|
| 1 | M1 loss + component DB: ≥40 real parts with datasheet provenance fields; loss engine unit tests green |
| 2 | Topology engine: LLC + totem-pole PFC + sync-buck operating points; scoring tested |
| 3 | Magnetics engine (area-product, iGSE, Dowell) + thermal iteration converging on ≥3 test designs |
| 4 | Control engine + firmware codegen: STM32G4/C2000 C compiles; coeffs match small-signal model in tests |
| 5 | **Calibration gate:** reproduce ≥3 published reference designs (TI PMP23126 97.74%, Infineon 3kW, Navitas Ruby-class) within ±0.5% efficiency; publish the comparison in /docs |
| 6 | Schematic/netlist + **ngspice round-trip in CI**; KiCad s-expression export of ≥1 full design |
| 7 | BOM engine with Octopart pricing + alternates + region flags; optimizer Pareto sweep E2E |
| 8 | M2/M3: API + workbench UI + component terminal live; E2E test ("5kW bidirectional 800V→48V" AND "5.5kW ORv3 PSU") green; deployed on Vercel |
| 9 | v2 start: DB ≥60 parts with normalized FIT fields; LTspice export; export pack (report PDF + firmware bundle) |
| 10 | Calibration set ≥5 designs within ±0.5%; free-tier gating stub; outreach artifact: demo video + 10-target pilot list from §6.1 |

Standing gates every loop: `npm run typecheck && npm test && npm run build` green; iteration log appended; no public accuracy claims ahead of the calibration set.

---

## 10. Appendix: full source list

**Architecture & market:** https://developer.nvidia.com/blog/nvidia-800-v-hvdc-architecture-will-power-the-next-generation-of-ai-factories/ · https://newsletter.semianalysis.com/p/inside-the-800vdc-revolution-part · https://newsletter.semianalysis.com/p/vera-rubin-extreme-co-design-an-evolution · https://newsletter.semianalysis.com/p/gb200-hardware-architecture-and-component · https://techcommunity.microsoft.com/blog/azureinfrastructureblog/mt-diablo---disaggregated-power-fueling-the-next-wave-of-ai-platforms/4268799 · https://www.deltaww.com/en-US/products/orv3-server-power/ORV3-33kW-Power-System · https://www.advancedenergy.com/en-us/products/ac-dc-power-supply-units/power-shelves/orv3-high-power-rack-(hpr)/ · https://www.techpowerup.com/337342/80-plus-ruby-sets-96-5-peak-efficiency-benchmark-for-server-power-supplies · https://www.powerelectronicsnews.com/apec-2026-the-race-to-deliver-800-vdc-power-straight-to-the-gpu/ · https://www.electronicsweekly.com/news/products/power-supplies/800v-data-centres-navitas-down-converts-35kv-2025-10/ · https://www.techinvestments.io/p/power-semis-in-the-ai-data-center · https://www.empowersemi.com/empower-semiconductor-highlights-its-breakthrough-ai-vertical-power-delivery-platform-at-apec-2025/ · https://www.prnewswire.com/news-releases/from-vision-to-readiness-vertiv-collaborates-with-nvidia-to-advance-800-vdc-platform-designs-to-power-the-next-generation-of-ai-factories-302582190.html · https://blog.se.com/datacenter/2025/10/16/the-1-mw-ai-it-rack-is-coming-and-it-needs-800-vdc-power/ · https://developer.nvidia.com/blog/how-new-gb300-nvl72-features-provide-steady-power-for-ai/ · https://www.glennklockwood.com/garden/kyber · https://introl.com/blog/nvidia-vera-rubin-gpu-600kw-racks-2027 · https://www.sunbirddcim.com/blog/how-much-power-does-nvidia-gb300-nvl72-need · https://x.com/mingchikuo/status/2008439734536986852 · https://www.intelmarketresearch.com/ai-server-power-supply-market-24984 · https://convergedigest.com/the-megawatt-shift-nvidias-800-vdc-strategy/ · https://spectrum.ieee.org/800-vdc-for-data-centers · https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2027 · https://www.techpowerup.com/346786/nvidia-ships-first-vera-rubin-vr200-samples-to-customers

**Competitors & tools:** https://webench.ti.com/power-designer/ · https://www.ti.com/tool/POWERSTAGE-DESIGNER · https://www.infineon.com/design-resources/simulation-modeling/solution-finder · https://www.infineon.com/design-resources/simulation-modeling/iposim-infineon-power-simulation-tool-plecs · https://www.monolithicpower.com/en/design-tools/design-tools/dc-dc-designer-online.html · https://www.onsemi.com/design/tools-software/elite-power-simulator · https://www.wolfspeed.com/tools-and-support/power/speedfit/ · https://epc-co.com/epc/design-support/gan-power-bench · https://www.vicorpower.com/Vicor-tools/power-system-designer · https://flex.com/products/power-modules/flex-power-designer · https://www.analog.com/en/newsroom/press-releases/2025/10-14-2025-adi-launches-adi-power-studio-new-web-based-tools.html · https://power.com/design-support/pi-expert · https://www.rohm.com/solution-simulator · https://www.st.com/content/st_com/en/campaigns/edesignsuite-stpower-studio-simulation-software.html · https://www.poweresim.com/intro.html · https://www.plexim.com/store/commercial · https://www.simplistechnologies.com/product/simplis · https://altair.com/newsroom/news-releases/Altair-Expands-Electronic-System-Design-Technology-with-Acquisition-of-Powersim · https://www.thepricer.org/ansys-cost/ · https://www.cadence.com/en_US/home/tools/system-analysis.html · https://www.frenetic.ai/pricing · https://www.frenetic.ai/ai-converter-assistance · https://www.gtisoft.com/gt-powerforge-2/ · https://www.monolithai.com/ · https://www.circuitmind.io/ · https://www.embedded.com/celus-unveils-next-generation-ai-powered-design-assistant-to-revolutionize-electronics-development/ · https://www.businesswire.com/news/home/20251007165399/en/ · https://www.flux.ai/pricing · https://www.quilter.ai/blog/the-2026-guide-to-autonomous-pcb-design-quilter-vs-deeppcb-vs-flux-ai · https://openmagnetics.com/ · https://www.protoflow.ai/blog/ai-pcb-design-2026-guide · https://www.preprints.org/frontend/manuscript/8b15118f549fd1cb8cf1347f3b91fb2b/download_pub · https://arxiv.org/abs/2411.14214 · https://arxiv.org/pdf/2506.12554 · https://drmolina.substack.com/p/128-ai-tools-in-power-electronic

**Frenetic deep-dive:** https://startupsreal.com/spanish-startup-frenetic-raises-12m-series-a-to-rapidly-reduce-the-time-required-to-produce-magnetics/ · https://tracxn.com/d/companies/freneticai/__RWlNbHYMZIi-aKzjoSMnIqPXmKE8vbfSfXM6J-HI9OY · https://www.einforma.com/informacion-empresa/sp-control-technologies · https://ranking-empresas.eleconomista.es/FRENETIC-ELECTRONICS.html · https://www.powerelectronicsnews.com/frenetics-ai-powered-platform-cuts-magnetic-design-process-to-minutes/ · https://drmolina.substack.com/p/16-design-a-65-w-active-clamp-flyback · https://www.glassdoor.com/Reviews/Frenetic-Reviews-E5988687.htm · https://medium.com/the-neue-industry/ai-for-power-electronics-why-we-invested-in-frenetic-692deb414759

**Vendors & devices:** https://www.sec.gov/Archives/edgar/data/1821769/000162828025027705/ex9912025-05x21prrenvidiac.htm · https://navitassemi.com/navitas-debuts-revolutionary-800-v-6-v-power-delivery-board-at-nvidia-gtc-2026/ · https://www.semiconductor-today.com/news_items/2024/jul/navitas-260724.shtml · https://www.semiconductor-today.com/news_items/2025/may/navitas-210525.shtml · https://www.sahmcapital.com/news/content/navitas-q1-fy26-net-loss-widens-to-3379-million-revenue-falls-to-86-million-2026-05-05 · https://elevenflo.com/blog/wolfspeed-bankruptcy-46b-debt-restructuring · https://www.wolfspeed.com/company/news-events/news/wolfspeed-successfully-completes-financial-restructuring-emerges-as-financially-stronger-company-well-positioned-in-silicon-carbide-market/ · https://www.renesas.com/en/about/newsroom/renesas-completes-acquisition-transphorm · https://www.infineon.com/press-release/2023/infxx202310-014 · https://www.onsemi.com/company/news-media/press-announcements/en/onsemi-collaborates-with-nvidia-to-accelerate-transition-to-800-vdc-power-solutions-for-next-generation-ai-data-centers · https://investors.power.com/news/news-details/2025/Power-Integrations-Details-1250-V-and-1700-V-PowiGaN-Technology-for-Next-Generation-800-VDC-AI-Data-Centers/default.aspx · https://www.semiconductor-today.com/news_items/2026/jun/epc-020626.shtml · https://www.ti.com/tool/PMP23126 · https://www.ti.com/tool/PMP23338 · https://www.plexim.com/download/thermal_models · https://www.transim.com/About · https://www.jedec.org/committees/jc-70 · https://epc-co.com/epc/design-support/gan-device-reliability/reliabilityreportphase12 · https://www.ti.com/lit/snoaa68 · https://www.semiconductor-today.com/news_items/2025/oct/yole-291025.shtml · https://www.semiconductor-today.com/news_items/2025/dec/yole-181225.shtml · https://www.mdpi.com/1996-1073/16/22/7643 · https://newsroom.st.com/media-center/press-item.html/t4766.html · https://www.electronicdesign.com/technologies/power/power-supply/article/55289191/scaling-ai-data-center-power-delivery-with-si-sic-and-gan · https://www.globenewswire.com/news-release/2025/03/17/3043692/0/en/Navitas-Exceeds-New-80-PLUS-Ruby-Certification-for-Highest-Level-of-Efficiency-in-AI-Data-Center-Power-Supplies.html

**Workflow, pain & pricing:** https://tps-elektronik.com/en/battery-test-system-and-custom-power-supply-design/ · https://www.spellmanhv.com/en/Technical-Resources/Articles/A-Product-Development-Process-For-High-Voltage-Power-Supplies · https://www.powersystemsdesign.com/articles/power-supply-development-diary-part-i/18/5460 · https://ge-emc.com/common-emc-test-failure-reasons-explained/ · https://www.ti.com/lit/ml/slup123/slup123.pdf · https://e2e.ti.com/support/power-management-group/power-management/f/power-management-forum/1196483/lm25116-webench-proposed-design-does-not-align-with-the-real-pcb-design · https://blog.jitx.com/jitx-corporate-blog/testing-generative-ai-for-circuit-board-design · https://arxiv.org/pdf/2507.09220 · https://www.z2data.com/insights/how-much-time-component-engineers-losing-searching-for-data/ · https://spectrum.ieee.org/ai-data-centers-engineers-jobs · https://introl.com/blog/data-center-workforce-shortage-340000-unfilled-positions-2026 · https://www.xppower.com/resources/blog/digital-control-power-designs · https://www.semiconductor-today.com/news_items/2024/jan/jedec-300124.shtml · https://pcbsync.com/altium-designer-price/ · https://www.vendr.com/marketplace/altium · https://www.vendr.com/buyer-guides/ansys · https://newsletter.semianalysis.com/p/eda-market-primer · https://www.cloudzero.com/blog/github-copilot-cost/ · https://www.mathworks.com/pricing-licensing.html · https://www.quilter.ai/blog/the-true-cost-of-enterprise-pcb-tools-in-2025-a-tco-analysis-of-altium-cadence-and-ai-powered-platforms · https://www.horizon-pss.com/news-events/cots-vs-custom-power-supplies-guide · https://www.ziprecruiter.com/Salaries/Power-Electronics-Engineer-Salary · https://www.keysight.com/us/en/cmp/promotions/keysight-eda-startup-program.html · https://www.ieee-pels.org/membership/ · https://www.deltaww.com/en-US/company/innovation · https://www.megmeetusa.com/capabilities/ · https://s205.q4cdn.com/554782763/files/doc_presentations/2026/05/20/Vertiv-2026-Investor-Conference_May-20-2026.pdf · https://flexpowermodules.com/who-we-are · https://www.simplyhired.com/search?q=plecs · https://octopart.com/ · https://www.snapeda.com/questions/question/does-it-cost-29-per-part-or-is-it-a-subscription-f/ · https://www.edn.com/data-center-solutions-take-center-stage-at-apec-2025/ · https://apec-conf.org/
