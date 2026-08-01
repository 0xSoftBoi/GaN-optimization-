/** Shared numeric helpers. Pure, dependency-free. */

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Piecewise-linear interpolation over sorted xs. Clamps outside the range. */
export function interp1(xs: number[], ys: number[], x: number): number {
  if (xs.length === 0) return NaN;
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  for (let i = 1; i < n; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return lerp(ys[i - 1], ys[i], t);
    }
  }
  return ys[n - 1];
}

export function roundSig(x: number, sig = 3): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const mag = Math.pow(10, sig - Math.ceil(Math.log10(Math.abs(x))));
  return Math.round(x * mag) / mag;
}

/** Format with SI prefix: siFormat(3.3e-6, "H") -> "3.3 µH". */
export function siFormat(x: number, unit: string, sig = 3): string {
  if (x === 0) return `0 ${unit}`;
  if (!Number.isFinite(x)) return `${x} ${unit}`;
  const prefixes: [number, string][] = [
    [1e12, "T"],
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "µ"],
    [1e-9, "n"],
    [1e-12, "p"],
  ];
  const abs = Math.abs(x);
  for (const [scale, p] of prefixes) {
    if (abs >= scale) return `${roundSig(x / scale, sig)} ${p}${unit}`;
  }
  return `${roundSig(x / 1e-12, sig)} p${unit}`;
}

/** RMS of samples. */
export function rms(xs: number[]): number {
  if (xs.length === 0) return 0;
  return Math.sqrt(xs.reduce((s, v) => s + v * v, 0) / xs.length);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

export function sum(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0);
}

/** Inclusive log-spaced sweep. */
export function logSpace(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo];
  const out: number[] = [];
  const la = Math.log(lo);
  const lb = Math.log(hi);
  for (let i = 0; i < n; i++) out.push(Math.exp(la + ((lb - la) * i) / (n - 1)));
  return out;
}

export function linSpace(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(lo + ((hi - lo) * i) / (n - 1));
  return out;
}
