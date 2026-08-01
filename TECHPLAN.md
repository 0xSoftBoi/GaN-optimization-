# TECHPLAN — Physics Upgrade Plan

The concrete plan to bring every model in the platform up to
[docs/PHYSICS.md](docs/PHYSICS.md) ("Engineering Foundations"). Section codes
(§D3, §M2, §T5, ...) reference PHYSICS.md; iteration tags (it2–it8) are /loop
passes. Verify gate for every iteration:
`npm run typecheck && npm test && npm run build` green, plus the physics
invariants listed per item. Branch: `claude/ai-power-delivery-platform-ghcmyl`.

---

## 0. v1 audit (what exists, what's wrong)

Read: `src/lib/MODULES.md`, `src/lib/types.ts` (frozen), module sources.

| Module | v1 state | Headline fidelity gaps |
|---|---|---|
| `loss/device.ts` | linear Rds tempco; `t = 0.5*Qg/1.5A`; `0.5*V*I*t` overlap; `n*Eoss` capacitive term with fixed V^1.6; fixed Vsd (2.0/1.5/0.9 V); binary `op.zvs`; `deadTimeFrac` | tempco under-predicts hot (§D1); switch times err 3–5x (§D3); capacitive loss undercounts ~2x (§D5); no dynamic Rds(on), Coss hysteresis, Coss-limited Eoff, partial ZVS, gate-swing definition (§D2,D6,D7,D9,D10) |
| `loss/passives.ts` | sinusoidal Steinmetz kernel; exact Dowell exists (`dowellFr`) but unused by magnetics; `Irms^2*ESR` single-point cap loss | no ESR(f,T), no spectrum, no bias derating (§P1–P3) |
| `magnetics/designMagnetic.ts` | AP preselect; `IGSE_TRI = 1.15` (wrong direction, §M2); xi^4 Dowell expansion clamped at 25 (§M5); `acFrac^2` blend; `Rth = 36/sqrt(Ve)` (40–60% optimistic, §M8); no DC-bias factor (§M3); no fringing (§M4); fixed 200 kW/m^3 dB target (§M7); temperature-blind k (§M1); no Llk output (§M6) | every listed defect is sourced and quantified in PHYSICS.md |
| `topology/operating-points.ts` | good closed-form stress math for the 11-topology union; fixed 40 ns dead time → `deadTimeFrac`; `zvs` booleans by construction | no ZVS margins (§T7/D9); no DAB cusp/exact RMS (§T3); LLC lacks Im/Lm bound and cap stresses (§T2); no capacitor spectra (§P3); no 2*f_line/hold-up bus-cap math surfaced (§T5) |
| `thermal/thermal.ts` | single Rth ladder into shared sink; paralleled dies divide Rth by n; steady-state only | shared-board coupling ignored (§H4); no network, no CSP/top-cool paths (§H2); no Zth transient (§H3); theta_JA semantics unguarded (§H1) |
| `control/compensator.ts` | reasonable averaged-model synthesis + Tustin | no digital delay phase at crossover (§C3); no sampling gain He(s) (§C2) |
| `simulation/simulate.ts` | semi-implicit Euler PWL, settle-then-record | step-size ripple error; no shooting steady state (§N1–N2); no cap-current FFT export |
| `compliance/compliance.ts` | derating/Tj/creepage/ripple checks | no dv/dt-vs-CMTI, Lloop*di/dt, paralleling design rules, GaN transient-Vds vs SiC avalanche (§D10, §E4) |
| EMI | absent (layout guidance only) | §E1–E3 designer + pre-check missing entirely |
| `data/*` | 40+ devices, materials, cores, wires, caps | device records lack gfs/Qgs2/Qgd/Rg/Coss tables; single-band Steinmetz; caps lack physics records (§D10, §M1, §P1–P5) |

## 0.1 Frozen-contract strategy

`types.ts` must not change (per CLAUDE.md). All v2 physics parameters live in
**parallel physics records keyed by part/material id**, owned by the module
that consumes them:

- `src/lib/data/devicePhysics.ts` — `DevicePhysics` keyed by `SwitchDevice.id`
- `src/lib/data/materialBands.ts` — banded Steinmetz + CT + SPG keyed by `CoreMaterial.id`
- `src/lib/data/capacitorPhysics.ts` — `CapacitorPhysics` keyed by `CapacitorPart.id`
- `src/lib/data/packageThermal.ts` — package-class thermal nets keyed by `SwitchDevice.id`/pkg

Frozen interfaces stay the cross-module currency; richer results (Llk, ZVS
margins, spectra, lifetime) ride in module-internal types and the existing
`notes` fields until a coordinated contract revision (it6 needs one for
`TopologyId`; single commit updating all consumers, per CLAUDE.md).

---

## 1. Prioritized backlog

Effort: S < 0.5 day, M ~ 1 day, L ~ 2–3 days (loop-pass units).
Priority: **P0** = credibility-critical for datacenter buyers (wrong sign /
>25% systematic error / anchor-blocking), P1 = accuracy & coverage, P2 = depth.

### Devices & switching → `src/lib/loss/device.ts` + `src/lib/data/devicePhysics.ts`

| ID | Change (function-level) | Physics | New types | Acceptance tests | Effort | Pri |
|----|--------------------------|---------|-----------|------------------|--------|-----|
| U1 | `rdsOnAtTj`: power law `((Tj+273)/298)^nT` from `(r100, r150)`; add `k_dyn` multiplier; keep linear fallback when physics record absent | §D1, §D2 | `DevicePhysics{rNorm100, rNorm150, kDyn, ...}` | r(150) within 2% of datasheet point per anchor part; monotonic in Tj; GaN@150C ~ 2.1x, SiC ~ 1.35x; `k_dyn = 1` for Si/SiC | M | P0 |
| U2 | replace `switchTransitionTimeS` with `gateTimings(dev, drv, IL)` → {t_cr, t_vf, t_vr, t_cf} from Qgs2/Qgd/Vpl/Rg partition; `Vpl = Vth + I/gfs` | §D3 | `+{gfs, qgs2Nc, qgdNc, rgIntOhm, vplV?}` | times positive, monotone in Rg; EPC2053 t_vf within 30% of datasheet-conditions estimate; degenerate light-load clamped by Q/Ig floor | M | P0 |
| U3 | `eonEoffJ()`: overlap per §D4 + Qrr term; `Eoff = min(overlap, I^2*t_cf^2/(24*C_node))` (§D7); optional SiC DPT-grid interpolation `Esw_ref(I)*(V/Vref)^1.3` | §D4, §D7 | `+{dptGrid?: {vRefV, rgRefOhm, points}}` | Eoff cap binds for strong-sink GaN case; DPT interpolation reproduces grid nodes exactly; kv scaling within family | M | P0 |
| U4 | `qossEossTables`: per-part Qoss(V)/Eoss(V) 50-pt tables (or C0*v^-gamma fit); `E_cap = Eoss_A + V*Qoss_B − Eoss_B + Cpar*V^2` replaces `n*Eoss` | §D5 | `+{cossFit | qossTable, eossTable, coTrPf?, coErPf?}` | linear-C limit: `E_cap = C*V^2` and `Q_node = 2CV` exactly; tables monotone; `Co(tr) > Co(er)`; `V*Qoss > 2*Eoss` for all parts | M | P0 |
| U5 | `zvsResolve(op, dev)`: charge criterion `I0*t_dt >= Q_node`, table inversion → `zvsFraction`, `E_res = E_cap(dV_rem)`; boolean `op.zvs` kept as threshold shortcut | §D9, §T7 | internal `ZvsResult{fraction, marginC, vReached}` | E_res → E_cap as t_dt → 0; E_res = 0 at full ZVS; continuity in I0; naive 2*Eoss energy criterion flagged insufficient in test vector from Kasper paper | M | P0 |
| U6 | dead-time loss: `Vsd = Vth + |Vgs_off| + I*Rrev(Tj)` (GaN), 3.5 V − 2 mV/C (SiC), per-edge ns dead times minus ZVS slew `Q_node/I` | §D8 | `+{vgsOffV, rrevFactor}` | Pdt linear in t_dt; −3 V rail adds exactly 3 V; zero when slew consumes dead time | S | P0 |
| U7 | add `P_hyst = k_hyst*Eoss(V)*fsw` (always, fsw > 500 kHz); gate loss swing fix `Qg*dVdrive*fsw` | §D6, §D10 | `+{kHyst?}` defaults 0.05/0.15/0.02 | hysteresis nonzero under ZVS; SiC +15/−4 drive uses 19 V swing | S | P1 |
| U8 | paralleling: conduction `*(1 + sigma^2*(n−1))`; shared-driver times independent of n; 1.2x worst-die concentration handed to thermal; warnings for n>=2 without Kelvin source, n>4 | §D10 | — | position switching loss invariant in n; imbalance factor at n=4, sigma=0.1 = 1.03 | S | P1 |
| U9 | `devicePhysics.ts` extraction: populate records for >= 6 anchor parts (EPC2053, EPC2218, LMG3522, IGT60R070D1, C3M-class SiC, one CoolMOS) with per-parameter provenance notes; tech defaults for the rest | §D1–D10, §A12 | the record itself | each anchor part reproduces datasheet Qoss/Eoss/r150 golden numbers within 5% | L | P0 |
| U10 | itemized loss report: split `switchingW`/`cossW` internally into Eon/Eoff/E_cap/hyst/Qrr (frozen `DeviceLoss` fields keep their sums; itemization in notes/internal type for optimizer gradients) | §D10 | internal `LossItemization` | items sum to reported fields within 1e-9 | S | P1 |

### Magnetics → `src/lib/magnetics/designMagnetic.ts`, `src/lib/loss/passives.ts`, `src/lib/data/materialBands.ts`

| ID | Change | Physics | New types | Acceptance tests | Effort | Pri |
|----|--------|---------|-----------|------------------|--------|-----|
| U11 | delete `IGSE_TRI`; per-segment iGSE over PWL B(t) with closed-form ki; duty-aware triangle form | §M2 | internal `FluxSegment[]` | D=0.5 triangle/sine ratio in 0.80–0.98 for alpha 1.2–2.0; D=0.1 penalty ~1.49x at alpha=1.5; ki closed form vs numeric integral < 0.3% | M | P0 |
| U12 | `materialBands.ts`: banded (k, alpha, beta) + CT polynomial + Bsat(25/100) + resistivity + anchor fixtures for N87/N97/N49/3C95/3C97/3F36 (+ Ferroxcube official fit table verbatim) | §M1 | `MaterialBand[]` keyed by material id | every fit reproduces its §M1 anchor points within 10%; CT(100C) = 1; 25 C loss ~ 2x 100 C for N87 | M | P0 |
| U13 | DC-bias multiplier from `Hdc_fe = Bdc/(mu0*mur)`: N87 SPG curve; placeholder `1 + 0.03*Hdc` cap 3x elsewhere, uncertainty note | §M3 | `+{spg?}` | 2x @ 35 A/m, ~3x @ 65 A/m for N87 (A11); skipped below 10 A/m; never applied to powder | S | P0 |
| U14 | exact Dowell everywhere: reuse `dowellFr` (already correct in passives.ts) with porosity-corrected xi + interleaving-aware m; harmonic sum `Rdc*Idc^2 + SUM FR(h*f)*Rdc*Ih^2` (3 odd harmonics); delete xi^4 path + `acFrac^2` blend | §M5 | internal harmonic table | FR(exact) matches xi^4 expansion within 2% for xi < 0.5; harmonic sum >= fundamental-only; xi = 4 case no longer clamped | M | P0 |
| U15 | litz selection: Sullivan-Zhang `ne = k*delta^2*b/Ns` with k-table, f_eff for nonsinusoidal; economical FR 1.06–1.68 target | §M5 | `+` k-table const | chosen n within +/-25% of ne; FR lands in economical band | S | P1 |
| U16 | fringing: `F = 1 + (lg/sqrt(Ae))*ln(2G/lg)` in the L/turns/gap iteration; near-gap proximity penalty for conductors within 3*lg via `H(r) = NI/(pi*r)`; distributed-gap option; replace flat 3 mm cap | §M4 | — | L with fringing > no-fringe L; penalty → 0 as spacing grows; gap warnings keyed to lg/sqrt(Ae) | M | P1 |
| U17 | transformer dB* from Erickson optimum (Pfe/Pcu = 2/beta), capped 0.75*Bsat(Thot); use in AP preselect too | §M7 | — | optimum satisfies Pfe/Pcu = 2/beta within 5%; dB* falls as f rises | M | P0 |
| U18 | thermal: `Rth = 53*Ve^-0.54`; planar `12*dT/Ve` rule; hot-spot +0.15*Rth; iterate Thot → CT, rho_cu(T), Bsat(Thot) (2–3 passes); drop `CU_HOT` constant | §M8 | — | ETD29/49/59 predictions within 30% of datasheet Rth; Rth larger than v1's for all Ve | S | P0 |
| U19 | report Llk = `mu0*N1^2*(MLT/b)*(hp/3 + hs/3 + hi)/m^2` (+ Rogowski) in notes; expose to DAB/LLC sizing; MHz guards (HF materials only > 1 MHz, dimension > 10 mm flag) | §M6, §M8 | internal `WindingGeometry` | Llk halves per interleave doubling (1/m^2); planar case < 3% of Lm | M | P1 |
| U20 | MagNet integration tier: golden tests vs measured sine/tri/trap points for N49/N87/3C90/3C94/3F4 | §M2, §A9 | fixtures | iGSE within 15% inside fit band; failures listed, not hidden | L | P1 |

### Topologies → `src/lib/topology/operating-points.ts` (+ catalog growth)

| ID | Change | Physics | New types | Acceptance tests | Effort | Pri |
|----|--------|---------|-----------|------------------|--------|-----|
| U21 | DAB: exact cusp currents i(0), i(phi), PWL RMS, per-bridge ZVS inequalities + charge margin; L sized for phi_rated 20–35 deg | §T3 | internal | d=1 → ZVS both bridges any phi>0; RMS matches numeric integration < 0.5%; power peaks at phi = pi/2 | M | P0 |
| U22 | LLC: FHA gain function Mg(fn, Ln, Qe); Lm <= t_dead*Ts/(16*Ceq) bound; tank RMS incl. Im^2/3 term; Vcr_pk; rectifier/output-cap stresses (0.48*Io); peak-gain 15% margin flag below resonance | §T2 | internal | Mg(1) = 1 for all (Ln, Qe); stress identities vs numeric; margin warning fires when Mg_max within 15% of FHA peak | M | P0 |
| U23 | PSFB: `dD = 4*fs*Lr*(Io/n)/Vin`, lagging-leg energy criterion, ZVS-loss load threshold reported | §T4 | internal | Deff < D; Ip_min = Vin*sqrt(C_leg/Lr) reproduced | S | P1 |
| U24 | totem-pole: closed-form leg RMS set, 2*f_line bus-cap current + hold-up C, iTHD note handles; fast/slow legs already split — wire new stresses in | §T5 | internal | fast-leg Irms^2 sum = Im^2/2 identity; hold-up C >= formula | S | P0 |
| U25 | per-transition ZVS data: every topology emits {I0, t_dt, V} per edge for U5; explicit ns dead times replace `deadTimeFrac` internally (frozen field still populated) | §T7, §D9 | internal `TransitionSpec` | totem-pole light-load partial ZVS produces zvsFraction in (0,1) | M | P0 |
| U26 | capacitor current spectra per topology (10 harmonics of fsw + 2*f_line for PFC) feeding P3 loss kernel | §P3 | `Spectrum{fHz, iRmsA}[]` | Parseval: SUM Ih^2 = Irms_ac^2 within 2% for buck triangle | M | P0 |
| U27 | catalog growth (needs `TopologyId` union revision — coordinated commit): `fcml-buck-3l/4l`, `llc-dcx-ibc`, `cllc`; scoring + operating points + FCML (N−1)^2 ripple/cap-balance math; SC Rout SSL/FSL for hybrid stages | §T6 | contract revision + internal | device stress = Vin/(N−1); L shrink (N−1)^2; SC efficiency cap eta <= Vo/(M*Vin) enforced in scoring | L | P1 |
| U28 | catalog growth 2: `coupled-multiphase-buck` (L_tr/L_ss math), `hybrid-dickson`; sigma/switched-tank/TLVR as P2 stubs with scoring rationale | §T6 | same revision | coupled-L FoM (1+alpha)/(1−alpha) at D=0.5; Dickson anchor A8 plausibility check | L | P2 |

### Control → `src/lib/control/compensator.ts`

| ID | Change | Physics | Tests | Effort | Pri |
|----|--------|---------|-------|--------|-----|
| U29 | digital delay `e^(−s*Td)`, Td = 1.5/fsw in margin math; warn when it eats > 15 deg at crossover; He(s) sampling gain for CM designs crossing > fsw/10 | §C3, §C2 | phase margin reported with delay <= without; crossover auto-reduced to keep PM | S | P1 |
| U30 | DAB feed-forward `phi(P, V1, V2)` from §T3 closed form into firmware hooks; LLC fn-window guard from §T2 | §C4 | phi inversion round-trips P within 1% | S | P2 |

### Thermal → `src/lib/thermal/thermal.ts` (+ `src/lib/data/packageThermal.ts`)

| ID | Change | Physics | New types | Tests | Effort | Pri |
|----|--------|---------|-----------|-------|--------|-----|
| U31 | replace ladder with small conductance-network solve `G*T = P`; package classes: CSP (RthJB + spreading + via array + board convection), bottom-cooled QFN (DAP + vias + TIM + sink), top-cooled (RthJC-top + TIM ‖ board branch); stop dividing Rth by n across shared boards | §H2, §H1 | `PackageThermalNet` | EPC2218 RthJA = 53 K/W @ 1 in^2 2 oz reproduced within 20% (A12); SNOAA14B 9.2/16.4 K/W ladders within 20% (A14); network reduces to v1 ladder for single-path case | L | P0 |
| U32 | multi-die coupling matrix `dTj_i = SUM Rth_ij*Pj` with 0.68 default CSP coupling; 1.2x worst-die concentration from U8 consumed here | §H4 | `+ couplingMatrix?` | 2-die case: Tj above single-die/2 prediction; superposition linearity | M | P1 |
| U33 | Foster Zth layer: `dTj_pp = 2*P*|Zth(j*2*w_line)|` for PFC ripple; periodic-pulse overload check | §H3 | `+{foster: {r, tau}[]}` | Zth(t→inf) = sum r = Rth_JC; 120 Hz ripple > 0 and < steady dT | M | P1 |

### Passives → `src/lib/loss/passives.ts` (+ `src/lib/data/capacitorPhysics.ts`)

| ID | Change | Physics | New types | Tests | Effort | Pri |
|----|--------|---------|-----------|-------|--------|-----|
| U34 | `esrAtF(cap, fHz, tC) = tanDeltaLf/(2pi*f*C) + rHf(T)`; `capacitorLossW(cap, spectrum, tCore)` harmonic sum; keep old signature as one-line-spectrum wrapper; electro-thermal fixed point (h = 9.3 W/m^2K natural, Rth_cc 3–5 C/W > 25 mm cans) | §P2, §P3 | `CapacitorPhysics` | ESR(120 Hz) >= ESR(100 kHz); monotone to plateau; CDE 4700 uF anchor: 0.36 W/C, 11 A @ 30 mOhm/10 K (A13); fixed point converges <= 4 it. | M | P0 |
| U35 | `effectiveCapUf(cap, vdc, tC, hoursAged?)`: tanh bias sigmoid + EIA fT + aging; charge-equivalent Ceff from closed-form Q(V); feed C(v) = dQ/dv to simulator; use in ripple compliance | §P1 | `+{dcBias, tempcoClass, agingPctPerDecade}` | fV(0) = 1, monotone; X5R at rated V loses 50–80%; C0G flat | M | P0 |
| U36 | rating checks: `I_eq = sqrt(SUM (Ih/kf)^2)` with model-derived kf; temp multiplier cap 1.5/2/3 rule; MLCC dT_self <= 20 K | §P4 | — | DCMC-style 360 Hz multiplier = 1.13 +/-10% | S | P1 |
| U37 | `lifetimeHours()`: electrolytic 10-K + Mv; film V^-n; polymer 20-C decade; MLCC P-V; aged 2x-ESR operating point reported; optimizer surfaces life as candidate metric | §P5 | `+{life}` | life(Tm, Vr) = Lb; no extrapolation below 40 C core (capped 15 y); film 10% derating ~ 2x | M | P1 |
| U38 | parallel-bank per-harmonic current division via Z_k before loss summation | §P3 | internal | LF divides ∝ C, HF ∝ 1/ESR in 2-part limit | S | P2 |

### EMI → new module `src/lib/emi/`

| ID | Change | Physics | New types | Tests | Effort | Pri |
|----|--------|---------|-----------|-------|--------|-----|
| U39 | `designEmiFilter(id, spec, fsw, waveforms)`: DM/CM source estimate (trapezoid envelope; `I_cm = Cpar*dv/dt` with dv/dt from U2), CISPR 32 A/B limit lines, required Att(f), LC corner + damping (Rd ~ sqrt(L/C), Cd ~ 4Cx), Cy leakage cap, Middlebrook impedance check note | §E1–E3 | `EmiFilterDesign` (module-internal; BOM lines via existing types) | envelope corner frequencies match 1/(pi*t_pulse), 1/(pi*t_rise); Att sizing monotone in fsw; Cy <= leakage budget; honest +/-10 dB disclaimer in notes | L | P1 |
| U40 | compliance additions: dv/dt vs driver CMTI, `Lloop*di/dt > 0.2*Vbus` warning, paralleling rules (U8), GaN transient-Vds vs SiC avalanche derating distinction | §E4, §D10 | — | each rule fires on constructed violating design, silent otherwise | S | P0 |

### Numerics → `src/lib/simulation/simulate.ts`, `src/lib/optimizer/optimizer.ts`

| ID | Change | Physics | Tests | Effort | Pri |
|----|--------|---------|-------|--------|-----|
| U41 | exact PWL discretization (matrix exponential per interval, scaling-and-squaring) replacing Euler; event location by Brent for DCM/diode boundaries | §N1 | buck ripple matches analytic `Vo(1−D)/(8LCf^2)` < 1%; energy conservation in lossless limit | M | P1 |
| U42 | shooting steady state: Newton on `x(T) = x(0)` with monodromy Jacobian; fall back to time-stepping on non-convergence | §N2 | LLC/DAB steady state in <= 4 Newton steps; matches settled time-stepping < 0.5% | M | P1 |
| U43 | cap-current FFT export from steady state → U26/U34 spectra; efficiency-curve evaluation reuses converged states | §N1, §P3 | FFT Parseval check | S | P1 |
| U44 | calibration harness `src/lib/calibration/`: anchor registry (A1–A14 from PHYSICS §A), per-anchor spec → `designConverter` reproduction → assertion `|eta_model − eta_meas| <= 1.5%` (component anchors: their own gates); CI-tier report of per-anchor deltas | §N4, §A | `AnchorCase` | all anchor cases run in CI; failures report per-mechanism loss deltas, not just pass/fail | L | P0 |

---

## 2. Loop iterations (next 7 /loop passes)

Each pass is a coherent, shippable slice ending with the full verify gate.

**it2 — Device physics core (U1–U6, U9 partial, U40 partial).**
Nonlinear Coss accounting (Qoss/Eoss tables, `V*Qoss` hard-switch cost),
gate-charge-partition timing, power-law Rds(Tj) + `k_dyn`, Coss-limited Eoff,
charge-criterion ZVS with continuous `zvsFraction`, per-edge dead-time
optimizer input (§D1–D9). Physics records for 3 anchor parts minimum
(EPC2053, LMG3522, C3M-class). Exit: linear-C identities exact; anchor-part
golden numbers within 5%; all existing tests still green.

**it3 — Magnetics core (U11–U14, U17, U18; U15 if time).**
Exact per-segment iGSE (delete the 1.15 factor), banded material data with
anchor fixtures, DC-bias multiplier, exact-Dowell harmonic-sum copper loss,
Erickson dB* optimum, honest Rth + temperature iteration (§M1–M5, M7, M8).
Exit: triangle/sine ratio test in 0.80–0.98; N87 anchors reproduced within
10%; magnetics tempRise strictly above v1 for equal designs (documented
expectation shift in test snapshots).

**it4 — Topology stress exactness + numerics (U21–U26, U41, U42, U43).**
DAB cusp/RMS/ZVS boundaries, LLC FHA + Lm bound + tank stresses, PSFB duty
loss, totem-pole RMS identity set, per-transition ZVS data plumbed into it2's
resolver, capacitor spectra emitted; exact PWL discretization + shooting
steady state feeding spectra by FFT (§T2–T5, T7, N1–N2). Exit: RMS identities
vs numeric integration < 0.5%; simulator ripple vs analytic < 1%.

**it5 — Passives + EMI designer (U34–U36, U39; U37 start).**
ESR(f,T) two-term kernel, harmonic-summed cap loss with electro-thermal fixed
point, MLCC bias/temperature derating into ripple compliance and simulator,
ripple-rating multipliers; EMI module: DM/CM estimate, CISPR 32 pre-check,
filter synthesis with damping + Cy leakage budget (§P1–P4, E1–E3). Exit: CDE
worked-example anchors reproduced; filter corner math property-tested;
`checkCompliance` consumes the new ripple/rating checks.

**it6 — Datacenter topology catalog (U27, U28 partial) + contract revision.**
Single coordinated commit extending the frozen `TopologyId` union
(all consumers updated same commit per CLAUDE.md): 3-/4-level FCML buck,
LLC-DCX IBC, CLLC bidirectional; SC SSL/FSL sizing for hybrid stages; coupled
inductor math behind `interleaved-sync-buck` and `coupled-inductor` role
(§T6). Exit: FCML (N−1)^2 invariants; CLLC-DCX symmetric-gain test; scoring
prefers FCML/IBC on 48 V rack specs and CLLC on 800 V specs with cited
rationale.

**it7 — Thermal network + transient + reliability (U31–U33, U37 finish, U38).**
Conductance-network thermal solve with package classes and shared-board
coupling matrix, Foster Zth 100/120 Hz ripple + overload check, capacitor
lifetime models surfaced as optimizer metrics (§H1–H4, P5). Exit: EPC2218 and
SNOAA14B anchors within 20%; 2-die coupling test; lifetime golden numbers.

**it8 — Calibration harness + report card (U44, U9/U12/U20 completion,
U29/U30, remaining P2s as time allows).**
Anchor registry for A1–A14, reproduction runs in CI, per-anchor efficiency
deltas at published operating points, gate `|delta_eta| <= 1.5%` absolute for
system anchors (path to the 0.5% GOAL.md gate), device/magnetics/thermal
component gates per PHYSICS §A. Publish the report card into `docs/` as the
customer-facing accuracy page. Exit: **Definition of physics-credible** below
fully checked.

---

## 3. Definition of physics-credible (sign-off checklist)

A senior power engineer signs off when every line holds:

**Devices**
- [ ] Rds(on)(Tj) is a power-law/two-point fit reproducing the datasheet 150 C point within 2%; conduction loss is reported at converged Tj, never 25 C (§D1).
- [ ] GaN carries a sourced, condition-dependent dynamic-Rds(on) multiplier; Si/SiC do not (§D2).
- [ ] Switching times come from the Qgs2/Qgd partition with the actual driver Rg and rails — no fixed-current shortcuts (§D3).
- [ ] Hard-switched half-bridge capacitive loss equals `V*Qoss(V)` for a matched pair and passes the linear-C identity `E_cap = C*V^2` exactly (§D5).
- [ ] ZVS is a computed charge/energy margin with a partial-ZVS residual, not a topology-declared boolean; dead-time loss prices only `t_dt − Q_node/I` (§D8, §D9).
- [ ] Coss hysteresis is priced under ZVS above 500 kHz; GaN Eoff is capped by the Coss-limited form (§D6, §D7).
- [ ] Every device default (k_dyn, k_hyst, r150, Vsd) has an inline citation; per-part records carry provenance notes (§D10).

**Magnetics**
- [ ] Core loss is per-segment iGSE on the real PWL flux waveform; the symmetric-triangle/sine ratio lands in 0.80–0.98 for alpha 1.2–2.0 (§M2).
- [ ] Steinmetz fits are banded, temperature-corrected (CT), and reproduce their datasheet anchor points within 10%; no fit derived from the collinear 4-anchor table alone (§M1).
- [ ] DC-biased designs apply an Hdc_fe-based loss multiplier; gapped-inductor core loss is never the zero-bias value (§M3).
- [ ] Copper loss is exact-Dowell, harmonic-summed; no small-xi expansion anywhere; litz picked by the Sullivan-Zhang economical criterion (§M5).
- [ ] Fringing corrects L and prices near-gap copper; transformer flux swing comes from the Pfe/Pcu = 2/beta optimum; magnetic Rth uses the 53*Ve^-0.54 correlation; Llk is computed and reported (§M4, §M6–M8).

**System**
- [ ] DAB/LLC/PSFB/totem-pole stresses match numeric waveform integration within 0.5%; every ZVS claim traces to a per-transition charge margin (§T2–T5, T7).
- [ ] Thermal is a network with package-class paths and shared-board coupling; theta_JA is never used as a design value; 100/120 Hz Tj ripple is checked for PFC stages (§H1–H4).
- [ ] Capacitor loss uses ESR(f,T) with real spectra and closes its electro-thermal loop; MLCC capacitance is bias/temperature/age-derated everywhere it is consumed; electrolytic/film/polymer lifetime is reported with its validity limits (§P1–P5).
- [ ] An EMI pre-check estimates DM/CM at the LISN against CISPR 32 with a stated +/-10 dB honesty band, and the filter it sizes is damped and leakage-compliant (§E1–E3).
- [ ] dv/dt-vs-CMTI, loop-inductance di/dt, paralleling symmetry, and GaN transient-Vds rules fire as compliance findings — never silent model adjustments (§E4, §D10).
- [ ] Simulator steady state is shooting-solved with exact PWL discretization; all fixed-point loops have iteration caps and surfaced divergence warnings; nothing throws — infeasibility is scored and explained (§N1–N3).
- [ ] The calibration harness runs A1–A14 in CI: system anchors within 1.5% absolute efficiency (roadmap to 0.5% per GOAL.md before public claims), device goldens within 5%, magnetics within 15%, thermal within 20% — with per-anchor deltas published, not just pass/fail (§A, §N4).
- [ ] Every model in the product has a PHYSICS.md section stating equations, assumptions, validity limits, and sources — and the docs and code cross-reference by section code.
