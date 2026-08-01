"use client";

import type { SwitchTech } from "@/lib/types";

const STYLES: Record<SwitchTech, string> = {
  GaN: "border-volt/40 bg-volt/10 text-volt",
  SiC: "border-[#f59e0b]/40 bg-[#f59e0b]/10 text-[#f59e0b]",
  Si: "border-slate-500/40 bg-slate-500/10 text-slate-400",
};

/** Compact technology badge: GaN = volt cyan, SiC = amber, Si = slate. */
export default function TechBadge({ tech }: { tech: SwitchTech }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${STYLES[tech]}`}
    >
      {tech}
    </span>
  );
}
