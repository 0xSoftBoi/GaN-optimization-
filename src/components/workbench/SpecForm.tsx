"use client";

/**
 * Expert form — full DesignSpec entry, for engineers who know exactly what
 * they want and skip the copilot prompt. Client-side sanity checks mirror
 * the API validator's hard constraints; the API remains authoritative.
 */

import { useState } from "react";
import type { Cooling, DesignSpec } from "@/lib/types";
import { DEFAULT_SPEC } from "./examples";

const COOLINGS: Cooling[] = ["natural", "forced-air", "liquid", "cold-plate"];

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

const NUMERIC_FIELDS: FieldDef[] = [
  { key: "vinMinV", label: "Vin min (V)", required: true },
  { key: "vinNomV", label: "Vin nom (V)", required: true },
  { key: "vinMaxV", label: "Vin max (V)", required: true },
  { key: "voutV", label: "Vout (V)", required: true },
  { key: "poutW", label: "Pout (W)", required: true },
  { key: "ambientC", label: "Ambient (°C)", required: true },
  { key: "fswHz", label: "fsw (Hz, optional)", placeholder: "optimizer sweeps" },
  { key: "maxJunctionC", label: "Tj max (°C)", placeholder: "125" },
  { key: "rippleVoutPct", label: "Vout ripple (%pp)", placeholder: "1" },
  { key: "targetEfficiencyPct", label: "Target η (%)", placeholder: "auto" },
  { key: "costCeilingUsd", label: "Cost ceiling ($)", placeholder: "none" },
  { key: "heightLimitMm", label: "Height limit (mm)", placeholder: "none" },
  { key: "gridVacRms", label: "Grid (Vac RMS)", placeholder: "ac-dc only" },
];

type FormState = Record<string, string>;

function initialState(): FormState {
  return {
    name: "",
    conversion: DEFAULT_SPEC.conversion,
    vinMinV: String(DEFAULT_SPEC.vinMinV),
    vinNomV: String(DEFAULT_SPEC.vinNomV),
    vinMaxV: String(DEFAULT_SPEC.vinMaxV),
    voutV: String(DEFAULT_SPEC.voutV),
    poutW: String(DEFAULT_SPEC.poutW),
    ambientC: String(DEFAULT_SPEC.ambientC),
    cooling: DEFAULT_SPEC.cooling,
    bidirectional: DEFAULT_SPEC.bidirectional ? "1" : "",
    isolated: DEFAULT_SPEC.isolated ? "1" : "",
    fswHz: "",
    maxJunctionC: "",
    rippleVoutPct: "",
    targetEfficiencyPct: "",
    costCeilingUsd: "",
    heightLimitMm: "",
    gridVacRms: "",
    notes: "",
  };
}

export function SpecForm({ onSubmit }: { onSubmit: (spec: DesignSpec) => void }) {
  const [f, setF] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<string[]>([]);

  const set = (key: string, value: string) => setF((p) => ({ ...p, [key]: value }));

  const submit = () => {
    const errs: string[] = [];
    const numOf = (key: string, label: string, required: boolean): number | undefined => {
      const raw = f[key]?.trim();
      if (!raw) {
        if (required) errs.push(`${label} is required`);
        return undefined;
      }
      const v = Number(raw);
      if (!Number.isFinite(v)) {
        errs.push(`${label} must be a number`);
        return undefined;
      }
      return v;
    };

    const vinMinV = numOf("vinMinV", "Vin min", true);
    const vinNomV = numOf("vinNomV", "Vin nom", true);
    const vinMaxV = numOf("vinMaxV", "Vin max", true);
    const voutV = numOf("voutV", "Vout", true);
    const poutW = numOf("poutW", "Pout", true);
    const ambientC = numOf("ambientC", "Ambient", true);
    const fswHz = numOf("fswHz", "fsw", false);
    const maxJunctionC = numOf("maxJunctionC", "Tj max", false);
    const rippleVoutPct = numOf("rippleVoutPct", "Ripple", false);
    const targetEfficiencyPct = numOf("targetEfficiencyPct", "Target η", false);
    const costCeilingUsd = numOf("costCeilingUsd", "Cost ceiling", false);
    const heightLimitMm = numOf("heightLimitMm", "Height limit", false);
    const gridVacRms = numOf("gridVacRms", "Grid Vac", false);

    if (vinMinV !== undefined && vinNomV !== undefined && vinMinV > vinNomV)
      errs.push("Vin min must be ≤ Vin nom");
    if (vinNomV !== undefined && vinMaxV !== undefined && vinNomV > vinMaxV)
      errs.push("Vin nom must be ≤ Vin max");
    if (poutW !== undefined && poutW <= 0) errs.push("Pout must be > 0");
    if (voutV !== undefined && voutV <= 0) errs.push("Vout must be > 0");

    if (errs.length > 0) {
      setErrors(errs);
      return;
    }

    const spec: DesignSpec = {
      ...(f.name.trim() ? { name: f.name.trim() } : {}),
      conversion: f.conversion === "ac-dc" ? "ac-dc" : "dc-dc",
      vinMinV: vinMinV as number,
      vinNomV: vinNomV as number,
      vinMaxV: vinMaxV as number,
      voutV: voutV as number,
      poutW: poutW as number,
      bidirectional: f.bidirectional === "1",
      isolated: f.isolated === "1",
      ...(fswHz !== undefined ? { fswHz } : {}),
      ambientC: ambientC as number,
      ...(maxJunctionC !== undefined ? { maxJunctionC } : {}),
      cooling: (COOLINGS as string[]).includes(f.cooling) ? (f.cooling as Cooling) : "forced-air",
      ...(rippleVoutPct !== undefined ? { rippleVoutPct } : {}),
      ...(targetEfficiencyPct !== undefined ? { targetEfficiencyPct } : {}),
      ...(costCeilingUsd !== undefined ? { costCeilingUsd } : {}),
      ...(heightLimitMm !== undefined ? { heightLimitMm } : {}),
      ...(gridVacRms !== undefined ? { gridVacRms } : {}),
      ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
    };
    setErrors([]);
    onSubmit(spec);
  };

  return (
    <div className="space-y-4 text-left">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="stat-label">Design name</span>
          <input
            className="input mt-1"
            value={f.name}
            placeholder="e.g. 5 kW DAB brick"
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="stat-label">Conversion</span>
          <select
            className="input mt-1"
            value={f.conversion}
            onChange={(e) => set("conversion", e.target.value)}
          >
            <option value="dc-dc">dc-dc</option>
            <option value="ac-dc">ac-dc (PFC front end)</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {NUMERIC_FIELDS.map((fd) => (
          <label key={fd.key} className="block">
            <span className="stat-label">
              {fd.label}
              {fd.required && <span className="text-rose-400"> *</span>}
            </span>
            <input
              className="input mt-1"
              inputMode="decimal"
              value={f[fd.key]}
              placeholder={fd.placeholder}
              onChange={(e) => set(fd.key, e.target.value)}
            />
          </label>
        ))}
        <label className="block">
          <span className="stat-label">Cooling</span>
          <select
            className="input mt-1"
            value={f.cooling}
            onChange={(e) => set("cooling", e.target.value)}
          >
            {COOLINGS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="accent-cyan-400"
            checked={f.bidirectional === "1"}
            onChange={(e) => set("bidirectional", e.target.checked ? "1" : "")}
          />
          Bidirectional
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="accent-cyan-400"
            checked={f.isolated === "1"}
            onChange={(e) => set("isolated", e.target.checked ? "1" : "")}
          />
          Isolated
        </label>
      </div>

      <label className="block">
        <span className="stat-label">Notes</span>
        <input
          className="input mt-1"
          value={f.notes}
          placeholder="automotive, hold-up, EMI class B…"
          onChange={(e) => set("notes", e.target.value)}
        />
      </label>

      {errors.length > 0 && (
        <ul className="space-y-1 text-xs text-rose-400">
          {errors.map((e) => (
            <li key={e}>✕ {e}</li>
          ))}
        </ul>
      )}

      <button className="btn w-full justify-center" onClick={submit}>
        Forge design →
      </button>
    </div>
  );
}
