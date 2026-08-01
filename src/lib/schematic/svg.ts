/**
 * Minimal dark-theme SVG block-diagram renderer used for the schematic
 * one-line diagram. Pure string generation — no DOM.
 */

export const SVG_BG = "#0a0e14";
export const SVG_ACCENT = "#22d3ee"; // volt-cyan
export const SVG_TEXT = "#e2f4ff";
export const SVG_MUTED = "#8fb8c9";
export const SVG_NET = "#a5f3fc";
export const SVG_BLOCK_FILL = "#101826";
export const SVG_FOOTER = "#6e93a3";

export interface DiagramBlock {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines: string[];
}

export interface DiagramWire {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Pt = [number, number];

function ports(a: DiagramBlock, b: DiagramBlock): { p1: Pt; p2: Pt; horizontal: boolean } {
  const ac: Pt = [a.x + a.w / 2, a.y + a.h / 2];
  const bc: Pt = [b.x + b.w / 2, b.y + b.h / 2];
  const dx = bc[0] - ac[0];
  const dy = bc[1] - ac[1];
  if (Math.abs(dx) >= Math.abs(dy)) {
    // horizontal run
    if (dx >= 0) return { p1: [a.x + a.w, ac[1]], p2: [b.x, bc[1]], horizontal: true };
    return { p1: [a.x, ac[1]], p2: [b.x + b.w, bc[1]], horizontal: true };
  }
  if (dy >= 0) return { p1: [ac[0], a.y + a.h], p2: [bc[0], b.y], horizontal: false };
  return { p1: [ac[0], a.y], p2: [bc[0], b.y + b.h], horizontal: false };
}

function wirePath(p1: Pt, p2: Pt, horizontal: boolean): string {
  if (horizontal) {
    if (Math.abs(p1[1] - p2[1]) < 1) return `M${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]}`;
    const mx = (p1[0] + p2[0]) / 2;
    return `M${p1[0]} ${p1[1]} L${mx} ${p1[1]} L${mx} ${p2[1]} L${p2[0]} ${p2[1]}`;
  }
  if (Math.abs(p1[0] - p2[0]) < 1) return `M${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]}`;
  const my = (p1[1] + p2[1]) / 2;
  return `M${p1[0]} ${p1[1]} L${p1[0]} ${my} L${p2[0]} ${my} L${p2[0]} ${p2[1]}`;
}

export function renderDiagram(opts: {
  width: number;
  height: number;
  title: string;
  subtitle?: string;
  blocks: DiagramBlock[];
  wires: DiagramWire[];
  footer?: string[];
}): string {
  const { width, height, blocks, wires } = opts;
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace">`,
  );
  parts.push(
    `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${SVG_ACCENT}"/></marker></defs>`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${SVG_BG}"/>`);
  parts.push(
    `<text x="24" y="26" fill="${SVG_TEXT}" font-size="16" font-weight="bold">${escXml(opts.title)}</text>`,
  );
  if (opts.subtitle) {
    parts.push(`<text x="24" y="44" fill="${SVG_MUTED}" font-size="12">${escXml(opts.subtitle)}</text>`);
  }

  for (const w of wires) {
    const a = byId.get(w.from);
    const b = byId.get(w.to);
    if (!a || !b) continue;
    const { p1, p2, horizontal } = ports(a, b);
    const dash = w.dashed ? ` stroke-dasharray="5 4"` : "";
    parts.push(
      `<path d="${wirePath(p1, p2, horizontal)}" fill="none" stroke="${SVG_ACCENT}" stroke-width="1.6"${dash} marker-end="url(#arr)"/>`,
    );
    if (w.label) {
      const lx = horizontal ? (p1[0] + p2[0]) / 2 : Math.max(p1[0], p2[0]) + 8;
      const ly = horizontal ? Math.min(p1[1], p2[1]) - 7 : (p1[1] + p2[1]) / 2;
      const anchor = horizontal ? "middle" : "start";
      parts.push(
        `<text x="${lx}" y="${ly}" fill="${SVG_NET}" font-size="12" text-anchor="${anchor}">${escXml(w.label)}</text>`,
      );
    }
  }

  for (const b of blocks) {
    parts.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="${SVG_BLOCK_FILL}" stroke="${SVG_ACCENT}" stroke-width="1.5"/>`,
    );
    const cx = b.x + b.w / 2;
    parts.push(
      `<text x="${cx}" y="${b.y + 19}" fill="${SVG_TEXT}" font-size="13" font-weight="bold" text-anchor="middle">${escXml(b.title)}</text>`,
    );
    const maxLines = Math.max(0, Math.floor((b.h - 30) / 15));
    b.lines.slice(0, maxLines).forEach((line, i) => {
      parts.push(
        `<text x="${cx}" y="${b.y + 36 + i * 15}" fill="${SVG_MUTED}" font-size="12" text-anchor="middle">${escXml(line)}</text>`,
      );
    });
  }

  (opts.footer ?? []).forEach((line, i) => {
    parts.push(
      `<text x="24" y="${height - 12 - (opts.footer!.length - 1 - i) * 16}" fill="${SVG_FOOTER}" font-size="12">${escXml(line)}</text>`,
    );
  });

  parts.push("</svg>");
  return parts.join("\n");
}
