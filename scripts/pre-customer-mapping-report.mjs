#!/usr/bin/env node
/**
 * Pre-Customer Mapping Report
 * ----------------------------
 * Vergleicht Cold-Load (curl Pre-Hydration) vs. Hydration (Playwright Pre-Customer
 * Reality) pro Route/Speccase und mapped das Ergebnis auf P01–P05.
 *
 * Quellen:
 *   - Cold-Load: live curl gegen BASE_URL (default https://berufos.com)
 *   - Hydration: reality-results/journey-pass/P0{1..5}*.json (CI-Artefakt)
 *
 * Evidence-Links pro Route:
 *   - Cold HTML-Snapshot:   /mnt/documents/evidence/cold/<P>.html
 *   - Cold Header-Dump:     /mnt/documents/evidence/cold/<P>.headers.txt
 *   - Hydration JSON:       reality-results/journey-pass/<file>.json
 *   - Playwright Trace/PNG: test-results/**<spec>**/* (screenshots, traces, logs)
 *
 * Output: Markdown → /mnt/documents/pre-customer-mapping-report.md + stdout.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'https://berufos.com';
const OUT = process.env.REPORT_OUT || '/mnt/documents/pre-customer-mapping-report.md';
const EVIDENCE_DIR = '/mnt/documents/evidence/cold';
const RESULTS_DIR = path.resolve(process.cwd(), 'reality-results/journey-pass');
const PW_RESULTS_DIR = path.resolve(process.cwd(), 'test-results');
const PW_REPORT_DIR = path.resolve(process.cwd(), 'playwright-report');

const ROUTES = [
  { p: 'P01', label: 'Homepage Hero-CTA', route: '/',
    spec: 'precustomer/01-homepage',
    coldPatterns: [/Prüfung starten/i, /href="\/demo"|Kostenlos testen/i] },
  { p: 'P02', label: 'Berufe Hub Shell', route: '/berufe',
    spec: 'precustomer/(02-find-beruf|14-berufe-fallback)',
    coldPatterns: [/<div id="root"/i] },
  { p: 'P03', label: 'Beruf-Detail Shell', route: '/berufe/einzelhandelskaufmann-frau',
    spec: 'precustomer/03-open-course',
    coldPatterns: [/<div id="root"/i] },
  { p: 'P04', label: 'Pricing /preise', route: '/preise',
    spec: 'precustomer/(04-pricing|13-pricing-instant)',
    coldPatterns: [/24[.,]90\s*€/, /kaufen|jetzt|starten|sichern|buchen|loslegen/i] },
  { p: 'P05', label: 'CTA → Conversion Surface', route: '/',
    spec: 'precustomer/05-cta-click',
    coldPatterns: [/href="\/(auth|checkout|preise|onboarding|quiz|demo)/i] },
];

async function fetchHtml(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'pre-customer-mapping-report/1.0' } });
    const html = await res.text();
    const headers = Object.fromEntries(res.headers.entries());
    return { status: res.status, html, headers, finalUrl: res.url };
  } catch (e) {
    return { status: 0, html: '', headers: {}, error: String(e?.message || e) };
  }
}

function saveColdEvidence(p, url, status, finalUrl, html, headers, error) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const htmlFile = path.join(EVIDENCE_DIR, `${p}.html`);
  const headerFile = path.join(EVIDENCE_DIR, `${p}.headers.txt`);
  fs.writeFileSync(htmlFile, html || `<!-- empty / fetch error: ${error || ''} -->`);
  const hdr = [
    `# Cold-Load evidence for ${p}`,
    `Requested URL : ${url}`,
    `Final URL     : ${finalUrl || '-'}`,
    `HTTP Status   : ${status}`,
    `Fetched at    : ${new Date().toISOString()}`,
    error ? `Error         : ${error}` : null,
    ``,
    `## Response headers`,
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
  ].filter(Boolean).join('\n');
  fs.writeFileSync(headerFile, hdr);
  return {
    html: path.relative('/mnt/documents', htmlFile),
    headers: path.relative('/mnt/documents', headerFile),
  };
}

function loadHydration(p) {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const files = fs.readdirSync(RESULTS_DIR).filter(f => f.toLowerCase().startsWith(p.toLowerCase()));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(path.join(RESULTS_DIR, b)).mtimeMs - fs.statSync(path.join(RESULTS_DIR, a)).mtimeMs);
  const file = files[0];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8'));
    return {
      status: j.status, detail: j.detail, ts: j.ts,
      file,
      relPath: path.relative(process.cwd(), path.join(RESULTS_DIR, file)),
    };
  } catch {
    return null;
  }
}

function findPlaywrightArtifacts(specRegex) {
  const out = [];
  if (!fs.existsSync(PW_RESULTS_DIR)) return out;
  const re = new RegExp(specRegex.replace(/\//g, '[/\\\\-]'), 'i');
  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (re.test(full)) {
          // collect leaf files
          try {
            for (const f of fs.readdirSync(full)) {
              if (/\.(png|webm|zip|txt|md|log)$/i.test(f)) {
                out.push(path.relative(process.cwd(), path.join(full, f)));
              }
            }
          } catch { /* ignore */ }
        }
        walk(full, depth + 1);
      }
    }
  };
  walk(PW_RESULTS_DIR);
  return out.slice(0, 6);
}

function emoji(ok) { return ok === true ? '✅' : ok === false ? '🔴' : '⏳'; }

function linkList(label, items) {
  if (!items || !items.length) return `_${label}: —_`;
  return items.map(i => `[${path.basename(i)}](${i})`).join(' · ');
}

async function main() {
  const rows = [];
  for (const r of ROUTES) {
    const url = BASE.replace(/\/$/, '') + r.route;
    const { status, html, headers, finalUrl, error } = await fetchHtml(url);
    const httpOk = status > 0 && status < 400;
    const matches = r.coldPatterns.map(re => re.test(html));
    const coldOk = httpOk && matches.every(Boolean);
    const missing = r.coldPatterns.map((re, i) => (matches[i] ? null : re.toString())).filter(Boolean);

    const evidence = saveColdEvidence(r.p, url, status, finalUrl, html, headers, error);
    const hyd = loadHydration(r.p);
    const hydOk = hyd ? hyd.status === 'pass' : null;
    const pwArtifacts = findPlaywrightArtifacts(r.spec);

    rows.push({
      ...r,
      url, httpStatus: error ? `ERR ${error}` : String(status),
      coldOk,
      coldDetail: coldOk ? `all ${r.coldPatterns.length} patterns matched`
        : `missing: ${missing.join(', ') || `HTTP ${status}`}`,
      coldEvidence: evidence,
      hydOk, hyd, pwArtifacts,
    });
  }

  // Markdown
  let md = `# Pre-Customer Mapping Report\n\n`;
  md += `- **Base URL:** \`${BASE}\`\n`;
  md += `- **Generated:** ${new Date().toISOString()}\n`;
  md += `- **Cold-Load:** live curl gegen Production HTML (Pre-Hydration)\n`;
  md += `- **Hydration:** \`reality-results/journey-pass/*\` (Playwright, CI)\n`;
  md += `- **Evidence-Root:** \`/mnt/documents/evidence/cold/\` (HTML + Header pro Route)\n\n`;

  md += `## Mapping P01–P05\n\n`;
  md += `| ID | Route | HTTP | Cold-Load | Hydration | Status |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const r of rows) {
    const overall =
      r.coldOk === true && r.hydOk === true ? '✅ green'
      : r.coldOk === true && r.hydOk === null ? '🟡 cold ✅ / hyd pending'
      : r.coldOk === false ? '🔴 cold fail'
      : '🔴 hyd fail';
    const hydCell = r.hyd
      ? `${emoji(r.hydOk)} ${r.hyd.status}${r.hyd.detail ? ' — ' + r.hyd.detail : ''}`
      : `⏳ CI-pending`;
    md += `| **${r.p}** ${r.label} | [\`${r.route}\`](${r.url}) | ${r.httpStatus} | ${emoji(r.coldOk)} ${r.coldDetail} | ${hydCell} | ${overall} |\n`;
  }

  md += `\n## Evidence pro Route\n\n`;
  for (const r of rows) {
    md += `### ${r.p} — ${r.label} (\`${r.route}\`)\n\n`;
    md += `- **Live:** [${r.url}](${r.url})\n`;
    md += `- **Cold HTML-Snapshot:** [\`${r.coldEvidence.html}\`](./${r.coldEvidence.html})\n`;
    md += `- **Cold Headers:** [\`${r.coldEvidence.headers}\`](./${r.coldEvidence.headers})\n`;
    if (r.hyd) {
      md += `- **Hydration JSON:** \`${r.hyd.relPath}\` (run @ ${r.hyd.ts})\n`;
    } else {
      md += `- **Hydration JSON:** _pending — wird vom CI-Workflow \`pre-customer-reality-daily.yml\` erzeugt_\n`;
    }
    md += `- **Playwright-Artefakte (\`${r.spec}\`):** ${linkList('keine lokal vorhanden', r.pwArtifacts)}\n`;
    if (fs.existsSync(PW_REPORT_DIR)) {
      md += `- **Playwright HTML-Report:** \`playwright-report/index.html\`\n`;
    }
    md += `\n`;
  }

  md += `## Drift-Analyse (Cold vs Hydration)\n\n`;
  for (const r of rows) {
    if (r.coldOk && r.hydOk === false) {
      md += `- 🔴 **${r.p}** — Cold-Load grün, Hydration fail → **Hydration-Drift** auf \`${r.route}\`. Belege: \`${r.coldEvidence.html}\`, \`${r.hyd?.relPath}\`.\n`;
    } else if (!r.coldOk && r.hydOk === true) {
      md += `- ⚠️ **${r.p}** — Hydration grün, Cold-Load fehlt → SSR/Prerender unvollständig auf \`${r.route}\`. Beleg: \`${r.coldEvidence.html}\`.\n`;
    } else if (r.coldOk && r.hydOk === null) {
      md += `- 🟡 **${r.p}** — Cold-Load grün, Hydration noch nicht gemessen → nächster CI-Run: \`pre-customer-reality-daily.yml\`.\n`;
    } else if (r.coldOk && r.hydOk === true) {
      md += `- ✅ **${r.p}** — Beide Layer grün.\n`;
    } else {
      md += `- 🔴 **${r.p}** — Beide Layer fail → P0-Blocker. Beleg: \`${r.coldEvidence.html}\`.\n`;
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md);

  console.log(md);
  console.log(`\n→ Report: ${OUT}`);
  console.log(`→ Evidence: ${EVIDENCE_DIR}/`);

  const hardFail = rows.some(r => r.coldOk === false);
  process.exit(hardFail ? 1 : 0);
}

main();
