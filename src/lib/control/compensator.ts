/**
 * Compensator synthesis from averaged small-signal models.
 *
 * Families:
 *  - buck-derived (buck, sync-buck, interleaved-sync-buck, psfb,
 *    forward-active-clamp): voltage-mode LC double pole → Type-2/Type-3
 *    with K-factor-style phase-boost placement.
 *  - boost / flyback: current-mode first-order plant + RHP zero →
 *    crossover ≤ min(fsw/10, f_RHPZ/4), Type-2 (or Type-3 if the boost
 *    requirement demands it).
 *  - resonant (llc-*) and dab: first-order-ish charge/power control plant →
 *    PI with the zero set from the required phase boost.
 *  - totem-pole-pfc: average-current-loop plant Vout/(sL) → PI (UC3854 style).
 *
 * Digital coefficients come from a pole/zero-mapped bilinear (Tustin)
 * transform at sampleHz = fsw with gain matched at the crossover frequency.
 */

import type { CompensatorDesign, DesignSpec, TopologyId } from "@/lib/types";
import { clamp, roundSig } from "@/lib/util";

// ---- minimal complex arithmetic -------------------------------------------

interface C {
  re: number;
  im: number;
}
const cadd = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
const cmul = (a: C, b: C): C => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
const cdiv = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cabs = (a: C): number => Math.hypot(a.re, a.im);
const carg = (a: C): number => Math.atan2(a.im, a.re);

const DEG = 180 / Math.PI;

// ---- plant models ----------------------------------------------------------

type Family = "buck-derived" | "rhpz" | "resonant" | "pfc-current";

interface Plant {
  family: Family;
  /** Complex plant response at angular frequency w [rad/s]. */
  at(w: number): C;
  rhpzHz?: number;
  notes: string[];
}

function secondOrder(g0: number, w0: number, q: number, wrhpz?: number): (w: number) => C {
  return (w) => {
    const den: C = { re: 1 - (w / w0) ** 2, im: w / (q * w0) };
    const num: C = wrhpz ? { re: 1, im: -w / wrhpz } : { re: 1, im: 0 };
    return cdiv(cmul({ re: g0, im: 0 }, num), den);
  };
}

function firstOrder(g0: number, wp: number, wrhpz?: number): (w: number) => C {
  return (w) => {
    const den: C = { re: 1, im: w / wp };
    const num: C = wrhpz ? { re: 1, im: -w / wrhpz } : { re: 1, im: 0 };
    return cdiv(cmul({ re: g0, im: 0 }, num), den);
  };
}

function buildPlant(id: TopologyId, spec: DesignSpec, lH: number, cF: number): Plant {
  const R = Math.max(1e-3, (spec.voutV * spec.voutV) / spec.poutW);
  switch (id) {
    case "buck":
    case "sync-buck":
    case "interleaved-sync-buck": {
      const lEff = id === "interleaved-sync-buck" ? lH / 2 : lH; // 2 phases in parallel
      const w0 = 1 / Math.sqrt(lEff * cF);
      const q = clamp(R * Math.sqrt(cF / lEff), 0.5, 5);
      return {
        family: "buck-derived",
        at: secondOrder(spec.vinNomV, w0, q),
        notes: [
          `Voltage-mode buck plant: Gvd = Vin/(1+s/(Qω0)+(s/ω0)²), f0 = ${roundSig(w0 / (2 * Math.PI))} Hz, Q = ${roundSig(q, 2)}${id === "interleaved-sync-buck" ? " (L/2 effective, 2 phases)" : ""}.`,
        ],
      };
    }
    case "psfb":
    case "forward-active-clamp": {
      // buck-derived through the transformer; secondary-referred filter.
      const w0 = 1 / Math.sqrt(lH * cF);
      const q = clamp(R * Math.sqrt(cF / lH), 0.5, 5);
      const g0 = spec.voutV / 0.6; // normalized modulator: Vout at D≈0.6
      return {
        family: "buck-derived",
        at: secondOrder(g0, w0, q),
        notes: [
          `Buck-derived isolated plant (secondary-referred LC): f0 = ${roundSig(w0 / (2 * Math.PI))} Hz, Q = ${roundSig(q, 2)}.`,
        ],
      };
    }
    case "boost": {
      const d = clamp(1 - spec.vinNomV / spec.voutV, 0.05, 0.95);
      const wrhpz = ((1 - d) ** 2 * R) / lH;
      const wp = 2 / (R * cF); // CMC boost load pole ≈ 2/RC
      return {
        family: "rhpz",
        at: firstOrder(R, wp, wrhpz),
        rhpzHz: wrhpz / (2 * Math.PI),
        notes: [
          `Current-mode boost plant: load pole 2/RC at ${roundSig(wp / (2 * Math.PI))} Hz, RHP zero at ${roundSig(wrhpz / (2 * Math.PI))} Hz (D = ${roundSig(d, 2)}).`,
        ],
      };
    }
    case "flyback": {
      const d = 0.45;
      const wrhpz = ((1 - d) ** 2 * R) / (d * lH); // secondary-referred L assumed
      const wp = 2 / (R * cF);
      return {
        family: "rhpz",
        at: firstOrder(R, wp, wrhpz),
        rhpzHz: wrhpz / (2 * Math.PI),
        notes: [
          `Current-mode CCM flyback plant (D = ${d}, secondary-referred L): RHP zero at ${roundSig(wrhpz / (2 * Math.PI))} Hz.`,
        ],
      };
    }
    case "llc-half-bridge":
    case "llc-full-bridge": {
      const wp = 2 / (R * cF); // charge control ≈ first order, pole at 2/RC
      return {
        family: "resonant",
        at: firstOrder(spec.voutV, wp),
        notes: [
          `LLC charge-control approximation: first-order plant, pole 2/RC at ${roundSig(wp / (2 * Math.PI))} Hz.`,
        ],
      };
    }
    case "dab": {
      // Phase-shift-to-output-current source into R‖C.
      const phi0 = Math.PI / 6;
      const iout = spec.poutW / spec.voutV;
      const dIdPhi = (iout * (1 - (2 * phi0) / Math.PI)) / (phi0 * (1 - phi0 / Math.PI));
      const wp = 1 / (R * cF);
      return {
        family: "resonant",
        at: firstOrder(R * dIdPhi, wp),
        notes: [
          `DAB power-flow plant: dIout/dφ into R‖C, load pole at ${roundSig(wp / (2 * Math.PI))} Hz.`,
        ],
      };
    }
    case "totem-pole-pfc": {
      return {
        family: "pfc-current",
        at: (w) => cdiv({ re: spec.voutV, im: 0 }, { re: 0, im: w * lH }),
        notes: [
          "PFC average-current loop: plant ≈ Vout/(sL); outer voltage loop (~10 Hz) not synthesized here.",
        ],
      };
    }
  }
}

// ---- polynomial helpers ----------------------------------------------------

/** Expand monic polynomial from real roots: Π(x - r_i). */
function polyFromRoots(roots: number[]): number[] {
  let p = [1];
  for (const r of roots) {
    const next = new Array(p.length + 1).fill(0);
    for (let i = 0; i < p.length; i++) {
      next[i] += p[i];
      next[i + 1] -= p[i] * r;
    }
    p = next;
  }
  return p;
}

/** Evaluate polynomial (descending powers of z) at complex z. */
function polyEval(p: number[], z: C): C {
  let acc: C = { re: 0, im: 0 };
  for (const coeff of p) acc = cadd(cmul(acc, z), { re: coeff, im: 0 });
  return acc;
}

/** Bilinear map of an analog root s = -w (rad/s) to the z-plane. */
function bilinearRoot(wRad: number, ts: number): number {
  return (2 - wRad * ts) / (2 + wRad * ts);
}

// ---- main ------------------------------------------------------------------

const PM_TARGET_DEG = 60; // design for 60°, spec floor is 55°

export function designCompensator(
  id: TopologyId,
  spec: DesignSpec,
  fswHz: number,
  lUh: number,
  cOutUf: number,
): CompensatorDesign {
  const notes: string[] = [];
  const lH = Math.max(lUh, 1e-3) * 1e-6;
  const cF = Math.max(cOutUf, 1e-3) * 1e-6;
  const plant = buildPlant(id, spec, lH, cF);
  notes.push(...plant.notes);

  // ---- crossover selection -------------------------------------------------
  let fc = plant.family === "resonant" ? fswHz / 15 : fswHz / 10;
  if (plant.family === "rhpz" && plant.rhpzHz !== undefined) {
    fc = Math.min(fc, plant.rhpzHz / 4);
    notes.push(
      `Crossover capped at RHPZ/4 = ${roundSig(plant.rhpzHz / 4)} Hz to keep the RHP zero's phase lag benign.`,
    );
  }

  const phaseBoostNeeded = (f: number): number => {
    const phPlant = carg(plant.at(2 * Math.PI * f)) * DEG;
    return PM_TARGET_DEG - 90 - phPlant; // over a pure integrator
  };

  // Back the crossover off (max 5 steps) if the boost demand is unrealizable.
  let phiB = phaseBoostNeeded(fc);
  for (let i = 0; i < 5 && phiB > 150; i++) {
    fc *= 0.75;
    phiB = phaseBoostNeeded(fc);
  }
  const wc = 2 * Math.PI * fc;

  // ---- structure selection & pole/zero placement ---------------------------
  let kind: CompensatorDesign["kind"];
  if (plant.family === "resonant" || plant.family === "pfc-current") kind = "pi";
  else if (phiB <= 70) kind = "type-2";
  else kind = "type-3";

  const zerosHz: number[] = [];
  const polesHz: number[] = [0]; // integrator always present

  if (kind === "pi") {
    // boost over integrator = 90° - atan(wz/wc)
    const boost = clamp(phiB, 10, 85);
    const fz = fc * Math.tan(((90 - boost) * Math.PI) / 180);
    zerosHz.push(fz);
    notes.push(
      `PI: zero at ${roundSig(fz)} Hz gives ${roundSig(boost)}° of boost at fc = ${roundSig(fc)} Hz.`,
    );
  } else if (kind === "type-2") {
    const fp = Math.min(4 * fc, 0.45 * fswHz);
    const poleLag = Math.atan(fc / fp) * DEG;
    const zArg = clamp(phiB + poleLag, 5, 88);
    const fz = fc / Math.tan((zArg * Math.PI) / 180);
    zerosHz.push(fz);
    polesHz.push(fp);
    notes.push(
      `Type-2: zero ${roundSig(fz)} Hz, HF pole ${roundSig(fp)} Hz → ${roundSig(phiB)}° boost at fc = ${roundSig(fc)} Hz.`,
    );
  } else {
    const fp = Math.min(4 * fc, 0.45 * fswHz);
    const poleLag = Math.atan(fc / fp) * DEG;
    const zArg = clamp((phiB + 2 * poleLag) / 2, 5, 88);
    const fz = fc / Math.tan((zArg * Math.PI) / 180);
    zerosHz.push(fz, fz);
    polesHz.push(fp, fp);
    notes.push(
      `Type-3: double zero ${roundSig(fz)} Hz through the LC resonance, double HF pole ${roundSig(fp)} Hz → ${roundSig(phiB)}° boost at fc = ${roundSig(fc)} Hz.`,
    );
  }

  // ---- gain: |Gc(jwc)·Gp(jwc)| = 1 ----------------------------------------
  // Gc(s) = (Kc/s)·Π(1+s/wz)/Π(1+s/wp)
  const gcShape = (w: number): C => {
    let acc: C = cdiv({ re: 1, im: 0 }, { re: 0, im: w }); // 1/s
    for (const fz of zerosHz) acc = cmul(acc, { re: 1, im: w / (2 * Math.PI * fz) });
    for (const fp of polesHz.slice(1)) acc = cdiv(acc, { re: 1, im: w / (2 * Math.PI * fp) });
    return acc;
  };
  const kc = 1 / (cabs(plant.at(wc)) * cabs(gcShape(wc)));
  const gc = (w: number): C => cmul({ re: kc, im: 0 }, gcShape(w));

  // Achieved phase margin at the designed crossover.
  const phaseMarginDeg = 180 + carg(cmul(gc(wc), plant.at(wc))) * DEG;

  // PID-equivalent gains of the analog prototype:
  //   ki = lim s→0 s·Gc(s) [1/s];  kp = |Gc(jωc)| (mid-band, K-factor centered);
  //   kd = Kc/(ωz1·ωz2) [s] for type-3 (derivative region between the zeros and poles).
  const ki = kc;
  const kp = cabs(gc(wc));
  const kd =
    kind === "type-3"
      ? kc / ((2 * Math.PI * zerosHz[0]) * (2 * Math.PI * zerosHz[1]))
      : undefined;

  // ---- bilinear (Tustin) discretization at sampleHz = fsw ------------------
  const ts = 1 / fswHz;
  const zZeros = zerosHz.map((fz) => bilinearRoot(2 * Math.PI * fz, ts));
  const zPoles = [1, ...polesHz.slice(1).map((fp) => bilinearRoot(2 * Math.PI * fp, ts))];
  while (zZeros.length < zPoles.length) zZeros.push(-1); // bilinear maps s=∞ → z=−1
  const bMonic = polyFromRoots(zZeros);
  const a = polyFromRoots(zPoles);
  // Gain-match the discrete filter to the analog prototype at fc.
  const zc: C = { re: Math.cos(wc * ts), im: Math.sin(wc * ts) };
  const hd0 = cdiv(polyEval(bMonic, zc), polyEval(a, zc));
  const kDigital = cabs(gc(wc)) / cabs(hd0);
  const b = bMonic.map((x) => x * kDigital);
  notes.push(
    `Digital biquad via pole/zero-matched Tustin at ${roundSig(fswHz)} Hz sample rate, gain-matched at fc; achieved PM ≈ ${roundSig(phaseMarginDeg)}°.`,
  );

  return {
    kind,
    crossoverHz: fc,
    phaseMarginDeg,
    kp,
    ki,
    ...(kd !== undefined ? { kd } : {}),
    polesHz,
    zerosHz,
    b,
    a,
    sampleHz: fswHz,
    notes,
  };
}
