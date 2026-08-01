# VoltForge Engineering Foundations

**The first-principles reference for every model in the platform.**
This document is both the internal engineering spec and the methodology
documentation customers read. Every model states its governing equations
(ASCII math), its assumptions and validity limits, where its parameters come
from, and its **fidelity ladder**: `v1` = what ships in the repo today,
`v2` = the next implementation target (see [TECHPLAN.md](../TECHPLAN.md)),
`RG` = research-grade, the model we escalate to when the analytic form breaks.

Conventions (from `src/lib/types.ts`, frozen): SI units unless a field-name
suffix says otherwise (`rdsOnMohm25`, `qgNc`, `aeMm2`); Steinmetz
`Pv[kW/m^3] = k * f[Hz]^alpha * B[T]^beta` with `B` = sinusoidal **amplitude**
(= half the peak-to-peak swing). Section codes (D1, M3, T2, ...) are the
cross-reference keys used by TECHPLAN.md.

---

## 1. Devices and switching

### D1. Conduction and Rds(on) temperature scaling

**Governing equations.** Per switch position with `n` parallel devices:

    Pcond = (Irms^2 / n) * R25 * r(Tj) * k_dyn
    r(Tj) = ((Tj + 273) / 298) ^ nT          (power law, NOT linear)

Typical exponents `nT` fitted from datasheet normalized-Rds(on) curves:
GaN e-mode 2.0–2.4 (r(150C) ~ 2.0–2.3), Si superjunction 2.2–2.5,
SiC MOSFET 0.7–1.2 (r(150C) ~ 1.25–1.5). `k_dyn` is the GaN dynamic-Rds(on)
multiplier (D2); `k_dyn = 1` for Si/SiC.

**Physics.** GaN 2DEG resistance is phonon-scattering limited, `mu ~ T^-2.3`,
with polarization-set (temperature-flat) carrier density — a steep, purely
positive tempco. Si SJ drift resistance follows bulk mobility `~T^-2.4`. SiC is
the outlier: its interface-trap-limited MOS channel *improves* with temperature
and partially cancels the drift term, so a single exponent fits SiC poorly —
store a two-point fit `(r100, r150)` or a quadratic
`r = 1 + a*dT + b*dT^2` instead.

**Assumptions / validity.** 25–175 C at rated Vgs; clamp `r >= 0.75–0.85` at
the cold end. SiC Rds(on) also rises if Vgs droops below ~15–18 V — a driver
check, not a loss term.

**Parameters.** Datasheet normalized Rds(on) vs Tj at 100 C and 150 C:
`nT = ln(r150) / ln(423/298)`; keep both points as regression fixtures.
[EPC eGaN electrical-characteristics literature; Wolfspeed SiC spec points
(650 V r(175C) < 1.25, 1200 V < 1.45); Infineon CoolMOS/CoolGaN curves]

**Fidelity ladder.** v1: linear `R25*(1 + k*(Tj-25))` (`rdsOnAtTj`,
`src/lib/loss/device.ts:21`) — under-predicts above ~125 C. v2: power law +
`(r100, r150)` fixtures + `k_dyn`. RG: per-part measured R(Tj, Vgs) surfaces.

### D2. Dynamic Rds(on) in GaN

GaN-only: Rds(on) measured us–ms after high-Vds off-state or hard-switching
stress exceeds the static value (buffer/surface trapping + hot-electron
injection). Measurement is standardized by JEDEC JC-70.1 **JEP173** (2019) and
JEP180. v2 derating multipliers on R25 (defaults, overridable per part with
vendor JEP173 data):

    soft-switched, <= 80% rated Vds:      k_dyn = 1.0 – 1.1
    hard-switched 400 V bus, 650 V part:  k_dyn = 1.1 – 1.25
    hard-switched near rated V / extreme dv/dt: k_dyn = 1.2 – 1.5

Trapping partially anneals at high Tj, so worst case is often *cold*. Do not
apply to Si/SiC. Escalate `k_dyn` when drain overshoot exceeds ~80–100% of
rated Vds (tie to the compliance overvoltage check).
[JEDEC JEP173/JEP180; EPC dynamic-Rds(on) app literature]

### D3. Switching transitions from the gate-charge partition

**Governing equations.** Turn-on phases off the gate-charge curve: delay
(0→Vth, charge Qth), current rise (charge `Qgs2 = Qgs − Qth`), Miller plateau
(`Vpl = Vth + IL/gfs`, charge Qgd), overdrive. With resistive drive:

    t_cr = Qgs2 * Rg_on / (Vdrv − (Vth + Vpl)/2)     (current rise)
    t_vf = Qgd  * Rg_on / (Vdrv − Vpl)               (voltage fall)
    t_vr = Qgd  * Rg_off / Vpl                       (voltage rise)
    t_cf = Qgs2 * Rg_off / ((Vth + Vpl)/2 − Vlo)     (current fall)

`Rg = driver Ron/off + external Rg + internal gate Rg`; `Vlo` = (possibly
negative) off rail. With a current-limited driver use `t = Q / Ig`.

**Assumptions / validity.** Neglects common-source-inductance feedback
(`Ls * di/dt` subtracts from Vgs and stretches `t_cr`) — fine for
Kelvin-source GaN/SiC packages, poor for TO-220/247 without Kelvin source.
Constant gfs assumed; clamp with `Q/Ig` floors near `Vpl ~ Vth` (light load).

**Fidelity ladder.** v1: `t = 0.5*Qg / (1.5 A)` (`switchTransitionTimeS`) —
ignores Rg, Vdrv, and the Qgd/Qgs2 split; errs 3–5x. v2: the four-phase model
above. RG: 5-phase piecewise model with Ls/Lloop feedback or calibrated SPICE.
[Graovac, Purschel, Kiep, Infineon AN 2006-07; Erickson & Maksimovic]

### D4. Hard-switching overlap energy and reverse recovery

    Eon  = 0.5 * Vbus * I_on  * (t_cr + t_vf)  +  Qrr * Vbus
    Eoff = 0.5 * Vbus * I_off * (t_vr + t_cf)
    Psw  = fsw * (Eon + Eoff)   per position

`Qrr*Vbus` applies only when the hard-commutated complement is a bipolar
junction (Si body diode: 100s nC–uC, di/dt- and T-dependent; SiC: ~10s nC,
mostly capacitive; GaN: zero). `n` parallel devices on a shared driver each
commutate `I/n` in roughly the same time — position total unchanged to first
order. For SiC parts with published double-pulse Eon/Eoff(I) grids, **prefer
direct interpolation**: `Esw = Esw_ref(I) * (V/Vref)^kv`, `kv ~ 1.2–1.4`, plus
the vendor Rg correction; analytic overlap is the fallback (the normal case
for GaN, where DPT curves are rarely published).

**Validity.** Linear-ramp assumption; when `Lloop * di/dt > ~0.2 * Vbus`
measured Eon drops (inductive snubbing) and Eoff rises (overshoot) — emit a
warning, never a silent adjustment (see E4).
[Infineon AN 2006-07; Wolfspeed C3M / Infineon IMZ DPT practice]

### D5. Capacitive turn-on loss: V*Qoss accounting, not n*Eoss

**Governing equations.** At hard turn-on in a half-bridge the incoming device
(a) burns its own stored `Eoss_A(V)` and (b) charges the opposite device's
Coss *through its channel*: the bus delivers `V*Qoss_B`, the cap stores
`Eoss_B`, and `V*Qoss_B − Eoss_B` dissipates. Per hard-switched cycle:

    E_cap = Eoss_A(V) + V*Qoss_B(V) − Eoss_B(V) + Cpar*V^2
          = V * Qoss(V) + Cpar*V^2         (matched pair)

Linear-C sanity check: `E_cap = C*V^2 = 2 * (0.5*C*V^2)` — exactly 2x the
"n*Eoss" bookkeeping v1 uses. Because Coss collapses with voltage
(co-energy > energy), `V*Qoss(V) > 2*Eoss(V)` always. Under full ZVS the
entire term vanishes (energy recycled through the inductor).

**Coss nonlinearity.** `Eoss(V) = int_0^V v*Coss(v) dv != 0.5*Coss(V)*V^2`.
Datasheet effective capacitances (specified 0 V to 80% rated Vds): `Co(tr)`
(charge-related, `Qoss = Co(tr)*V` — use for dead-time/ZVS budgets) and
`Co(er)` (energy-related, `Eoss = 0.5*Co(er)*V^2` — use for hard-switching
energy); `Co(tr) > Co(er)` always. Power-law fit when only curves exist:
`Coss(v) = C0*v^-gamma` gives `Qoss = C0*V^(1-gamma)/(1-gamma)`,
`Eoss = C0*V^(2-gamma)/(2-gamma)`. v1's fixed `V^1.6` scaling equals
`gamma = 0.4` — acceptable for GaN, invalid across the Si-SJ knee (20–50 V);
use tabulated Qoss/Eoss there. Best practice: numerically integrate the
digitized Coss(v) curve into ~50-point Qoss/Eoss tables per part.

**Fidelity ladder.** v1: `cossW = n * Eoss(V^1.6-scaled) * fsw` when hard
(`device.ts:132`) — undercounts ~2x and cannot do partial ZVS. v2: per-part
Qoss/Eoss tables + the E_cap equation. RG: measured C-V at temperature, plus
Coss hysteresis (D6).
[First-principles charge/energy bookkeeping, verified in the linear-C limit;
Kasper et al., IEEE TPEL 31(12) 2016; Infineon KBA236328 Co(tr)/Co(er)]

### D6. Coss hysteresis loss (nonzero even under perfect ZVS)

Large-signal charging/discharging of Coss dissipates a hysteresis energy per
cycle (drift-region relaxation), measured by Sawyer-Tower on 600 V-class
devices at 5–35 MHz: present in **all** tested parts, comparable to conduction
loss at MHz, ~linear in stored energy, steeply increasing with dv/dt.

    P_hyst = k_hyst * Eoss(V_swing) * fsw    (applied always, ZVS or hard)

Tech defaults: `k_hyst ~ 0.02` (SiC), `0.05` (GaN e-mode), `0.15` (Si SJ),
overridable per part. Negligible below a few hundred kHz; above ~2–3 MHz
`k_hyst` itself becomes dv/dt- and waveshape-dependent — flag for
measured-data calibration. v1: absent. v2: the linear model above.
RG: per-part Sawyer-Tower data.
[Zulauf, Park, Liang, Surakitbovorn, Rivas-Davila, IEEE TPEL 33(12) 2018;
Fedison & Harrison, APEC 2016]

### D7. GaN Coss-limited turn-off

With a strong sink the GaN channel closes in a few ns while the *load current*
slews the node, `C_node = Coss_A + Coss_B + Cpar`. Linear channel-current fall
over `t_cf` gives the residual:

    Eoff_residual = I^2 * t_cf^2 / (24 * C_node)
    Eoff(v2)      = min(overlap formula D4, Eoff_residual)

Valid in the current-source regime (`v(t_cf) < Vbus`); explains measured GaN
Eoff being 5–20x below `0.5*V*I*tf` and why datasheet `tf` is nearly
meaningless for GaN loss. The Eoss stored afterwards is recycled (ZVS) or
burned at the next hard turn-on — already counted in D5; do not double count.
[Derived from linear current fall into C_node; consistent with ETH/Kolar-group
and EPC measurements]

### D8. Reverse conduction and dead-time loss

GaN third quadrant (2DEG conducting backwards, no body diode, zero Qrr):

    Vsd = Vth + |Vgs_off| + Id * Rrev(Tj),   Rrev ~ 1.5–2.5 * Rds(on)

A −3 V off-rail **adds 3 V** to the drop: typical Vsd 1.8–2.5 V at
`Vgs_off = 0`, 4.5–6 V at −3 V. SiC body diode: Vf ~ 3–4.5 V at 25 C (falls
with T) — v1's 1.5 V is 2–3x low when the diode actually conducts. Si SJ:
~0.8–1 V but large Qrr. Dead-time loss with explicit per-edge dead times,
pricing only the portion *after* the ZVS slew:

    Pdt = fsw * SUM_edges  Vsd(I_edge) * |I_edge| * max(0, t_dt − Q_node(V)/|I_edge|)

Optimal GaN dead times are 5–40 ns; loss is linear in t_dt — over-long dead
time is a first-order GaN efficiency killer and a real optimizer knob.
v1: fixed `Vsd` per tech x `deadTimeFrac`. v2: the equation above.
[TI SNOAA36; GaN Systems GN001; Infineon GaN reverse-conduction KB]

### D9. ZVS: charge criterion, energy integral, partial-ZVS residual

**Energy balance on the nonlinear node** (`C_node(v) = Coss_LS(v) +
Coss_HS(VDC − v) + Cpar`, inductor L against back-voltage Vb):

    0.5*L*I0^2 >= max over x in [0, VDC] of  int_0^x (u − Vb) * C_node(u) du

Worst case `Vb = 0`: `E_req = Eoss_LS(VDC) + [VDC*Qoss_HS(VDC) − Eoss_HS(VDC)]`
— the opposite device costs its **co-energy**, so `E_req > 2*Eoss` and the
naive `0.5*L*I^2 >= 2*Eoss` is NOT sufficient [Kasper et al. 2016].

**Current-source limit** (large L — LLC magnetizing current, DAB cusp, buck SR
edge), the primary v2 criterion:

    I0 * t_dead >= Q_node = Qoss_LS(VDC) + Qoss_HS(VDC) + Cpar*VDC  (~ 2*Qoss)
    => minimum dead time  t_dt >= Q_node / I0

**Partial ZVS.** If `Q_avail = I0*t_dead < Q_node`, invert the node charge
table for `V_reached`, and the residual hard-switched energy over the
remaining swing `dV_rem = VDC − V_reached` has the same own-energy +
opposite-co-energy structure as D5; practical form: `E_res ~ E_cap(dV_rem)`
from the same tables (+ small overlap term if `dV_rem > 0.2*VDC`). This turns
v1's boolean `op.zvs` into a continuous `zvsFraction` — the real light-load
design tradeoff in LLC/DAB/totem-pole.
[Kasper, Burkart, Deboy, Kolar, "ZVS of Power MOSFETs Revisited", IEEE TPEL
31(12):8063-8067, 2016, DOI 10.1109/TPEL.2016.2574998]

### D10. Gate drive, paralleling, and the consolidated v2 equation set

**Gate loss.** `Pg = n * Qg_total * dVdrive * fsw`, with `dVdrive = Vdrv_hi −
Vdrv_lo` (a +15/−4 V SiC drive is a 19 V swing; read Qg over that same swing).
Rg splits speed, not gate loss. v1 is structurally correct minus the swing
definition.

**Paralleling.** Static sharing self-balances (positive tempco, all three
techs); residual conduction imbalance `Pcond *= (1 + sigma^2*(n−1))`,
`sigma ~ 0.05–0.10`. Dynamic sharing set by Vth/layout mismatch: transitions
do **not** speed up with n on a shared driver (per-device Ig = Ig_total/n);
apply a ~1.2x switching-loss concentration on the worst die in the thermal
check; cap `n <= 4`; require Kelvin-source packages for `n >= 2` (compliance
warnings, not silent derates).
[GaN Systems APEC 2017 / GN012; MDPI Electronics DOI 10.3390/electronics15081607]

**Consolidated per-position v2 model** (evaluated at converged Tj):

    P = Pcond + fsw*(Eon + Eoff) + fsw*(E_cap or E_res) + P_hyst + Pg + Pdt

itemized per mechanism (conduction / Eon / Eoff / E_cap / C-hyst / Qrr / gate /
dead-time) so the optimizer sees correct gradients: raising fsw hurts GaN via
E_cap + hysteresis + dead-time but SiC via overlap energy. Temperature enters
via `r(Tj)`, `Vth(Tj)`, `Vsd(Tj)`, `Qrr(Tj)`.

**Validity limits triggering RG escalation.** `Lloop*di/dt > 0.2*Vbus`
(ringing/snubbing — piecewise 5-phase model or calibrated SPICE);
`fsw > 2–3 MHz` (dv/dt-dependent k_hyst, gate-loop resonance — Sawyer-Tower
data); dv/dt as a *constraint* vs driver CMTI and isolator ratings; long SiC
body-diode conduction (bipolar degradation, JC-70-tracked).

---

## 2. Magnetics

### M1. Steinmetz conventions, banded fits, and the collinearity trap

    Pv[kW/m^3] = k * f^alpha * Bhat^beta,   Bhat = amplitude = dB_pp/2

Mixing up Bhat and dB_pp gives a `2^beta ~ 6x` error — the most common
magnetics-model bug. Parameters are **band-local**: MnZn power ferrites run
`alpha = 1.2–1.7` below ~500 kHz rising to 2.0–2.9 in the MHz band,
`beta = 2.2–3.0`. Temperature enters as a parabola normalized to 1 at 100 C:
`CT(T) = ct0 − ct1*T + ct2*T^2`, loss minimum engineered at 80–110 C, so 25 C
loss is ~2x the 100 C datasheet value (N87: 375 kW/m^3 at 100 kHz/200 mT/100 C
vs ~750 at 25 C). **Core loss must be evaluated at the iterated hot-spot
temperature.**

**Fitting trap (demonstrated numerically).** The 4 anchor points in TDK
datasheets co-vary f and B (collinear), so LSQ-fitting (k, alpha, beta) to
them leaves beta unidentifiable (fits give beta ~ 1.9 vs true 2.4–2.8). Fit
only from constant-f Pv(B) curves (>= 3 B points per f) or Princeton MagNet
raw data; store multiple bands per material (Ferroxcube's official fits jump
alpha 1.46 → 2.6 between the 20–200 and 200–400 kHz bands of 3C94); keep the
datasheet anchors as regression fixtures (fits must reproduce them within 10%).
Verified anchor set (100 C, Bhat): N87 57/375/390/215 kW/m^3 at 25k/200mT,
100k/200mT, 300k/100mT, 500k/50mT; N97 45/300/340/205 at the same points;
N49 330 @300k/100mT, 80 @500k/50mT, 475 @1M/50mT (exact 3-point solve
k=2.41e-8, alpha=2.57, beta=3.94 — high exponents are real for eddy-dominated
HF material); 3C95 290 @100k/200mT/100 C; 3C97 320 @100k/200mT/60 C;
3F36 90 @500k/50mT, 700 @500k/100mT (two-point beta = 2.96). Ferroxcube's
published `Cm-x-y-CT` table (3C30/3C90/3C94/3F3/3F4 per band) is quoted in
full in the research record and belongs in the v2 data tables verbatim.
[TDK SIFERRIT N87/N97/N49 datasheets; Ferroxcube 3C95/3C97/3F36 material specs
and "Design of Planar Power Transformers" app note Table 1; C.P. Steinmetz
1892; Erickson & Maksimovic ch. 13]

**Fidelity ladder.** v1: single-band (k, alpha, beta) per material in
`CORE_MATERIALS`, temperature-blind. v2: banded fits + CT polynomial + anchor
fixtures (carried in magnetics-owned tables keyed by material id — types.ts
`CoreMaterial` stays the primary band). RG: MagNet-data-driven models.

### M2. iGSE for PWM waveforms; i2GSE relaxation

**iGSE.** `Pv = (1/T) int ki * |dB/dt|^alpha * dB_pp^(beta−alpha) dt`, minor
loops split recursively; `ki` fixed by reproducing the sinusoidal Steinmetz
result. Closed form (verified < 0.3% error for alpha 1.0–2.5):

    ki = k / ( 2^(beta+1) * pi^(alpha-1) * (0.2761 + 1.7061/(alpha + 1.354)) )

Closed-form triangle (total swing dB, rise duty D):

    Pv = ki * f^alpha * dB^beta * ( D^(1-alpha) + (1-D)^(1-alpha) )

**v1's `IGSE_TRI = 1.15` is in the wrong direction**: the exact
symmetric-triangle/sine ratio `ki/k * 2^(alpha+beta)` is 0.97/0.93/0.89/0.85/
0.81 for alpha = 1.2/1.4/1.6/1.8/2.0 — a triangle loses *less* than the
datasheet sinusoid, so v1 overestimates 20–40% (and underestimates at D < 0.2:
D = 0.1 at alpha = 1.5 is 1.49x the D = 0.5 value — boost/flyback at extreme
duty, phase-shifted DAB). v2 computes the actual PWL B(t) from topology
volt-seconds and evaluates iGSE segment-by-segment.

**Relaxation (i2GSE / CWH).** iGSE predicts zero loss while dB/dt = 0, but
trapezoidal flux with dwell loses *more* than the pure triangle. i2GSE adds a
per-transition relaxation term (5 extra fitted constants, published for N87);
PSMA square-wave testing supports the composite-waveform view with the same
caveat. v2 guidance: iGSE for triangle-dominated flux (buck/boost CCM);
+10–30% allowance or i2GSE terms when zero-voltage dwell > ~20% of the period
(DAB, LLC hold intervals, DCM).
[Venkatachalam, Sullivan, Abdallah, Tacca, IEEE COMPEL 2002; Muhlethaler,
Biela, Kolar, Ecklebe, IPEC 2010 and IEEE TPEL 27(2) 2012; Herbert, PSMA 2014;
Sullivan & Harris, PSMA rectangular-waveform reports]

### M3. DC-bias core loss (Steinmetz Premagnetization Graph)

Measured on N87 (R42 toroid, 100 kHz, 40 C): normalized loss climbs to ~2x at
`Hdc = 25–40 A/m` and 3–3.5x at 60–70 A/m; the bias factor is
frequency-independent; alpha unchanged. **The air gap does not shield the core
from bias** — compute the field in the ferrite:

    Hdc_fe = Bdc / (mu0 * mur)     (e.g. Bdc = 0.2 T, mur = 2200 -> ~72 A/m)

so a gapped inductor's true core loss is routinely 2–3x the zero-bias iGSE
value. v2 rule: apply an SPG-derived multiplier when `Hdc_fe > 10 A/m`; for
materials without published SPGs use placeholder `1 + 0.03*Hdc_fe` capped at
3x and annotate uncertainty. Powder cores: negligible bias effect on loss (SPG
flat for MPP). v1: absent.
[Muhlethaler, Biela, Kolar, Ecklebe, IPEC 2010 / IEEE TPEL 27(2) 2012,
ieeexplore.ieee.org/document/5936124]

### M4. Saturation, gap, effective permeability, fringing

    B = mu0 * N * I / (lg + le/mur)          (uniform-Ae gapped core)
    mue = mur / (1 + mur*lg/le);  AL = mu0*mue*Ae/le;  lg = mu0*N^2*Ae/L − le/mur

Check saturation at the **absolute worst-case peak** against Bsat at max
temperature: Bsat derates ~20% from 25 to 100 C (N87 490→390 mT; 3C97
550→430→360 mT at 25/100/140 C); usable ceiling `0.75–0.8 * Bsat(Thot)`.

**Fringing** raises L and burns copper near the gap:

    F = 1 + (lg / sqrt(Ae)) * ln(2G / lg)     (McLyman; G = window height)
    L = mu0 * N^2 * Ae * F / (lg + le/mur)    (iterate turns/gap once)
    H(r) = NI_gap / (pi * r)                  (near-gap field, line source)

Keep windings >= 2–3*lg from the gap or take up to 2x total copper-loss
penalty; `p` distributed gaps cut per-gap MMF by p (total fringe loss ~1/p);
quasi-distributed criterion: gap pitch <= ~4x gap-to-winding spacing. Replace
v1's flat 3 mm gap cap with `lg/sqrt(Ae)`- and spacing-based criteria. Powder
cores: solve `L(Ipk)` self-consistently on the vendor mu(Hdc) roll-off.
[Ampere's law; McLyman 4th ed. ch. 10; Hu & Sullivan, IEEE TPEL 16(4) 2001;
Sullivan et al., IEEE IAS 1998; TDK/Ferroxcube datasheets]

### M5. Winding loss: exact Dowell, harmonic summation, litz

    delta = sqrt(rho / (pi*mu0*f))   (Cu: 76/sqrt(f) mm at 100 C)
    xi = (h/delta)*sqrt(eta),  h = d*sqrt(pi/4),  eta = N_layer*d/b  (porosity)
    FR(xi, m) = xi * [ (sinh 2xi + sin 2xi)/(cosh 2xi − cos 2xi)
                + (2(m^2−1)/3) * (sinh xi − sin xi)/(cosh xi + cos xi) ]

`m` = layers counted from the zero-MMF surface (interleaving divides m).
Assumptions: 1D field, layers span the breadth (eta near 1), no gap fringing,
sinusoidal current. Accuracy ~10% for eta > 0.7 and xi < 2; the low-xi
expansion `FR ~ 1 + ((5m^2−1)/45)*xi^4` (v1, `designMagnetic.ts:146`) diverges
above xi ~ 1 — at 1 MHz a solid AWG18-class wire has xi ~ 4 and v1's clamp at
25 hides ~10x errors. Use the exact form; it costs nothing.

**Nonsinusoidal currents — harmonic summation** (replaces v1's `acFrac^2`
blend, which has wrong spectral weighting):

    Pcu = Rdc*Idc^2 + SUM_h FR(h*fsw) * Rdc * Ih_rms^2
    (symmetric triangle: Ih = (8/pi^2) * Ir / h^2, odd h; 3 terms > 99%)

**Litz (Sullivan-Zhang).** Economical strand count `ne = k * delta^2 * b / Ns`
(delta, b in mm; Ns = turns per section to the zero-field surface; published
k-table AWG32:130 ... AWG40:4.4k ... AWG48:115k mm^-3; economical FR runs
1.06–1.68 — "strand until FR = 1" is not optimal). Bundle-level loss:
`FR = 1 + pi^2*n^2*Ns^2*ds^6 / (192*delta^4*b^2)`; nonsinusoidal effective
frequency `f_eff = (1/2pi) * rms(di/dt) / rms(i_ac)`. RG: Sullivan's
squared-field-derivative method or 2D FEM for the final candidate only.
[Dowell, Proc. IEE 113(8) 1966; Ferreira, IEEE TPEL 9(1) 1994; Sullivan,
IEEE TPEL 16(1) 2001; Sullivan & Zhang, APEC 2014]

### M6. Leakage inductance

Energy method with the 1D MMF diagram across the winding build (primary build
hp, insulation hi, secondary hs, breadth b, m interleaving sections):

    Llk(at N1) = mu0 * N1^2 * (MLT/b) * (hp/3 + hs/3 + hi) / m^2

Interleaving is the strongest knob (~1/m^2); Rogowski correction
`[1 − (hp+hi+hs)/(pi*b)]` for finite breadth; HF value drops 10–30% below the
DC-geometry value (flux expulsion) — use LF for ZVS energy budgets, HF for
resonant-frequency prediction. Llk is a **design output** DAB/LLC/PSFB need;
v1 does not report it. Typical: planar interleaved 1–3% of Lm; wire-wound
non-interleaved 3–10%.
[Energy-method derivation; Erickson & Maksimovic ch. 13; Hurley & Wolfle 2013;
Dowell 1966]

### M7. Core selection: area product, Kg, and the loss-optimal flux swing

    AP_inductor    = L*Ipk*Irms / (Bmax*Ku*J)
    AP_transformer = Pt / (Kf*Ku*J*f*Bhat),  Kf = 4.44 sine / 4.0 square
    Kg = Ac^2*Wa/MLT >= rho*L^2*Imax^2 / (Bmax^2*R*Ku)   (copper-budget pick)

Honest constants: `Ku <= 0.4` round wire, 0.25–0.3 litz, 0.2–0.3 with
isolation margins (IEC 62368-1 creepage eats 20–40% of window), 0.15–0.25
planar PCB; `J = 3–6 A/mm^2` natural convection, 6–10 forced.

**Transformer flux swing from the Pfe–Pcu optimum** (replaces v1's fixed
200 kW/m^3 target): total loss `Ptot(dB) = Kfe*dB^beta*Ac*le +
[rho*lambda1^2*Itot^2*MLT/(4*Ku*Wa*Ac^2)]*dB^-2`; minimizing:

    dB* = [ rho*lambda1^2*Itot^2*MLT / (2*Ku*Wa*Ac^3*le*Kfe*beta) ]^(1/(beta+2))
    at the optimum: Pfe/Pcu = 2/beta   (beta = 2.7 -> Pfe ~ 0.74*Pcu, NOT 1:1)

Compute dB* per candidate core with Kfe from the banded fit at hot
temperature; cap at `0.75 * 2*Bsat(Thot)` pp and the thermal budget. At
>= 100 kHz transformer B is loss-limited (Bhat 50–100 mT at 500 kHz), so v1's
fixed 0.2 T AP preselect under-sizes HF cores.
[Erickson & Maksimovic ch. 14–15 (SI re-derivation confirms exponent);
McLyman 4th ed. ch. 5–7]

### M8. Magnetic thermal limits and MHz guards

    Rth = 53 * Ve[cm^3]^-0.54  K/W  (+/-30%, natural convection, free air)

Cross-checked against EPCOS ETD data (ETD29 28 K/W @ 5.35 cm^3, ETD49 ~8.8
@ 24, ETD59 ~5.2 @ 51.5) and Hurley & Wolfle's `0.06/sqrt(Vc[m^3])`. **v1's
`36/sqrt(Ve)` is 40–60% optimistic** — a systematic feasibility bias toward
overheating designs. Planar: up to 50% lower Rth at equal Ve; design rule
`Pcore <= 12 * dT / Ve[cm^3] mW/cm^3`. Forced air: /2–3 at 2–4 m/s. Hot spot:
add ~0.15*Rth internal (winding center runs 10–20% of dT above surface).
Iterate temperature inside the design loop: `CT(Thot)`, copper
`rho(T) = rho20*(1 + 0.00393*(T−20))`, `Bsat(Thot)` — 2–3 fixed-point passes.

**MHz guards.** MnZn resistivity is 1–20 Ohm-m (N87: 10, 3F36: 12, N49: 17):
bulk eddy currents and dimensional resonance make Pv depend on core
cross-section at MHz — flag min core dimension > ~10 mm above 1 MHz; restrict
to HF materials (3F36, N49, 3F4, ML91S, PC200); prefer NiZn (4F1) above
~3 MHz.
[Hurley & Wolfle 2013; EPCOS/TDK ETD data; McLyman ch. 6; Ferroxcube planar
app note; Snelling, Soft Ferrites 2nd ed.; Proterial ML91S release 2016]

---

## 3. Topologies

### T1. Volt-second / charge balance, CCM/DCM

Periodic steady state: `<vL> = 0`, `<iC> = 0` under the small-ripple
approximation give buck `M = D`, boost `M = 1/(1−D)`, isolated bridges
`Vo = (Vin/n)*Deff`. Mode boundary `K = 2*L*fs/R` vs `Kcrit(D)` (buck `1−D`,
boost `D(1−D)^2`); DCM: buck `M = 2/(1+sqrt(1+4K/D^2))`, boost
`M = (1+sqrt(1+4D^2/K))/2`. Transformer volt-seconds: `Bpk = Vs/(2*N*Ae)`
bipolar, `lambda/(N*Ae)` unipolar with reset — evaluate at Vin_min, full load,
fs_min. Valid for ripple fraction <~ 0.4. The lossless-stage assumption for
operating points is standard for component selection; loss engines close the
loop. [Erickson & Maksimovic 3rd ed. ch. 2, 5]

### T2. LLC and CLLC

**FHA gain (verified verbatim from TI SLUP263 eq. 23):**

    Mg = | Ln*fn^2 / ( [(Ln+1)*fn^2 − 1] + j*(fn^2 − 1)*fn*Qe*Ln ) |
    fn = fsw/f0, f0 = 1/(2pi*sqrt(Lr*Cr)), Ln = Lm/Lr,
    Qe = sqrt(Lr/Cr)/Re,  Re = (8*n^2/pi^2)*RL

HB: `Vo = Mg*(Vin/2)/n`; FB: `Vo = Mg*Vin/n`. All curves pass through
(fn, Mg) = (1, 1) — the DCX point. Design ranges: Ln = 3–10, Qe(full load) =
0.3–0.5, fn ~ 0.5–1.2. **Validity:** FHA is exact only at fn = 1 and
mispredicts the attainable peak gain by 10–20% below resonance — require
10–20% peak-gain margin; RG = piecewise time-domain mode analysis (P/N/O
interval sequences, peak gain on the PO/PON boundary solved by Newton).

**ZVS / stress set at fn = 1:** magnetizing peak `Im_pk = n*Vo*Ts/(4*Lm)`;
charge criterion `Im_pk*t_dead >= 2*Qoss(Vin)` gives `Lm <= t_dead*Ts /
(16*Ceq)` with `Ceq = Qoss(Vin)/Vin` per switch. Primary tank RMS
`Ip_rms ~ sqrt( (pi*Io/(2*sqrt(2)*n))^2 + Im_pk^2/3 )`; resonant cap
`Vcr_pk = Vin/2 + Ip_pk/(2pi*f0*Cr)` (HB); CT rectifier winding
`Irms = (pi/4)*Io`, `vOff = 2*Vo`; output cap `Irms = sqrt(pi^2/8 − 1)*Io ~
0.48*Io`. Turn-off at magnetizing current only — the key GaN win.

**CLLC** (bidirectional 800 V rack IBC): symmetric tank `Lr2 = Lr1/n^2`,
`Cr2 = n^2*Cr1` makes forward/reverse gains coincide; recommended model:
CLLC-DCX at fn ~ 1, LLC-at-resonance equations applied per direction,
n ~ 16:1 matrix transformer.
[Huang, TI SLUP263; Fang et al., IEEE TPEL 27(4) 2012; Steigerwald, IEEE TPEL
1988; TI TIDUEG2C; Navitas 500 kHz GaN+SiC OBC literature]

### T3. Dual active bridge (SPS; TPS as RG)

`d = n*V2/V1`, phi = phase shift, L = total series inductance, w = 2pi*fs:

    P = V1*V2'*phi*(1 − |phi|/pi) / (2*pi*fs*L),   max at phi = pi/2
    i(0)   = −(V1/(4*pi*fs*L)) * [ pi*(1−d) + 2*d*phi ]      (cusp currents)
    i(phi) =  (V1/(4*pi*fs*L)) * [ 2*phi − pi*(1−d) ]
    I_Lrms^2 = (1/(3pi)) * [ phi*(i0^2 + i0*i1 + i1^2)
                           + (pi−phi)*(i1^2 − i1*i0 + i0^2) ]

(per-segment PWL identity `Irms^2 = (ia^2 + ia*ib + ib^2)/3`; switch
`Irms = I_Lrms/sqrt(2)`, `iOff` = cusp values). **ZVS boundaries:** primary
`phi > (pi/2)*(1 − 1/d)` (binds d > 1); secondary `phi > (pi/2)*(1 − d)`
(binds d < 1); at d = 1 both bridges have ZVS for any phi > 0 — the argument
for choosing n so d stays near 1. Polarity is necessary, not sufficient:
refine with the D9 charge criterion, margin `i_cusp*t_dead / (2*Qoss)`.
Sizing: `phi_rated ~ 20–35 deg`. RG: triple-phase-shift minimum-RMS
modulation (Krismer & Kolar closed-form trajectories).
[Kheraluwala, Gascoigne, Divan, Baumann, IEEE Trans. Ind. Appl. 28(6) 1992;
Krismer & Kolar, IEEE TPEL 27(1) 2012; cusp/RMS derived first-principles,
checked at the d = 1 limit]

### T4. Phase-shifted full bridge

    dD = 4*fs*Lr_tot*(Io/n) / Vin;   Deff = D − dD;   Vo = (Vin/n)*Deff
    Lagging-leg ZVS: 0.5*Lr_tot*Ip^2 >= 0.5*C_leg*Vin^2,
    C_leg ~ 2*Coss_eff(charge-equiv) + C_xfmr  =>  Ip_min = Vin*sqrt(C_leg/Lr_tot)

ZVS typically lost below ~30–50% load; raising Lr_tot extends it but grows dD
and SR ringing — the fundamental PSFB tradeoff. Primary current is
quasi-continuous (freewheel circulates full reflected current):
`Ip_rms ~ Io/n` — the circulating-current penalty vs DAB/LLC. SR
`vOff = 2*Vin/n` (CT) + 30–50% ringing margin; output choke at 2*fs effective
ripple frequency.
[TI SLUA107; TI TIDU248; Infineon DN 2013-01; dD derived from commutation slew]

### T5. Totem-pole PFC

CCM closed-form set over the line cycle (`Im = sqrt(2)*Pin/Vac_rms`):

    fast leg (active):  Irms = Im * sqrt(1/2 − 4*Vm/(3*pi*Vbus))
    fast leg (SR):      Irms = Im * sqrt(4*Vm/(3*pi*Vbus)),  Iavg = Po/Vbus
    slow leg:           Irms = Im/2,  Iavg = Im/pi   (line-frequency Si/GaN)
    inductor:           dI_pp,max = Vbus/(4*L*fs) at Vac_inst = Vbus/2
    bus cap:            I_2fline = Io/sqrt(2);  dVbus_pp = Po/(2*pi*f_line*C*Vbus)
    hold-up:            C >= 2*Po*t_hold / (Vbus^2 − Vmin^2)   (usually binds)

(check: fast-leg squares sum to Im^2/2). CCM is viable at high fsw only
because GaN has Qrr = 0; CrM gives free ZVS when `Vac_inst < Vbus/2`
(`Irms = Im*sqrt(2/3)`, ~+15%, 2x peak, 3–10x fsw spread); TCM extends
full-range ZVS with programmed negative current; kW-scale practice is
multimode CCM/TCM with >= 2-phase interleave above ~1.5 kW. iTHD handles:
zero-crossing spike (slow-leg reversal charging fast-node Coss), DCM near
zero-cross, current-loop phase lag, X-cap displacement
`phi_disp = atan(2pi*f_line*Cx*Vac^2/P)` (dominates PF at light load).
[Erickson & Maksimovic ch. 18; onsemi AND8123; TI TIDUET7; Infineon 2.5 kW
CoolGaN AN; IEEE/VDE 2020 (ieeexplore 9178001)]

### T6. Multilevel, switched-capacitor, and 48 V / 800 V datacenter stages

**FCML buck (N-level):** device stress `Vin/(N−1)` (+ cap ripple), node
effective frequency `(N−1)*fs`, inductor ripple `dI_max =
Vin/(4*L*fs*(N−1)^2)` — inductance shrinks (N−1)^2; flying caps
`C_fly >= Io/(fs*(N−1)*dVc_pp)`; natural balancing is slow/load-dependent —
active balancing is a control requirement flagged by the engine.
[Meynard & Foch, PESC 1992; Liao et al., IEEE TPEL 2018; UCB EECS-2019-35]

**SC fundamentals (sizes any hybrid stage):** `Vo = M*Vin − Rout*Io`,
`R_SSL = SUM a_ci^2/(C_i*fs)`, `R_FSL = 2*SUM R_i*a_ri^2`,
`Rout ~ sqrt(R_SSL^2 + R_FSL^2)`; efficiency cap `eta <= Vo/(M*Vin)`; escapes:
soft charging via series inductor, resonant operation (switched-tank),
split-phase Dickson control. [Seeman & Sanders, IEEE TPEL 23(2) 2008]

**48 V→PoL frontier:** hybrid Dickson (soft-charged SC ladder + small
inductors; Berkeley Dickson-squared 48 V→1 V measured 93.8% peak,
360 W/in^3, APEC 2022); sigma converter (DCX carries bulk power in
input-series output-parallel); coupled-inductor multiphase
(`L_tr = L(1−alpha)`, `L_ss = L(1−alpha^2)/(1 − alpha*D/(1−D))`, FoM
`(1+alpha)/(1−alpha)` at D = 0.5, matching Wong TPEL 2001). **800 VDC
direction** (NVIDIA Kyber-class, OCP): two-stage 800 V→50 V CLLC/DAB +
hybrid 48 V→PoL; −45% copper, ~+5% end-to-end efficiency — the catalog
additions this drives are FCML buck (P1), LLC-DCX IBC (P1), CLLC (P1),
coupled-inductor multiphase and hybrid Dickson (P2), sigma/switched-tank/TLVR
(P3). Note: `TopologyId` in types.ts is a frozen closed union — additions
require a coordinated contract revision (TECHPLAN §it6).

### T7. Unified ZVS accounting in the topology engine

Every topology's operating points emit, per transition: available commutation
current I0, dead time t_dt, and node voltage — the loss engine then applies
D9's charge criterion (current-source-like transitions: LLC, DAB, TCM, buck SR
edge) or energy integral (resonant/energy-limited: PSFB lagging leg). The
frozen boolean `op.zvs` is kept as the thresholded shortcut; the continuous
margin is reported in notes.

---

## 4. Control

### C1. Averaged small-signal models

State-space averaging under the small-ripple approximation; canonical CCM
plants (voltage mode):

    buck:   Gvd(s) = Vin * 1 / (1 + s/(Q*w0) + s^2/w0^2),  w0 = 1/sqrt(L*C)
    boost:  Gvd(s) = (Vo/(1−D)) * (1 − s/w_rhpz) / (1 + s/(Q*w0') + s^2/w0'^2)
            w_rhpz = (1−D)^2 * R / L      (RHP zero — crossover <= w_rhpz/4)

plus the ESR zero `w_esr = 1/(Resr*C)`. Validity: below ~fsw/5; sampled-data
effects and the modulator delay dominate above.
[Erickson & Maksimovic ch. 8–9; Ridley for sampled-data extensions]

### C2. Current-mode control

Peak current mode adds the inner loop pole-splitting: first-order-ish outer
plant `Gvc(s) ~ R/(1 + s*R*C)` with the RHP zero retained for boost-derived
stages; sub-harmonic instability for D > 0.5 requires slope compensation
`Se >= 0.5*Sf` (Sf = inductor down-slope reflected to the sense network).
v1 uses this family for boost/flyback; v2 adds the sampling-gain term
`He(s) ~ 1 + s/(wn*Qz) + s^2/wn^2`, `wn = pi*fsw` where crossover > fsw/10.
[Ridley, IEEE TPEL 6(2) 1991; Erickson & Maksimovic ch. 12]

### C3. Compensator synthesis and digital effects

Type-2/Type-3 by K-factor phase-boost placement (v1); PI for
resonant/PFC plants. Digital realization: bilinear (Tustin) at `sampleHz =
fsw` with crossover gain matching (v1) — v2 adds the computation + PWM-update
delay `e^(−s*Td)`, `Td ~ 1–1.5 * Tsw`, which costs `360*fc*Td` degrees of
phase at crossover and binds achievable bandwidth in the 100 kHz–MHz range;
verify phase margin including delay, not just the analog prototype.

### C4. Resonant and PFC control plants

LLC: charge/power control — first-order-ish plant near resonance; frequency
control gain flips sign across fn = 1 (guard the operating window per T2).
DAB: power is ~linear in phi (T3), plant ~ static gain + output-cap pole —
PI adequate; feed-forward `phi(P, V1, V2)` from the T3 closed form. PFC:
average-current-mode inner loop on `Vout/(s*L)`, outer voltage loop crossover
<= 10–20 Hz to avoid 2*f_line ripple injection (UC3854 practice, v1). RG:
sampled-data LLC models (trajectory control), TPS modulation for DAB.

---

## 5. Thermal

### H1. JESD51 semantics — what a datasheet Rth may be used for

`theta_JA` (JESD51-2A still air / 51-7 test board) is a package-comparison
metric — **never a design value**; v2 computes junction-to-ambient from
geometry. Usable network elements: `theta_JB` (JESD51-8) and `theta_JC` from
the JESD51-14 transient dual-interface method. `psi_JT`/`psi_JB` are
characterization parameters, valid only for inferring Tj from a measured
reference temperature. GaN CSP nuance: EPC's RthJC is to the **top** of the
die (top-side heatsink face), RthJB to the solder bumps — opposite faces,
i.e. the two parallel branches of the network.
[JEDEC JESD51-8/-14; TI SPRA953; EPC datasheet notes]

### H2. Thermal resistance network (replaces the single ladder)

Solve `G * T = P` over nodes {junction_i, case_i, board_top, board_bottom,
sink, ambient} — a small dense linear solve. Package classes populate
branches differently: chip-scale GaN (EPC/Navitas): `RthJB ~ 1–2 K/W` through
bumps into top copper, lateral spreading (Song/Lee/Au closed form), thermal-via
array `R_via = rho_th*L/(pi*(d+t_pl)*t_pl)` (~166 K/W for an 8-mil via, 25 um
plating, 47-mil board; N in parallel), then convection+radiation
`R_BA = 1/(h_eff*A)`, `h_eff ~ 12–16 W/m^2K` natural. Bottom-cooled PQFN:
junction→DAP (~0.5) → via array (2–2.3 measured) → TIM (3.2–5.5 K/W measured
incl. contact resistance — not bulk BLT/kA) → sink; TI's calibrated ladders
total 9.2 and 16.4 K/W at 400 LFM. Top-cooled: RthJC(top) ~ 0.5 K/W → TIM →
sink, board path as a parallel 10–30% branch. Two-resistor compact models
carry ~20–30% Tj error; DELPHI (JESD15-4) is RG.
**Calibration anchors:** EPC2218 RthJA = 53 K/W on 1 in^2 2 oz Cu;
EPC2218 RthJB = 1.4 K/W. v1: single `RthJC + 0.5` into a shared sink,
paralleled dies divide Rth — wrong on a shared board (H4).
[TI SNOAA14B; EPC2218 datasheet; Song/Lee/Au spreading-resistance closed form]

### H3. Transient: Foster networks and 100/120 Hz ripple

Fit 3–5 term Foster networks to vendor Zth curves:

    Zth(t) = SUM ri * (1 − exp(−t/taui));   Zth(jw) = SUM ri / (1 + jw*taui)
    PFC ripple:  dTj_pp ~= 2 * P_avg * |Zth(j*2*w_line)|

Board/heatsink time constants (> 1 s) filter the 100/120 Hz pulsation — only
the device Zth responds. Overload/transient: closed-form periodic-pulse
formula or O(N) exponential state-update convolution. v1: steady state only.
[Vendor Zth r/tau tables (Infineon), EPC Zth JB/JC families]

### H4. Multi-die coupling; magnetics and capacitor thermal closure

Superposition matrix `dTj_i = SUM_j Rth_ij * Pj`; EPC FEA for adjacent CSP
half-bridge FETs: self 32.9 K/W, mutual 22.4 K/W (coupling ~0.68),
superposition accurate to ~6% — **n parallel dies on a shared board do not
divide Rth by n** (v1 assumption). Magnetics use M8's Rth correlation;
capacitors close their own electro-thermal loop (P4). All temperature-dependent
losses (D1, M1 CT, P2 ESR) are evaluated inside `iterateThermal`'s fixed point.

---

## 6. EMI and layout

### E1. Noise sources and separation

Differential-mode source: the pulsating input/output current (trapezoid,
spectral envelope flat to `f1 = 1/(pi*t_pulse)` then −20 dB/dec, −40 dB/dec
above `f2 = 1/(pi*t_rise)`). Common-mode source: `dv/dt` at switch nodes
driving parasitic capacitance to earth (heatsink, transformer interwinding,
planar P-S overlap `C = eps0*epsr*A/d` — nF-scale in interleaved planars,
traded against M6 leakage). Estimate: `I_cm = C_par * dv/dt`;
`V_cm(LISN) = I_cm * 25 ohm`.

### E2. Limits and pre-compliance estimate

CISPR 32 / EN 55032 conducted limits, 150 kHz–30 MHz, at the 50 ohm/50 uH
LISN: Class B QP 66 dBuV falling to 60 dBuV (150–500 kHz), 56 dBuV
(0.5–5 MHz), 60 dBuV (5–30 MHz); Class A +13 dB, approx. First-harmonic
design method: compute the worst DM and CM harmonic amplitude in-band at the
LISN, compare against the limit, and size total required attenuation
`Att_dB(f) = V_noise_dB(f) − Limit_dB(f) + 6 dB margin`. Fundamental fsw
below 150 kHz keeps the first in-band harmonic higher-order — the classic
65/140 kHz PFC choice. This is a *pre-check*, +/-10 dB honest accuracy: layout
parasitics dominate above ~5 MHz (RG: measured scans).

### E3. Filter design equations

Required corner for −40 dB/dec two-element stage:
`f_c = f_noise * 10^(−Att_dB/40)`. DM: `f_c = 1/(2pi*sqrt(Ldm*Cx))`; CM:
`1/(2pi*sqrt(Lcm*Cy_total))`; Cy capped by leakage current (e.g. <= 3.5 mA at
230 V/50 Hz: `Cy_total <= I_leak/(2pi*f_line*V) ~ 47 nF`). Damping: parallel
`Rd + Cd`, `Cd ~ 4*Cx`, `Rd ~ sqrt(Ldm/Cx)` to kill the filter resonance the
control loop sees (output impedance interaction — Middlebrook criterion
`|Z_out,filter| << |Z_in,converter|`). CM chokes: use `mu(f)` roll-off of
nanocrystalline/MnZn; leakage of the CM choke doubles as Ldm.
[CISPR 32; Erickson & Maksimovic input-filter chapter; standard EMC practice]

### E4. Layout physics the engine enforces

Power-loop inductance: `V_overshoot = Lloop * di/dt` with di/dt from D3
(`I/t_cr`, tens of A/ns for GaN) — warn when `Lloop*di/dt > 0.2*Vbus` (D4/D10
validity); vertical loops with a return plane one dielectric below reach
0.4–2 nH. Gate loop: separate return, `Lg` with driver + Cgs forms the
resonance damped by Rg >= 1–2 ohm per die (D10 paralleling). dv/dt vs driver
CMTI and isolator ratings: `dv/dt = Vbus/t_vf` (hard) or `I/C_node` (ZVS) —
a compliance check. Thermal vias per H2. v1's `layoutGuidance` emits loop-area
rules; v2 ties the numbers to the same device model.

---

## 7. Passives and reliability

### P1. Effective capacitance of class-II MLCC

    C(V, T, t) = Cnom * fV(Vdc) * fT(T) * fA(t)
    fV = [(1+r) + (r−1)*tanh(2*(V−Vth)/Vtr)]/2,  r = Csat/C0   (4-param sigmoid)
    fallback: fV = 1/(1 + (V/V0)^m), m = 2, anchored at the rated-V derating

X5R/X7R lose 50–80% of nominal C at rated V (ferroelectric domain
saturation); C0G/film/electrolytic ~ 0. `fT`: EIA class envelopes (X7R +/-15%
over −55..125 C). Aging: `−2.5%/decade-hour` typical X7R (referenced to
1000 h). Three effective capacitances: small-signal C(Vdc) for ripple
compliance; charge-equivalent `Ceff = dQ/dV` (closed-form Q(V) from the tanh
model) for DC-link excursions and the PWL simulator (`C(v) = dQ/dv`);
energy-equivalent for hold-up. Never extrapolate past 1.2x Vrated.
[Murata SimSurfing / KEMET K-SIM / TDK SEAT data; tanh charge model per
behavioral SPICE MLCC practice]

### P2. ESR(f, T) — the canonical two-term model

Verbatim from the CDE Aluminum Electrolytic Application Guide:

    ESR(f) = tan_delta_lf / (2*pi*f*C) + R_hf(T)

Dielectric-loss term (tan_delta_lf: electrolytic 1.5–3%, X7R 1.5–2.5%, PP
film 0.02–0.05%) + frequency-flat ohmic term. Electrolyte R_hf falls 35–50%
from 25 C to rated temp and rises 10–100x at the cold limit: fit
`R_hf(T) = Ra + Rb*exp(−(T−25)/Te)` to datasheet cold-impedance ratios;
polymer/film/MLCC ~ flat. Consequence: a fixed 100 kHz ESR misses nearly all
line-frequency loss on a PFC bus (4700 uF, tan_delta 0.02 → 5.6 mOhm at
120 Hz vs 7 uOhm at 100 kHz). Validity 10 Hz–~1 MHz; above SRF use the
measured HF plateau. RG: 3–5-rung RC-ladder fitted to full Z(f).
[CDE Aluminum Electrolytic Capacitor Application Guide (equations extracted
verbatim); Panasonic OS-CON notes; EIA-198/IEC 60384 DF limits]

### P3. Harmonic-summed ripple loss with electro-thermal closure

    P_cap = SUM_h Ih_rms^2 * ESR(f_h, T_core)      (Parseval-exact, series RC)
    T_core = T_amb + P_cap * (1/(h_conv*A) + Rth_core-case)   (fixed point, 2–4 it.)

Spectra from analytic per-topology tables (10 harmonics of fsw; + 2*f_line
term `I ~ P/(sqrt(2)*Vdc)` for PFC links) or FFT of the simulator's
steady-state capacitor current. Minimum viable: 2-band (line + switching)
evaluation captures ~95%. Mixed parallel banks: divide current per harmonic
via `Z_k = ESR_k + j(w*ESL_k − 1/(w*C_k))` — LF divides by C, HF by 1/ESR;
this changes which part overheats. v1: single `Irms^2 * ESR`
(`passives.ts:107`).

### P4. Ripple ratings, self-heating, and rating checks

`I_eq = sqrt(SUM (Ih/kf(fh))^2)`, `kf = sqrt(ESR(f_rated)/ESR(fh))` — computed
from the model itself, self-consistent with vendor multiplier tables (CDE
worked value: 1.13 at 360 Hz). Pass: `I_eq <= iRms_rated * min(sqrt((Tc−Ta)/
(Tc−Tr)), 1.5)`, total multiplier capped at 2 (85 C parts) / 3 (105 C).
Thermal: `h = 9.3 W/m^2K` natural (CDE: 0.006 W/C/in^2) over the can area,
`Rth_core-case = 3–5 C/W` for cans > 25 mm else 0; MLCC is board-dominated —
check `dT_self <= 20 K` (Murata). CDE worked anchor: 76x143 mm can → 0.36 W/C,
11 A at 30 mOhm for 10 K rise.

### P5. Lifetime models

    electrolytic: Lop = (4.3 − 3.3*Va/Vr) * Lb * 2^((Tm − Tcore)/10)
    film (MKP):   L = L0 * (Va/V0)^(−n) * 2^((T0 − Ths)/10),  n ~ 7–9.6
    polymer:      L = L0 * 10^((T0 − Ta)/20)
    MLCC (P-V):   t1/t2 = (V2/V1)^n * exp((Ea/k)(1/T1 − 1/T2)), n~3, Ea~1.3 eV

Electrolytic life is temperature-dominated (Lb = 1000–20,000 h at Tm =
95–110 C per series); film is voltage-dominated (10% derating ~ 2x life); do
not extrapolate electrolytic life below ~40 C core (cap at 15 y); report the
aged 2x-ESR operating point. Semiconductor reliability handled as compliance
rules (D2 dynamic Rds(on) derating, GaN transient-Vds allowance vs SiC
avalanche rating, SiC body-diode conduction time). RG: Weibull spread +
Miner's-rule mission profiling over the load sweep.
[CDE App Guide (verbatim); Wang & Blaabjerg, IEEE Trans. Ind. Appl. 50(5)
2014; Panasonic OS-CON; NASA NEPP CARTS 2014]

---

## 8. Numerical methods

### N1. PWL state-space simulation and exact discretization

Each switching interval is LTI: `x' = A_k x + B_k u`. v1 integrates
semi-implicit Euler at fixed step; v2 target: **exact discretization** per
interval, `x(t+dt) = e^(A_k dt) x + A_k^-1 (e^(A_k dt) − I) B_k u` (matrix
exponential via scaling-and-squaring on the 2x2–6x6 blocks), which removes
step-size ripple error and makes waveform-derived quantities (RMS, FFT for P3
spectra) trustworthy at ~100 samples/period.

### N2. Steady state by shooting

Instead of settling over >= 6 periods, solve `x(T) = x(0)` with Newton on the
period map: `Phi = product of e^(A_k dt_k)`; Jacobian `dx(T)/dx(0) = Phi`;
converges in 2–4 iterations for stiff LLC/DAB tanks where time-stepping needs
hundreds of periods. State-dependent switching instants (DCM boundaries,
diode conduction) located by bisection/Brent on the switching functions.

### N3. Fixed-point loops and guards

Electro-thermal (`iterateThermal`, v1): losses(Tj) ↔ Tj(losses); converges
because dP/dTj > 0 but dTj/dP bounded (`|dP/dT * Rth| < 1` in practice);
guards: max 10 iterations + divergence detection (v1 has the cap; v2 adds a
divergence flag surfaced as a warning). Same pattern: magnetics hot-spot
(M8), capacitor core temperature (P3), gapped-powder `L(Ipk)` (M4). All v2
solvers keep the never-throw contract: infeasibility is a scored penalty +
warning, never an exception.

### N4. Optimization and calibration metrics

Candidate sweep: log-spaced fsw grid x device shortlist (Rds*Qg FoM cap),
Pareto front on (efficiency, cost, density) — v1 structure retained. v2 adds
calibration metrics: for each anchor design (§A), reproduce the published
operating point and assert `|eta_model − eta_measured|` within the gate
(1.5% at it8 entry, tightening to 0.5% per GOAL.md trust loop before public
accuracy claims), plus per-mechanism sanity partitions (no single fudge
factor absorbing >30% of total loss).

---

## A. Calibration anchor table

Published, measured reference designs and component-level ground truths the
model is calibrated against. Headline efficiencies are as published by the
vendor; each is re-verified from the cited document at ingestion (it8).
`ti66.pdf` and `wolf66.pdf` in the repo root are local copies of anchors A4/A5.

| # | Anchor | Specs | Devices | Measured result (published) | Source URL |
|---|--------|-------|---------|------------------------------|------------|
| A1 | TI TIDA-010062 (TIDUET7) GaN CCM totem-pole PFC | 1 kW, 230 Vac→390 V, 100 kHz CCM | TI LMG3410R070 GaN | ~98.8% peak, 80 Plus Titanium curve | ti.com/lit/ug/tiduet7g/tiduet7g.pdf |
| A2 | Infineon 2500 W CCM totem-pole PFC | 2.5 kW, 230 Vac→400 V | CoolGaN IGT60R070D1 + CoolMOS slow leg | 99.2% peak | infineon.com (EVAL_2500W_PFC_GAN) |
| A3 | TI PMP23537 multimode totem-pole PFC | 3.6 kW, CCM+TCM | LMG3522R030 GaN | ~99% peak | ti.com/tool/PMP23537 (TIDT439) |
| A4 | TI TIDA-010054 CLLLC bidirectional DAB | 6.6 kW, 400 V↔250–450 V, 200–800 kHz | SiC FETs, ISO drivers | ~98% peak DC-DC | ti.com/lit/ug/tidueg2c/tidueg2c.pdf (repo: ti66.pdf) |
| A5 | Wolfspeed CRD-06600FF10N bidirectional CLLC | 6.6 kW, 380–800 V | Wolfspeed C3M SiC | ~98.5% peak (verify at ingestion) | wolfspeed.com reference designs (repo: wolf66.pdf) |
| A6 | EPC9143 16th-brick IBC | 48 V→12 V, 300 W, multiphase sync buck | EPC2053 eGaN | 96.6% peak | epc-co.com/epc/epc9143 |
| A7 | TI UCC28950 600 W PSFB EVM (TIDU248 method) | 390 V→12 V, 600 W | Si SJ primary + SR | ~95% peak (verify) | ti.com/lit/ug/tidu248/tidu248.pdf |
| A8 | Berkeley Dickson-squared 48 V→1 V | 48 V→1 V, 9:1 SC + 9-phase buck | 25 V-class Si FETs | 93.8% peak, 360 W/in^3 | APEC 2022 (Pilawa group) |
| A9 | Princeton MagNet database | 50–500 kHz, 10–300 mT, sine/tri/trap | N27/N30/N49/N87/3C90/3C94/3F4/77/78 | raw measured core-loss waveforms | minjiechen.github.io/magnet |
| A10 | TDK/Ferroxcube datasheet loss anchors | table in §M1 | N87/N97/N49/3C95/3C97/3F36 | Pv anchor points, 100 C | tdk-electronics.tdk.com, ferroxcube.com |
| A11 | ETH N87 DC-bias (SPG) measurements | R42 toroid, 100 kHz, 40/80 C | N87 | 2x @ 30–40 A/m, 3–3.5x @ 60–70 A/m | ieeexplore.ieee.org/document/5936124 |
| A12 | EPC2053 / EPC2218 device curves | Coss/Qoss/Eoss, RthJA/RthJB | EPC2053, EPC2218 | Qoss/Eoss tables; RthJA 53 K/W @1 in^2 2 oz; RthJB 1.4 K/W | epc-co.com datasheets |
| A13 | CDE electrolytic worked example | 4700 uF class, 76x143 mm can | Al electrolytic | 0.36 W/C conductance; 11 A @ 30 mOhm/10 K; 360 Hz multiplier 1.13 | cde.com/resources/catalogs (App Guide) |
| A14 | TI SNOAA14B calibrated thermal ladders | bottom-cooled QFN @ 400 LFM | LMG-class GaN | 9.2 / 16.4 K/W measured stacks | ti.com/lit/an/snoaa14b/snoaa14b.pdf |

Calibration gates: device-level (A12) golden numbers within 5%; magnetics
(A9–A11) iGSE within 15% of measured sine/tri points inside the fit band;
thermal (A12/A14) within 20%; system efficiency (A1–A8) within 1.5% absolute
at it8 (path to 0.5% per GOAL.md before public accuracy claims).

---

## Source register (primary references)

Erickson & Maksimovic, *Fundamentals of Power Electronics*, 3rd ed. —
Graovac/Purschel/Kiep, Infineon AN 2006-07 — Kasper/Burkart/Deboy/Kolar, IEEE
TPEL 31(12) 2016 (DOI 10.1109/TPEL.2016.2574998) — Zulauf et al., IEEE TPEL
33(12) 2018 — JEDEC JEP173/JEP180, JESD51-8/-14, JESD15-4 — TI SNOAA36,
SLUP263, SLUA107, TIDU248, SPRA953, SNOAA14B — GaN Systems GN001/GN012 —
Venkatachalam et al., COMPEL 2002 — Muhlethaler et al., IPEC 2010 / TPEL 27(2)
2012 — Dowell, Proc. IEE 113(8) 1966 — Ferreira, TPEL 9(1) 1994 — Sullivan,
TPEL 16(1) 2001 / TPEL 14(2) 1999 — Sullivan & Zhang, APEC 2014 — Hu &
Sullivan, TPEL 16(4) 2001 — McLyman, *Transformer and Inductor Design
Handbook*, 4th ed. — Hurley & Wolfle, *Transformers and Inductors for Power
Electronics*, Wiley 2013 — Snelling, *Soft Ferrites*, 2nd ed. — Kheraluwala et
al., IEEE Trans. Ind. Appl. 28(6) 1992 — Krismer & Kolar, TPEL 27(1) 2012 —
Fang et al., TPEL 27(4) 2012 — Steigerwald, TPEL 1988 — Seeman & Sanders,
TPEL 23(2) 2008 — Meynard & Foch, PESC 1992 — Wong et al., TPEL 2001 —
Ridley, TPEL 6(2) 1991 — Wang & Blaabjerg, IEEE Trans. Ind. Appl. 50(5) 2014
— CDE Aluminum Electrolytic Capacitor Application Guide — CISPR 32 / EN 55032
— IEC 62368-1 — vendor datasheets and tools as cited inline (TDK, Ferroxcube,
EPC, Infineon, Wolfspeed, onsemi, Murata SimSurfing, KEMET K-SIM).
