/**
 * BerufsKI Cover SVG Generator
 * 
 * Generates professional SVG covers for tier-specific products.
 * Output: SVG string or data URL for embedding in PDFs.
 */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface CoverParams {
  title: string;
  subtitle: string;
  badge: string;
  primary: string;
  accent: string;
  brandName?: string;
}

export function buildCoverSvg(params: CoverParams): string {
  const t = escapeXml(params.title);
  const st = escapeXml(params.subtitle);
  const b = escapeXml(params.badge);
  const brand = escapeXml(params.brandName || "BerufsKI");

  // Word-wrap title if too long (rough: >28 chars → 2 lines)
  const titleLines: string[] = [];
  if (t.length > 28) {
    const mid = t.lastIndexOf(" ", 28);
    if (mid > 10) {
      titleLines.push(t.slice(0, mid));
      titleLines.push(t.slice(mid + 1));
    } else {
      titleLines.push(t);
    }
  } else {
    titleLines.push(t);
  }

  const titleSvg = titleLines
    .map((line, i) => `<text x="120" y="${330 + i * 68}" font-family="Inter, system-ui, Arial" font-size="56" fill="#fff" font-weight="800">${line}</text>`)
    .join("\n  ");

  const subtitleY = 330 + titleLines.length * 68 + 20;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="800" viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${params.primary}"/>
      <stop offset="100%" stop-color="${params.accent}"/>
    </linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000" flood-opacity="0.18"/>
    </filter>
  </defs>

  <rect width="1200" height="800" fill="#ffffff"/>
  <rect x="60" y="60" width="1080" height="680" rx="40" fill="url(#g)" filter="url(#s)"/>

  <!-- Badge -->
  <rect x="100" y="100" width="${Math.max(b.length * 17 + 40, 160)}" height="56" rx="28" fill="rgba(255,255,255,0.2)"/>
  <text x="130" y="138" font-family="Inter, system-ui, Arial" font-size="26" fill="#fff" font-weight="700">${b}</text>

  <!-- Brand -->
  <text x="1040" y="138" font-family="Inter, system-ui, Arial" font-size="22" fill="rgba(255,255,255,0.7)" font-weight="600" text-anchor="end">${brand}</text>

  <!-- Title -->
  ${titleSvg}

  <!-- Subtitle -->
  <text x="120" y="${subtitleY}" font-family="Inter, system-ui, Arial" font-size="28" fill="rgba(255,255,255,0.92)">${st}</text>

  <!-- Bottom info box -->
  <rect x="100" y="560" width="600" height="130" rx="24" fill="rgba(255,255,255,0.12)"/>
  <text x="130" y="610" font-family="Inter, system-ui, Arial" font-size="22" fill="#fff" font-weight="700">
    Praxis · Prompts · Workflows · DSGVO
  </text>
  <text x="130" y="650" font-family="Inter, system-ui, Arial" font-size="18" fill="rgba(255,255,255,0.85)">
    Effizient arbeiten im Berufsalltag mit KI
  </text>

  <!-- Decorative circles -->
  <circle cx="980" cy="550" r="120" fill="rgba(255,255,255,0.06)"/>
  <circle cx="1050" cy="480" r="80" fill="rgba(255,255,255,0.04)"/>
</svg>`;
}

export function svgToDataUrl(svg: string): string {
  // Encode to base64 for embedding in HTML
  const encoded = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${encoded}`;
}

export function getTierBadge(tier: string): string {
  switch (tier) {
    case "9": return "Prompt Guide · 9 €";
    case "19": return "Praxisleitfaden · 19 €";
    case "29": return "Komplettsystem · 29 €";
    default: return `Tier ${tier}`;
  }
}

export function getTierSubtitle(tier: string): string {
  switch (tier) {
    case "9": return "50+ berufsspezifische KI-Prompts";
    case "19": return "50+ Prompts · 10 Praxisfälle · Workflows";
    case "29": return "Komplett-Paket mit DSGVO & 30-Tage-Plan";
    default: return "KI im Berufsalltag";
  }
}
