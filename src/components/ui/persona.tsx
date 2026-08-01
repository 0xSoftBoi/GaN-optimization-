"use client";

/**
 * Persona switch — one product, two audiences.
 *
 *   "executive" (default): $-impact framing, plain language, headline numbers.
 *   "engineer": full depth — losses, magnetics, thermal, firmware.
 *
 * usePersona() is backed by localStorage via useSyncExternalStore, so every
 * subscribed component across the page flips together (and across tabs via
 * the `storage` event). SSR renders the "executive" default; the stored
 * choice is applied on hydration without a mismatch warning.
 *
 *   const { persona, setPersona, isEngineer, isExecutive } = usePersona();
 *   ...
 *   <PersonaToggle />
 */

import { useSyncExternalStore } from "react";

export type Persona = "engineer" | "executive";

export const PERSONA_STORAGE_KEY = "voltforge.persona.v1";
export const DEFAULT_PERSONA: Persona = "executive";

function isPersona(v: unknown): v is Persona {
  return v === "engineer" || v === "executive";
}

// --- tiny module-level store (no context provider needed) -------------------

let cached: Persona | null = null;
const listeners = new Set<() => void>();

function readStorage(): Persona {
  try {
    const raw = window.localStorage.getItem(PERSONA_STORAGE_KEY);
    return isPersona(raw) ? raw : DEFAULT_PERSONA;
  } catch {
    // Storage unavailable (private mode / SSR) — fall back, stay functional.
    return DEFAULT_PERSONA;
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent): void {
  // Another tab changed (or cleared) the persona — re-read and notify.
  if (e.key === PERSONA_STORAGE_KEY || e.key === null) {
    cached = null;
    emit();
  }
}

function subscribe(cb: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function getSnapshot(): Persona {
  if (cached === null) cached = readStorage();
  return cached;
}

function getServerSnapshot(): Persona {
  return DEFAULT_PERSONA;
}

/** Set the active persona (persists to localStorage, notifies all hooks). */
export function setPersona(p: Persona): void {
  cached = p;
  try {
    window.localStorage.setItem(PERSONA_STORAGE_KEY, p);
  } catch {
    // Private mode — in-memory value still works for this session.
  }
  emit();
}

export interface UsePersona {
  persona: Persona;
  setPersona: (p: Persona) => void;
  /** Convenience flags for conditional rendering. */
  isEngineer: boolean;
  isExecutive: boolean;
}

/** Reactive persona hook — safe in any client component, no provider needed. */
export function usePersona(): UsePersona {
  const persona = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    persona,
    setPersona,
    isEngineer: persona === "engineer",
    isExecutive: persona === "executive",
  };
}

// --- segmented control ------------------------------------------------------

const OPTIONS: { value: Persona; label: string; hint: string }[] = [
  {
    value: "executive",
    label: "Executive",
    hint: "Business view — $ impact, TCO, payback, headline numbers",
  },
  {
    value: "engineer",
    label: "Engineer",
    hint: "Full engineering depth — losses, magnetics, thermal, firmware",
  },
];

/**
 * Segmented control bound to usePersona(). Drop it in any header/toolbar:
 *
 *   <PersonaToggle />
 */
export function PersonaToggle({ className = "" }: { className?: string }) {
  const { persona } = usePersona();
  return (
    <div
      role="group"
      aria-label="Audience view"
      className={`inline-flex items-stretch divide-x divide-ink-600 overflow-hidden rounded-md border border-ink-600 bg-ink-800 text-xs font-semibold ${className}`}
    >
      {OPTIONS.map((o) => {
        const active = persona === o.value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.hint}
            aria-pressed={active}
            onClick={() => setPersona(o.value)}
            className={
              active
                ? "bg-volt/15 px-3 py-1.5 text-volt"
                : "px-3 py-1.5 text-slate-500 transition-colors hover:bg-ink-700/50 hover:text-slate-300"
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default PersonaToggle;
