import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoltForge — AI Power Delivery Platform",
  description:
    "Spec in, complete GaN/SiC converter design out: topology, losses, magnetics, thermal, schematic, BOM, firmware, compliance.",
};

const nav = [
  { href: "/", label: "Copilot" },
  { href: "/design", label: "Workbench" },
  { href: "/components", label: "Terminal" },
  { href: "/optimize", label: "Pareto" },
  { href: "/docs", label: "Docs" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-900 font-mono text-slate-200 antialiased">
        <header className="sticky top-0 z-40 border-b border-ink-600 bg-ink-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight text-volt">
                ⚡ VoltForge
              </span>
              <span className="hidden text-xs text-slate-500 sm:inline">
                AI POWER DELIVERY PLATFORM
              </span>
            </Link>
            <nav className="ml-auto flex items-center gap-4 text-sm">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="text-slate-400 transition-colors hover:text-volt"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="border-t border-ink-600 py-6 text-center text-xs text-slate-600">
          VoltForge · physics-based design engine · models are estimates — validate
          on hardware before production
        </footer>
      </body>
    </html>
  );
}
