/**
 * Per-topology electrical stress math.
 *
 * operatingPoints() turns (topology, spec, fsw) into the switch stresses,
 * magnetic requirements and cap RMS current that the loss / magnetics /
 * thermal engines price. First-cut stress math assumes a lossless power stage
 * (standard practice for component selection); loss engines close the loop.
 *
 * Conventions:
 *  - inductanceUh in µH, voltSecondsVus in V·µs.
 *  - acFluxFraction: 1.0 for full bipolar excitation (transformers),
 *    (ΔI/2)/Ipk for DC-biased chokes.
 *  - Ripple ratios: 30 % p-p on chokes, 40 % on flyback (industry defaults).
 */

import type {
  DesignSpec,
  MagneticRequirement,
  SwitchOperatingPoint,
  TopologyId,
  TopologyOperatingPoints,
} from "@/lib/types";
import { clamp, roundSig } from "@/lib/util";

const DEAD_TIME_S = 40e-9; // typical GaN half-bridge dead time

/** Fraction of the period spent in reverse conduction (2 dead times/period). */
function deadFrac(fswHz: number): number {
  return clamp(2 * DEAD_TIME_S * fswHz, 0, 0.1);
}

const uH = (h: number) => h * 1e6;
const Vus = (vs: number) => vs * 1e6;

// ---------------------------------------------------------------------------
// Buck family
// ---------------------------------------------------------------------------

function buckFamily(
  id: TopologyId,
  spec: DesignSpec,
  fsw: number,
  phases: number,
  synchronous: boolean,
): TopologyOperatingPoints {
  const D = clamp(spec.voutV / spec.vinNomV, 0.02, 0.98);
  const ioutTotal = spec.poutW / spec.voutV;
  const iPh = ioutTotal / phases;
  const dI = 0.3 * iPh; // 30 % p-p ripple per phase
  const L = (spec.voutV * (1 - D)) / (fsw * dI); // H
  const iLrms = Math.sqrt(iPh * iPh + (dI * dI) / 12);
  const iPk = iPh + dI / 2;
  const iValley = iPh - dI / 2;

  const switchPoints: SwitchOperatingPoint[] = [
    {
      role: "buck-hs",
      positions: phases,
      vOffV: spec.vinMaxV,
      iRmsA: iLrms * Math.sqrt(D),
      iAvgA: iPh * D,
      iOnA: iValley,
      iOffA: iPk,
      fswHz: fsw,
      dutyEff: D,
      zvs: false,
      deadTimeFrac: 0,
    },
  ];
  if (synchronous) {
    switchPoints.push({
      role: "sr",
      positions: phases,
      vOffV: spec.vinMaxV,
      iRmsA: iLrms * Math.sqrt(1 - D),
      iAvgA: iPh * (1 - D),
      // SR commutates on its body diode: effectively zero-voltage transitions.
      iOnA: iPk,
      iOffA: iValley,
      fswHz: fsw,
      dutyEff: 1 - D,
      zvs: true,
      deadTimeFrac: deadFrac(fsw),
    });
  }

  const magReq: MagneticRequirement = {
    role: "output-inductor",
    inductanceUh: uH(L),
    iPeakA: iPk,
    iRmsA: iLrms,
    voltSecondsVus: Vus((spec.voutV * (1 - D)) / fsw),
    acFluxFraction: dI / 2 / iPk,
    fswHz: fsw,
  };
  const magnetics = Array.from({ length: phases }, () => ({ ...magReq }));

  // Output cap sees the triangular ripple; 2-phase interleave cancels toward D=0.5.
  const cancel = phases === 2 ? Math.abs(1 - 2 * D) : 1;
  const capRmsA = ((dI / Math.sqrt(12)) * cancel * phases) / phases;

  const notes = [
    `CCM ${synchronous ? "synchronous " : ""}buck, D = Vout/Vin = ${roundSig(D, 3)} at nominal line.`,
    `Per-phase inductor ${roundSig(uH(L))} µH for 30 % p-p ripple (${roundSig(dI)} A).`,
  ];
  if (phases === 2) {
    notes.push(
      `Two phases 180° apart: per-phase current halved, output ripple cancelled by |1-2D| = ${roundSig(cancel, 2)}.`,
    );
  }
  if (synchronous) {
    notes.push("SR transitions ride the body diode → counted as ZVS; dead-time Vsd loss applies.");
  } else {
    notes.push("Freewheel diode not modeled as a switch position; add its conduction loss separately.");
  }
  return { topologyId: id, switchPoints, magnetics, capRmsA, notes };
}

// ---------------------------------------------------------------------------
// Boost
// ---------------------------------------------------------------------------

function boost(spec: DesignSpec, fsw: number): TopologyOperatingPoints {
  const D = clamp(1 - spec.vinNomV / spec.voutV, 0.02, 0.98);
  const iin = spec.poutW / spec.vinNomV;
  const iout = spec.poutW / spec.voutV;
  const dI = 0.3 * iin;
  const L = (spec.vinNomV * D) / (fsw * dI);
  const iLrms = Math.sqrt(iin * iin + (dI * dI) / 12);
  const iPk = iin + dI / 2;

  const switchPoints: SwitchOperatingPoint[] = [
    {
      role: "boost-ls",
      positions: 1,
      vOffV: spec.voutV,
      iRmsA: iLrms * Math.sqrt(D),
      iAvgA: iin * D,
      iOnA: iin - dI / 2,
      iOffA: iPk,
      fswHz: fsw,
      dutyEff: D,
      zvs: false,
      deadTimeFrac: 0,
    },
    {
      role: "sr",
      positions: 1,
      vOffV: spec.voutV,
      iRmsA: iLrms * Math.sqrt(1 - D),
      iAvgA: iout,
      iOnA: iPk,
      iOffA: iin - dI / 2,
      fswHz: fsw,
      dutyEff: 1 - D,
      zvs: true,
      deadTimeFrac: deadFrac(fsw),
    },
  ];

  return {
    topologyId: "boost",
    switchPoints,
    magnetics: [
      {
        role: "output-inductor",
        inductanceUh: uH(L),
        iPeakA: iPk,
        iRmsA: iLrms,
        voltSecondsVus: Vus((spec.vinNomV * D) / fsw),
        acFluxFraction: dI / 2 / iPk,
        fswHz: fsw,
      },
    ],
    // CCM boost: cap current is chopped rectifier current minus DC.
    capRmsA: iout * Math.sqrt(D / (1 - D)),
    notes: [
      `CCM boost, D = 1 - Vin/Vout = ${roundSig(D, 3)} at nominal line.`,
      `Energy-transfer choke ${roundSig(uH(L))} µH (30 % p-p of ${roundSig(iin)} A input current).`,
      "Output cap takes the full discontinuous rectifier current — dominant stress in a boost.",
      "RHP zero limits control bandwidth; see control module.",
    ],
  };
}

// ---------------------------------------------------------------------------
// DAB
// ---------------------------------------------------------------------------

function dab(spec: DesignSpec, fsw: number): TopologyOperatingPoints {
  const V1 = spec.vinNomV;
  const n = spec.vinNomV / spec.voutV; // matched bridges: V2' = n·Vout = V1
  const phi = Math.PI / 6; // 30° nominal phase shift at rated power
  const delta = phi / Math.PI;
  // P = V1²·φ(1-φ/π)/(2π·fsw·L)  → series inductance for rated power at φ=30°
  const L = (V1 * V1 * phi * (1 - phi / Math.PI)) / (2 * Math.PI * fsw * spec.poutW);
  const iPk = (V1 * phi) / (2 * Math.PI * fsw * L); // = 1.2·P/V1 at φ=30°
  const iRmsTank = iPk * Math.sqrt(1 - (2 * delta) / 3); // trapezoid RMS
  const iout = spec.poutW / spec.voutV;
  const dtf = deadFrac(fsw);

  const primary: SwitchOperatingPoint = {
    role: "primary-fb",
    positions: 4,
    vOffV: spec.vinMaxV,
    iRmsA: iRmsTank / Math.SQRT2,
    iAvgA: spec.poutW / V1 / 2,
    iOnA: iPk, // commutated with ZVS — loss engine ignores turn-on
    iOffA: iPk,
    fswHz: fsw,
    dutyEff: 0.5,
    zvs: true,
    deadTimeFrac: dtf,
  };
  const secondary: SwitchOperatingPoint = {
    role: "secondary-fb",
    positions: 4,
    vOffV: spec.voutV,
    iRmsA: (n * iRmsTank) / Math.SQRT2,
    iAvgA: iout / 2,
    iOnA: n * iPk,
    iOffA: n * iPk,
    fswHz: fsw,
    dutyEff: 0.5,
    zvs: true,
    deadTimeFrac: dtf,
  };

  const magnetics: MagneticRequirement[] = [
    {
      role: "transformer",
      inductanceUh: uH(10 * L), // magnetizing ≈ 10× series L: bounded circulating current, light-load ZVS help
      iPeakA: iPk,
      iRmsA: iRmsTank,
      voltSecondsVus: Vus(V1 / (2 * fsw)), // full square-wave excitation
      turnsRatio: n,
      acFluxFraction: 1,
      fswHz: fsw,
    },
    {
      role: "resonant-inductor",
      inductanceUh: uH(L),
      iPeakA: iPk,
      iRmsA: iRmsTank,
      voltSecondsVus: Vus((V1 * phi) / (Math.PI * fsw)), // 2·V1 across L for φ/(2π) of the period
      acFluxFraction: 1,
      fswHz: fsw,
    },
  ];

  return {
    topologyId: "dab",
    switchPoints: [primary, secondary],
    magnetics,
    // secondary trapezoid rectified: rms ≈ 1.13·Iout → cap rms ≈ 0.53·Iout
    capRmsA: 0.53 * iout,
    notes: [
      `Phase-shift modulated DAB, φ = 30° at rated power; n = Vin(nom)/Vout = ${roundSig(n, 3)}:1 keeps bridges voltage-matched.`,
      `Series inductance ${roundSig(uH(L))} µH sets rated power; tank Ipk = ${roundSig(iPk)} A, Irms = ${roundSig(iRmsTank)} A.`,
      "Matched voltages + inductive tank current at every transition → ZVS on both full bridges.",
      "Magnetizing inductance target = 10× series L (integrate or discrete shim inductor).",
    ],
  };
}

// ---------------------------------------------------------------------------
// LLC (half / full bridge), at-resonance design point
// ---------------------------------------------------------------------------

function llc(spec: DesignSpec, fsw: number, full: boolean): TopologyOperatingPoints {
  const vBridge = full ? spec.vinNomV : spec.vinNomV / 2; // tank drive amplitude
  const n = vBridge / spec.voutV;
  const iout = spec.poutW / spec.voutV;
  // Secondary full-wave rectified sine: Irms = (π/2√2)·Iout ≈ 1.11·Iout
  const iSecRms = (Math.PI / (2 * Math.SQRT2)) * iout;
  const iPriLoadRms = iSecRms / n;
  const iPriLoadPk = ((Math.PI / 2) * iout) / n;
  // Magnetizing peak = 25 % of reflected load peak (ZVS energy vs circulating loss)
  const iMagPk = 0.25 * iPriLoadPk;
  const Lm = vBridge / (4 * iMagPk * fsw); // Im_pk = Vbridge·T/(4·Lm)
  const Lr = Lm / 5; // Ln = Lm/Lr = 5, typical 3-7
  const Cr = 1 / ((2 * Math.PI * fsw) ** 2 * Lr); // resonance at fsw
  const iPriRms = Math.sqrt(iPriLoadRms ** 2 + (iMagPk ** 2) / 3);
  const dtf = deadFrac(fsw);

  const priPositions = full ? 4 : 2;
  const srPositions = full ? 4 : 2; // full-bridge rect vs center-tap
  const srVoff = full ? spec.voutV : 2 * spec.voutV;

  const switchPoints: SwitchOperatingPoint[] = [
    {
      role: "primary-llc",
      positions: priPositions,
      vOffV: spec.vinMaxV,
      iRmsA: iPriRms / Math.SQRT2,
      iAvgA: 0.64 * (iPriRms / Math.SQRT2), // half-sine conduction: avg ≈ (2/π)·rms
      iOnA: 0, // ZVS
      iOffA: iMagPk, // turns off at magnetizing current only — the LLC party trick
      fswHz: fsw,
      dutyEff: 0.5,
      zvs: true,
      deadTimeFrac: dtf,
    },
    {
      role: "sr",
      positions: srPositions,
      vOffV: srVoff,
      iRmsA: (Math.PI / 4) * iout, // half-sine, half the period
      iAvgA: iout / 2,
      iOnA: 0,
      iOffA: 0, // ZCS-ish at resonance
      fswHz: fsw,
      dutyEff: 0.45,
      zvs: true,
      deadTimeFrac: dtf,
    },
  ];

  return {
    topologyId: full ? "llc-full-bridge" : "llc-half-bridge",
    switchPoints,
    magnetics: [
      {
        role: "transformer",
        inductanceUh: uH(Lm),
        iPeakA: iPriLoadPk + iMagPk,
        iRmsA: iPriRms,
        voltSecondsVus: Vus(vBridge / (2 * fsw)),
        turnsRatio: n,
        acFluxFraction: 1,
        fswHz: fsw,
      },
      {
        role: "resonant-inductor",
        inductanceUh: uH(Lr),
        iPeakA: iPriLoadPk + iMagPk,
        iRmsA: iPriRms,
        voltSecondsVus: Vus(0.3 * (vBridge / (2 * fsw))), // small AC volt-seconds vs transformer
        acFluxFraction: 1,
        fswHz: fsw,
      },
    ],
    // rectified-sine minus DC: Iout·√(1.11²−1) ≈ 0.48·Iout
    capRmsA: 0.48 * iout,
    notes: [
      `LLC ${full ? "full" : "half"}-bridge at resonance: fr = fsw, n = ${roundSig(n, 3)}:1, Ln = Lm/Lr = 5.`,
      `Lm = ${roundSig(uH(Lm))} µH (Im_pk = 25 % of reflected load peak), Lr = ${roundSig(uH(Lr))} µH, Cr = ${roundSig(Cr * 1e9)} nF.`,
      "Primary ZVS with turn-off at magnetizing current only; SRs commutate near zero current (ZCS-ish).",
      full
        ? "Full-bridge secondary rectifier: each SR blocks Vout."
        : "Center-tapped secondary: each SR blocks 2·Vout — derate accordingly.",
    ],
  };
}

// ---------------------------------------------------------------------------
// PSFB
// ---------------------------------------------------------------------------

function psfb(spec: DesignSpec, fsw: number): TopologyOperatingPoints {
  const dEff = 0.7; // nominal effective duty (design center)
  const n = (spec.vinNomV * dEff) / spec.voutV;
  const iout = spec.poutW / spec.voutV;
  const dI = 0.3 * iout;
  const Lout = (spec.voutV * (1 - dEff)) / (2 * fsw * dI); // output ripple at 2·fsw
  const iPri = iout / n; // reflected plateau
  // conducts dEff/2 as diagonal + circulates during freewheel: rms ≈ Ipri·√((1+dEff)/4)
  const iPriRmsDev = iPri * Math.sqrt((1 + dEff) / 4);
  const dtf = deadFrac(fsw);
  // Shim/leakage inductance: commutation di/dt budget of 5 % of the half period.
  const Lr = (0.05 * spec.vinNomV) / (4 * fsw * iPri);

  const switchPoints: SwitchOperatingPoint[] = [
    {
      role: "primary-lagging",
      positions: 2,
      vOffV: spec.vinMaxV,
      iRmsA: iPriRmsDev,
      iAvgA: (iPri * dEff) / 2,
      iOnA: 0,
      iOffA: (iout + dI / 2) / n,
      fswHz: fsw,
      dutyEff: 0.5,
      zvs: true, // ZVS from output-inductor energy
      deadTimeFrac: dtf,
    },
    {
      role: "primary-leading",
      positions: 2,
      vOffV: spec.vinMaxV,
      iRmsA: iPriRmsDev,
      iAvgA: (iPri * dEff) / 2,
      iOnA: iPri,
      iOffA: (iout + dI / 2) / n,
      fswHz: fsw,
      dutyEff: 0.5,
      zvs: false, // only leakage energy — drops out of ZVS below ~50 % load
      deadTimeFrac: dtf,
    },
    {
      role: "sr",
      positions: 2,
      vOffV: (2 * spec.vinMaxV) / n, // center-tap blocks 2·Vin/n
      iRmsA: 0.74 * iout, // half period + shared freewheel conduction
      iAvgA: iout / 2,
      iOnA: 0,
      iOffA: iout / 2,
      fswHz: fsw,
      dutyEff: 0.5,
      zvs: true, // commutates on body diode
      deadTimeFrac: dtf,
    },
  ];

  return {
    topologyId: "psfb",
    switchPoints,
    magnetics: [
      {
        role: "transformer",
        inductanceUh: uH((spec.vinNomV * dEff) / (2 * fsw * (0.2 * iPri))), // Lm for Im_pk = 20 % of Ipri
        iPeakA: (iout + dI / 2) / n,
        iRmsA: iPri * Math.sqrt((1 + dEff) / 2),
        voltSecondsVus: Vus((spec.vinNomV * dEff) / (2 * fsw)),
        turnsRatio: n,
        acFluxFraction: 1,
        fswHz: fsw,
      },
      {
        role: "output-inductor",
        inductanceUh: uH(Lout),
        iPeakA: iout + dI / 2,
        iRmsA: Math.sqrt(iout * iout + (dI * dI) / 12),
        voltSecondsVus: Vus((spec.voutV * (1 - dEff)) / (2 * fsw)),
        acFluxFraction: dI / 2 / (iout + dI / 2),
        fswHz: 2 * fsw, // ripple at twice the switching frequency
      },
      {
        role: "resonant-inductor",
        inductanceUh: uH(Lr),
        iPeakA: (iout + dI / 2) / n,
        iRmsA: iPri,
        voltSecondsVus: Vus(0.05 * (spec.vinNomV / (2 * fsw))),
        acFluxFraction: 1,
        fswHz: fsw,
      },
    ],
    capRmsA: dI / Math.sqrt(12),
    notes: [
      `Phase-shifted full bridge, Deff = ${dEff} at nominal → n = ${roundSig(n, 3)}:1; output filter ripples at 2·fsw.`,
      "Lagging leg achieves ZVS from output-filter energy; leading leg has only leakage/shim energy → modeled hard-switched.",
      `Shim inductance ${roundSig(uH(Lr))} µH budgets 5 % of the half-period for commutation (duty-cycle loss).`,
      "Center-tapped SR stage: watch the 2·Vin/n blocking voltage plus ringing.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Totem-pole PFC
// ---------------------------------------------------------------------------

function totemPolePfc(spec: DesignSpec, fsw: number): TopologyOperatingPoints {
  const vac = spec.gridVacRms ?? 230;
  const fLine = 50;
  const iAcRms = spec.poutW / vac; // lossless PF≈1
  const iAcPk = Math.SQRT2 * iAcRms;
  const iout = spec.poutW / spec.voutV;
  const dPk = clamp(1 - (Math.SQRT2 * vac) / spec.voutV, 0.02, 0.95); // duty at line crest
  const dAvg = clamp(1 - (2 * Math.SQRT2 * vac) / (Math.PI * spec.voutV), 0.02, 0.95);
  const dI = 0.25 * iAcPk; // HF ripple at crest
  const L = (Math.SQRT2 * vac * dPk) / (fsw * dI);

  const switchPoints: SwitchOperatingPoint[] = [
    {
      role: "pfc-fast-leg",
      positions: 2,
      vOffV: spec.voutV,
      // each fast device alternates boost-switch/SR roles per half line;
      // together they always carry iL → per-device rms = Iac/√2
      iRmsA: iAcRms / Math.SQRT2,
      iAvgA: 0.45 * iAcRms, // half of mean|i| = (2√2/π)·Iac/2
      iOnA: 0.9 * iAcRms, // line-averaged switched current (crest hits √2·Iac)
      iOffA: 0.9 * iAcRms,
      fswHz: fsw,
      dutyEff: dAvg,
      zvs: false, // hard-switched CCM — GaN's zero Qrr is what makes this leg viable
      deadTimeFrac: deadFrac(fsw),
    },
    {
      role: "pfc-slow-leg",
      positions: 2,
      vOffV: spec.voutV,
      iRmsA: iAcRms / Math.SQRT2,
      iAvgA: 0.45 * iAcRms,
      iOnA: 0,
      iOffA: 0, // commutates at the zero crossing
      fswHz: fLine,
      dutyEff: 0.5,
      zvs: true,
      deadTimeFrac: 0,
    },
  ];

  return {
    topologyId: "totem-pole-pfc",
    switchPoints,
    magnetics: [
      {
        role: "pfc-inductor",
        inductanceUh: uH(L),
        iPeakA: iAcPk + dI / 2,
        iRmsA: iAcRms,
        voltSecondsVus: Vus((Math.SQRT2 * vac * dPk) / fsw),
        acFluxFraction: dI / 2 / (iAcPk + dI / 2),
        fswHz: fsw,
      },
    ],
    // 100/120 Hz power ripple (Iout/√2) dominates; add HF chop (~0.5·Iout)
    capRmsA: Math.hypot(iout / Math.SQRT2, 0.5 * iout),
    notes: [
      `Totem-pole bridgeless PFC on ${vac} Vac (${fLine} Hz line assumed), CCM, boost to ${spec.voutV} V.`,
      `Choke ${roundSig(uH(L))} µH for 25 % p-p HF ripple at the line crest (Ipk = ${roundSig(iAcPk)} A).`,
      "Fast GaN leg hard-switched at fsw; slow leg commutates at line frequency with negligible switching loss.",
      "Bulk cap is sized by twice-line-frequency energy ripple, not just HF RMS.",
      ...(spec.voutV < 1.05 * Math.SQRT2 * vac
        ? [`WARNING: ${spec.voutV} V bus does not clear the ${roundSig(Math.SQRT2 * vac)} V line peak.`]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Flyback
// ---------------------------------------------------------------------------

function flyback(spec: DesignSpec, fsw: number): TopologyOperatingPoints {
  const D = 0.45; // design-center duty
  const n = (spec.vinNomV * D) / ((1 - D) * spec.voutV); // reflected volts = Vin·D/(1-D)
  const iout = spec.poutW / spec.voutV;
  const iPriPlateau = spec.poutW / (spec.vinNomV * D); // CCM primary plateau
  const dIp = 0.4 * iPriPlateau;
  const Lp = (spec.vinNomV * D) / (fsw * dIp);
  const iPkPri = iPriPlateau + dIp / 2;
  const rippleRmsFactor = Math.sqrt(1 + 0.4 ** 2 / 12);
  const iSecPlateau = iout / (1 - D);

  const switchPoints: SwitchOperatingPoint[] = [
    {
      role: "primary-flyback",
      positions: 1,
      // blocks Vin + reflected Vout + leakage spike allowance (clamp assumed)
      vOffV: 1.15 * (spec.vinMaxV + n * spec.voutV),
      iRmsA: iPriPlateau * Math.sqrt(D) * rippleRmsFactor,
      iAvgA: iPriPlateau * D,
      iOnA: iPriPlateau - dIp / 2,
      iOffA: iPkPri,
      fswHz: fsw,
      dutyEff: D,
      zvs: false,
      deadTimeFrac: 0,
    },
    {
      role: "sr",
      positions: 1,
      vOffV: spec.voutV + spec.vinMaxV / n,
      iRmsA: iSecPlateau * Math.sqrt(1 - D) * rippleRmsFactor,
      iAvgA: iout,
      iOnA: n * iPkPri,
      iOffA: iSecPlateau - (n * dIp) / 2,
      fswHz: fsw,
      dutyEff: 1 - D,
      zvs: true, // SR turns on into its conducting body diode
      deadTimeFrac: deadFrac(fsw),
    },
  ];

  return {
    topologyId: "flyback",
    switchPoints,
    magnetics: [
      {
        role: "coupled-inductor",
        inductanceUh: uH(Lp),
        iPeakA: iPkPri,
        iRmsA: iPriPlateau * Math.sqrt(D) * rippleRmsFactor,
        voltSecondsVus: Vus((spec.vinNomV * D) / fsw),
        turnsRatio: n,
        acFluxFraction: dIp / 2 / iPkPri,
        fswHz: fsw,
      },
    ],
    // secondary is discontinuous into the cap: Icap = Iout·√(D/(1-D))
    capRmsA: iout * Math.sqrt(D / (1 - D)),
    notes: [
      `CCM flyback, D = ${D} at nominal → n = ${roundSig(n, 3)}:1 (reflected voltage ${roundSig(n * spec.voutV)} V).`,
      `Primary inductance ${roundSig(uH(Lp))} µH for 40 % p-p magnetizing ripple.`,
      "Primary Vds includes a 15 % leakage-spike allowance — an RCD or active clamp is mandatory.",
      "Output cap carries near-triangular discontinuous current — usually the lifetime-limiting part.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Active-clamp forward
// ---------------------------------------------------------------------------

function forwardActiveClamp(spec: DesignSpec, fsw: number): TopologyOperatingPoints {
  const D = 0.45;
  const n = (spec.vinNomV * D) / spec.voutV; // Vout = Vin·D/n
  const iout = spec.poutW / spec.voutV;
  const dI = 0.3 * iout;
  const Lout = (spec.voutV * (1 - D)) / (fsw * dI);
  const iPriRef = iout / n;
  const iMagPk = 0.15 * iPriRef;
  const Lm = (spec.vinNomV * D) / (2 * iMagPk * fsw);
  const vClamp = spec.vinMaxV / (1 - D); // reset voltage across the off switch
  const dtf = deadFrac(fsw);

  const switchPoints: SwitchOperatingPoint[] = [
    {
      role: "primary-main",
      positions: 1,
      vOffV: vClamp,
      iRmsA: iPriRef * Math.sqrt(D),
      iAvgA: iPriRef * D,
      iOnA: 0,
      iOffA: (iout + dI / 2) / n + iMagPk,
      fswHz: fsw,
      dutyEff: D,
      zvs: true, // clamp energy swings the node before turn-on
      deadTimeFrac: dtf,
    },
    {
      role: "active-clamp",
      positions: 1,
      vOffV: vClamp,
      iRmsA: iMagPk * Math.sqrt((1 - D) / 3), // triangular magnetizing current
      iAvgA: 0, // net-zero clamp charge
      iOnA: 0,
      iOffA: iMagPk,
      fswHz: fsw,
      dutyEff: 1 - D,
      zvs: true,
      deadTimeFrac: dtf,
    },
    {
      role: "sr-forward",
      positions: 1,
      vOffV: (1.5 * spec.vinMaxV) / n,
      iRmsA: iout * Math.sqrt(D),
      iAvgA: iout * D,
      iOnA: iout - dI / 2,
      iOffA: iout + dI / 2,
      fswHz: fsw,
      dutyEff: D,
      zvs: true,
      deadTimeFrac: dtf,
    },
    {
      role: "sr-freewheel",
      positions: 1,
      vOffV: (1.5 * spec.vinMaxV) / n,
      iRmsA: iout * Math.sqrt(1 - D),
      iAvgA: iout * (1 - D),
      iOnA: iout + dI / 2,
      iOffA: iout - dI / 2,
      fswHz: fsw,
      dutyEff: 1 - D,
      zvs: true,
      deadTimeFrac: dtf,
    },
  ];

  return {
    topologyId: "forward-active-clamp",
    switchPoints,
    magnetics: [
      {
        role: "transformer",
        inductanceUh: uH(Lm),
        iPeakA: (iout + dI / 2) / n + iMagPk,
        iRmsA: iPriRef * Math.sqrt(D),
        voltSecondsVus: Vus((spec.vinNomV * D) / fsw),
        turnsRatio: n,
        acFluxFraction: 0.8, // active clamp swings flux partly negative
        fswHz: fsw,
      },
      {
        role: "output-inductor",
        inductanceUh: uH(Lout),
        iPeakA: iout + dI / 2,
        iRmsA: Math.sqrt(iout * iout + (dI * dI) / 12),
        voltSecondsVus: Vus((spec.voutV * (1 - D)) / fsw),
        acFluxFraction: dI / 2 / (iout + dI / 2),
        fswHz: fsw,
      },
    ],
    capRmsA: dI / Math.sqrt(12),
    notes: [
      `Active-clamp forward, D = ${D} → n = ${roundSig(n, 3)}:1; main switch blocks Vin/(1-D) = ${roundSig(vClamp)} V during reset.`,
      "Clamp recycles magnetizing energy and gives ZVS on the main switch.",
      "Buck-type output filter → low output-cap stress (triangular ripple only).",
    ],
  };
}

// ---------------------------------------------------------------------------

export function operatingPoints(
  id: TopologyId,
  spec: DesignSpec,
  fswHz: number,
): TopologyOperatingPoints {
  switch (id) {
    case "buck":
      return buckFamily(id, spec, fswHz, 1, false);
    case "sync-buck":
      return buckFamily(id, spec, fswHz, 1, true);
    case "interleaved-sync-buck":
      return buckFamily(id, spec, fswHz, 2, true);
    case "boost":
      return boost(spec, fswHz);
    case "dab":
      return dab(spec, fswHz);
    case "llc-half-bridge":
      return llc(spec, fswHz, false);
    case "llc-full-bridge":
      return llc(spec, fswHz, true);
    case "psfb":
      return psfb(spec, fswHz);
    case "totem-pole-pfc":
      return totemPolePfc(spec, fswHz);
    case "flyback":
      return flyback(spec, fswHz);
    case "forward-active-clamp":
      return forwardActiveClamp(spec, fswHz);
  }
}
