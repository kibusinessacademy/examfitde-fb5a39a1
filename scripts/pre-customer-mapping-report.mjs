#!/usr/bin/env node
/**
 * Pre-Customer Mapping Report
 * ----------------------------
 * Vergleicht Cold-Load (curl + jsdom Pre-Hydration) vs. Hydration (Playwright
 * Pre-Customer Reality, falls reality-results/ vorhanden) pro Route/Speccase
 * und mapped das Ergebnis auf P01–P05.
 *
 * Quellen:
 *   - Cold-Load:   live curl gegen BASE_URL (default https://berufos.com)
 *   - Hydration:   reality-results/journey-pass/P0{1..5}*.json (CI-Artefakt)
 *
 * Output: Markdown nach /mnt/documents/pre-customer-mapping-report.md
 *         + stdout-Tabelle.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'https://berufos.com';
const OUT = process.env.REPORT_OUT || '/mnt/documents/pre-customer-mapping-report.md';
const RESULTS_DIR = path.resolve(process.cwd(), 'reality-results/journey-pass');

const ROUTES = [
  { p: 'P01', label: 'Homepage Hero-CTA', route: '/',
    coldPatterns: [/Prüfung starten/i, /Kostenlos testen|href="\/demo"/i] },
  { p: 'P02', label: 'Berufe Fallback-Liste', route: '/berufe',
    coldPatterns: [/\/berufe\/[a-z][a-z-]{3,}/i] },
  { p: 'P03', label: 'Course Discovery', route: '/berufe/einzelhandelskaufmann-frau',
    coldPatterns: [/€|EUR/i, /starten|kaufen|sichern|buchen|loslegen/i] },
  { p: 'P04', label: 'Pricing /preise', route: '/preise',
    coldPatterns: [/24[.,]90\s*€/, /kaufen|jetzt|starten|sichern|buchen|loslegen/i] },
  { p: 'P05', label: 'CTA → Conversion Surface', route: '/berufe',
    coldPatterns: [/\/auth|\/checkout|\/preise|\/onboarding|\/quiz|\/demo/i] },
];

async function fetchHtml(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'pre-customer-mapping-report/1.0' } });
    return { status: res.status, html: await res.text() };
  } catch (e) {
    return { status: 0, html: '', error: String(e?.message || e) };
  }
}

function loadHydration(p) {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const files = fs.readdirSync(RESULTS_DIR).filter(f => f.startsWith(p) || f.toLowerCase().startsWith(p.toLowerCase()));
  if (!files.length) return null;
  // newest wins
  files.sort((a, b) => fs.statSync(path.join(RESULTS_DIR, b)).mtimeMs - fs.statSync(path.join(RESULTS_DIR, a)).mtimeMs);
  try {
    const j = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, files[0]), 'utf8'));
    return { status: j.status, detail: j.detail, ts: j.ts, file: files[0] };
  } catch {
    return null;
  }
}

function emoji(ok) { return ok === true ? '✅' : ok === false ? '🔴' : '⏳'; }

async function main() {
  const rows = [];
  for (const r of ROUTES) {
    const url = BASE.replace(/\/$/, '') + r.route;
    const { status, html, error } = await fetchHtml(url);
    const httpOk = status > 0 && status < 400;
    const matches = r.coldPatterns.map(re => re.test(html));
    const coldOk = httpOk && matches.every(Boolean);
    const missing = r.coldPatterns
      .map((re, i) => (matches[i] ? null : re.toString()))
      .filter(Boolean);

    const hyd = loadHydration(r.p);
    const hydOk = hyd ? hyd.status === 'pass' : null;

    rows.push({
      p: r.p,
      label: r.label,
      route: r.route,
      httpStatus: error ? `ERR ${error}` : String(status),
      coldOk,
      coldDetail: coldOk
        ? `all ${r.coldPatterns.length} patterns matched`
        : `missing: ${missing.join(', ') || `HTTP ${status}`}`,
      hydOk,
      hydDetail: hyd ? `${hyd.status}${hyd.detail ? ' — ' + hyd.detail : ''} (${hyd.file})` : 'CI-pending (no reality-results/)',
    });
  }

  // Markdown
  let md = `# Pre-Customer Mapping Report\n\n`;
  md += `- **Base URL:** \`${BASE}\`\n`;
  md += `- **Generated:** ${new Date().toISOString()}\n`;
  md += `- **Cold-Load:** live curl gegen Production HTML (Pre-Hydration)\n`;
  md += `- **Hydration:** \`reality-results/journey-pass/*\` (Playwright, CI)\n\n`;
  md += `## Mapping P01–P05\n\n`;
  md += `| ID | Route | HTTP | Cold-Load | Hydration | Status |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const r of rows) {
    const overall =
      r.coldOk === true && r.hydOk === true ? '✅ green'
      : r.coldOk === true && r.hydOk === null ? '🟡 cold ✅ / hyd pending'
      : r.coldOk === false ? '🔴 cold fail'
      : '🔴 hyd fail';
    md += `| **${r.p}** ${r.label} | \`${r.route}\` | ${r.httpStatus} | ${emoji(r.coldOk)} ${r.coldDetail} | ${emoji(r.hydOk)} ${r.hydDetail} | ${overall} |\n`;
  }

  md += `\n## Drift-Analyse (Cold vs Hydration)\n\n`;
  for (const r of rows) {
    if (r.coldOk && r.hydOk === false) {
      md += `- 🔴 **${r.p}** — Cold-Load grün, aber Hydration fail → **Hydration-Drift** auf \`${r.route}\`. Fix: ${r.hydDetail}\n`;
    } else if (!r.coldOk && r.hydOk === true) {
      md += `- ⚠️ **${r.p}** — Hydration grün, aber Cold-Load fehlt → SSR/Prerender unvollständig auf \`${r.route}\`.\n`;
    } else if (r.coldOk && r.hydOk === null) {
      md += `- 🟡 **${r.p}** — Cold-Load grün, Hydration noch nicht gemessen → nächster CI-Run: \`pre-customer-reality-daily.yml\`.\n`;
    } else if (r.coldOk && r.hydOk === true) {
      md += `- ✅ **${r.p}** — Beide Layer grün.\n`;
    } else {
      md += `- 🔴 **${r.p}** — Beide Layer fail → P0-Blocker.\n`;
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md);

  // stdout
  console.log(md);
  console.log(`\n→ Report geschrieben: ${OUT}`);

  // Exit-Code: fail nur bei echten Cold-Load-Regressions
  const hardFail = rows.some(r => r.coldOk === false);
  process.exit(hardFail ? 1 : 0);
}

main();
