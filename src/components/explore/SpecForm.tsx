"use client";

/**
 * Compact DesignSpec form for the Pareto explorer. String-state in,
 * validated DesignSpec out (via specFromForm in the page).
 */

import type { Cooling, DesignSpec } from "@/lib/types";
import type { SpecFormState } from "./pareto-logic";

const COOLINGS: Cooling[] = ["natural", "forced-air", "liquid", "cold-plate"];
const CONVERSIONS: DesignSpec["conversion"][] = ["dc-dc", "ac-dc"];

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

export default function SpecForm({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: SpecFormState;
  onChange: (next: SpecFormState) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const set = <K extends keyof SpecFormState>(key: K, v: SpecFormState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6"
    >
      <Field label="Name" className="col-span-2">
        <input
          className="input"
          value={value.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="design name"
        />
      </Field>
      <Field label="Conversion">
        <select
          className="input"
          value={value.conversion}
          onChange={(e) => set("conversion", e.target.value as DesignSpec["conversion"])}
        >
          {CONVERSIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cooling">
        <select
          className="input"
          value={value.cooling}
          onChange={(e) => set("cooling", e.target.value as Cooling)}
        >
          {COOLINGS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ambient (°C)">
        <input
          className="input"
          inputMode="decimal"
          value={value.ambientC}
          onChange={(e) => set("ambientC", e.target.value)}
        />
      </Field>
      <Field label="Pout (W)">
        <input
          className="input"
          inputMode="decimal"
          value={value.poutW}
          onChange={(e) => set("poutW", e.target.value)}
        />
      </Field>

      <Field label="Vin min (V)">
        <input
          className="input"
          inputMode="decimal"
          value={value.vinMinV}
          onChange={(e) => set("vinMinV", e.target.value)}
        />
      </Field>
      <Field label="Vin nom (V)">
        <input
          className="input"
          inputMode="decimal"
          value={value.vinNomV}
          onChange={(e) => set("vinNomV", e.target.value)}
        />
      </Field>
      <Field label="Vin max (V)">
        <input
          className="input"
          inputMode="decimal"
          value={value.vinMaxV}
          onChange={(e) => set("vinMaxV", e.target.value)}
        />
      </Field>
      <Field label="Vout (V)">
        <input
          className="input"
          inputMode="decimal"
          value={value.voutV}
          onChange={(e) => set("voutV", e.target.value)}
        />
      </Field>
      <Field label="fsw (kHz, blank = sweep)">
        <input
          className="input"
          inputMode="decimal"
          value={value.fswKhz}
          onChange={(e) => set("fswKhz", e.target.value)}
          placeholder="auto"
        />
      </Field>
      <Field label="Cost ceiling ($)">
        <input
          className="input"
          inputMode="decimal"
          value={value.costCeilingUsd}
          onChange={(e) => set("costCeilingUsd", e.target.value)}
          placeholder="none"
        />
      </Field>

      <div className="col-span-2 flex items-end gap-4 sm:col-span-3">
        <label className="inline-flex items-center gap-2 pb-2 text-xs text-slate-400">
          <input
            type="checkbox"
            className="accent-cyan-400"
            checked={value.bidirectional}
            onChange={(e) => set("bidirectional", e.target.checked)}
          />
          bidirectional
        </label>
        <label className="inline-flex items-center gap-2 pb-2 text-xs text-slate-400">
          <input
            type="checkbox"
            className="accent-cyan-400"
            checked={value.isolated}
            onChange={(e) => set("isolated", e.target.checked)}
          />
          isolated
        </label>
      </div>
      <div className="col-span-2 flex items-end justify-end sm:col-span-3">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "sweeping…" : "Run optimizer"}
        </button>
      </div>
    </form>
  );
}
