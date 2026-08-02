"use client";

/**
 * Landing + copilot entry. A prompt (or expert-form spec) is stashed in
 * sessionStorage and the workbench at /design picks it up and runs the
 * engine. Two personas share this page: the copilot card leads for anyone
 * shopping a design; the fleet-economics card leads for anyone shopping a
 * dollar figure.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DesignSpec } from "@/lib/types";
import {
  EXAMPLE_PROMPTS,
  STORAGE_KEY,
  SpecForm,
  encodeRequest,
} from "@/components/workbench";
import { PersonaToggle, usePersona } from "@/components/ui/persona";
import { Term } from "@/components/ui/term";

const ENGINEER_CAPABILITIES: { label: string; value: string }[] = [
  { label: "Topologies", value: "11" },
  { label: "GaN / SiC parts", value: "40+" },
  { label: "Core loss", value: "iGSE" },
  { label: "Copper loss", value: "Dowell" },
  { label: "Export", value: "SPICE" },
  { label: "Firmware", value: "C / HRTIM" },
];

const EXECUTIVE_CAPABILITIES: { label: string; value: string }[] = [
  { label: "Efficiency", value: "→ $/yr" },
  { label: "Fleet", value: "TCO + payback" },
  { label: "Sensitivity", value: "$/MWh" },
  { label: "Emissions", value: "CO2 /yr" },
  { label: "Handoff", value: "→ engineering" },
  { label: "Turnaround", value: "seconds" },
];

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [expert, setExpert] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isEngineer } = usePersona();

  const go = (req: { prompt?: string; spec?: DesignSpec }) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, encodeRequest(req));
    } catch {
      // Private mode without storage — the workbench falls back to the demo spec.
    }
    router.push("/design");
  };

  const submitPrompt = () => {
    if (!prompt.trim()) {
      setError("Describe your converter first — or pick an example below.");
      return;
    }
    setError(null);
    go({ prompt: prompt.trim() });
  };

  return (
    <div className="mx-auto max-w-3xl py-10">
      {/* Hero */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold leading-tight text-slate-100 sm:text-4xl">
          Spec in. <span className="text-volt">Complete GaN power design out.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-slate-300">
          Describe a power converter in plain English — VoltForge designs it, prices
          the parts, and shows what the efficiency is worth in dollars per year.
        </p>
        {isEngineer && (
          <p className="mx-auto mt-2 max-w-xl text-xs text-slate-500">
            Topology selection, device × frequency sweep, magnetics, thermal,
            schematic, <Term k="bom">BOM</Term>, firmware and compliance — one physics
            engine, seconds per design.
          </p>
        )}
        <div className="mt-4 flex justify-center">
          <PersonaToggle />
        </div>
      </div>

      {/* Copilot / expert toggle */}
      <div className="panel">
        <div className="mb-3 flex items-center justify-between">
          <span className="panel-title mb-0">
            {expert ? "Expert form" : "Design copilot"}
          </span>
          <button
            className="text-xs text-slate-500 underline-offset-2 transition-colors hover:text-volt hover:underline"
            onClick={() => setExpert((e) => !e)}
          >
            {expert ? "← back to copilot prompt" : "expert form →"}
          </button>
        </div>

        {expert ? (
          <SpecForm onSubmit={(spec) => go({ spec })} />
        ) : (
          <div className="space-y-3">
            <textarea
              className="input min-h-28 resize-y font-mono"
              placeholder="Describe your converter — e.g. 5kW bidirectional 800V to 48V isolated, forced air, 40C ambient"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitPrompt();
              }}
            />
            {error && <p className="text-xs text-rose-400">{error}</p>}
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex.label}
                  className="rounded-full border border-ink-600 bg-ink-700/50 px-3 py-1 text-xs text-slate-400 transition-colors hover:border-volt/50 hover:text-volt"
                  onClick={() => {
                    setPrompt(ex.prompt);
                    setError(null);
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
            <button className="btn w-full justify-center" onClick={submitPrompt}>
              Forge design →
            </button>
            <p className="text-center text-[10px] text-slate-400">
              Same description always produces the same design — no AI randomness.
              Ctrl/⌘+Enter to submit.
            </p>
          </div>
        )}
      </div>

      {/* Fleet economics entry card — the second persona's front door */}
      <div className="panel mt-4 border-lime-400/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="panel-title mb-1">Fleet economics — what is 1% efficiency worth?</h2>
            <p className="max-w-md text-sm text-slate-300">
              Price a converter in $/MWh, fleet <Term k="tco">TCO</Term> and payback —
              built for traders and energy managers, no engineering literacy required.
            </p>
          </div>
          <Link href="/economics" className="btn shrink-0 border-lime-400/40 bg-lime-400/10 text-lime-400 hover:bg-lime-400/20">
            Open fleet calculator →
          </Link>
        </div>
      </div>

      {/* Capability strip */}
      <div className="mt-8 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {(isEngineer ? ENGINEER_CAPABILITIES : EXECUTIVE_CAPABILITIES).map((c) => (
          <div key={c.label} className="stat text-center">
            <div className="stat-value text-sm">{c.value}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
