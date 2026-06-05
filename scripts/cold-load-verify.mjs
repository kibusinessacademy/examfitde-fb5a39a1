#!/usr/bin/env node
/**
 * Cold-Load Verifier (Reality-Gate Bridge)
 * ------------------------------------------
 * Liest dist/index.html (oder index.html als Fallback) und simuliert den
 * Pre-Hydration-State pro Route via jsdom. Prüft:
 *   B1 Homepage:  Demo-CTA sichtbar (href="/demo" + Label matched)
 *   B2 /demo:     Body innerText > 200 Zeichen + mindestens ein Einstiegs-CTA
 *   P02 /berufe:  Mindestens 5 Berufslinks (/berufe/<slug>) sichtbar
 *   P04 /preise:  €/EUR-Preis sichtbar + Kauf-CTA sichtbar
 *
 * Kein Browser, kein Build nötig — verifiziert nur den index.html-Fallback,
 * der vom Reality-Gate als Cold-Load gewertet wird.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = process.cwd();
const HTML_PATH = fs.existsSync(path.join(ROOT, 'dist/index.html'))
  ? path.join(ROOT, 'dist/index.html')
  : path.join(ROOT, 'index.html');

const html = fs.readFileSync(HTML_PATH, 'utf8');

const CHECKS = [
  { id: 'P01_home_demo_cta', path: '/', validate: (doc) => {
      const demo = doc.querySelector('a[href="/demo"]');
      if (!demo) return { ok: false, detail: 'no <a href="/demo">' };
      const label = (demo.textContent || '').trim();
      if (!/demo|kostenlos|testen/i.test(label)) return { ok: false, detail: `bad label "${label}"` };
      return { ok: true, detail: `demo CTA "${label}"` };
  }},
  { id: 'P01_home_primary_cta', path: '/', validate: (doc) => {
      const t = (doc.body.textContent || '');
      if (!/Prüfung starten/i.test(t)) return { ok: false, detail: 'no "Prüfung starten"' };
      return { ok: true, detail: 'primary CTA present' };
  }},
  { id: 'B2_demo_body_gt_200', path: '/demo', validate: (doc) => {
      const t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 200) return { ok: false, detail: `body=${t.length} chars` };
      const cta = doc.querySelector('a[href^="/demo/"], a[href="/berufe"]');
      if (!cta) return { ok: false, detail: 'no demo entry CTA' };
      return { ok: true, detail: `body=${t.length} chars + CTA` };
  }},
  { id: 'P02_berufe_links', path: '/berufe', validate: (doc) => {
      const links = [...doc.querySelectorAll('a[href^="/berufe/"]')];
      if (links.length < 5) return { ok: false, detail: `links=${links.length}` };
      const visibleText = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/Beruf/i.test(visibleText)) return { ok: false, detail: 'no "Beruf" text' };
      return { ok: true, detail: `${links.length} beruf links + visible text` };
  }},
  { id: 'P02b_beruf_detail', path: '/berufe/einzelhandelskaufmann-frau', validate: (doc) => {
      const t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 200) return { ok: false, detail: `body=${t.length}` };
      if (!/Einzelhandel|Prüfungstraining/i.test(t)) return { ok: false, detail: 'no beruf-detail text' };
      const cta = doc.querySelector('a[data-cta-location^="beruf_detail_"]');
      if (!cta) return { ok: false, detail: 'no detail CTA' };
      const price = /24,90|24\.90|€/.test(t);
      if (!price) return { ok: false, detail: 'no price visible' };
      return { ok: true, detail: `body=${t.length} + CTA + €` };
  }},
  // P0.2 — additional /berufe/:slug routes the Reality-Gate exercises.
  ...[
    'kaufmann-frau-bueromanagement',
    'fachinformatiker-systemintegration',
    'kfz-mechatroniker-in',
    'bankkaufmann-frau',
    'fachkraft-fuer-lagerlogistik',
    'chemielaborant-in',
  ].map((slug) => ({
    id: `P02b_beruf_detail_${slug}`,
    path: `/berufe/${slug}`,
    validate: (doc) => {
      const t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 200) return { ok: false, detail: `body=${t.length}` };
      if (!/Prüfungstraining/i.test(t)) return { ok: false, detail: 'no "Prüfungstraining"' };
      const cta = doc.querySelector('a[data-cta-location^="beruf_detail_"]');
      if (!cta) return { ok: false, detail: 'no detail CTA' };
      if (!/24,90|24\.90|€/.test(t)) return { ok: false, detail: 'no price visible' };
      return { ok: true, detail: `body=${t.length} + CTA + €` };
    },
  })),
  { id: 'P04_pricing', path: '/preise', validate: (doc) => {
      const t = (doc.body.textContent || '');
      if (!/€|EUR/.test(t)) return { ok: false, detail: 'no €/EUR' };
      if (!/24,90|24\.90/.test(t)) return { ok: false, detail: 'no 24,90 € visible' };
      const cta = doc.querySelector('a[data-cta-location^="preise_"]');
      if (!cta) return { ok: false, detail: 'no kauf CTA' };
      return { ok: true, detail: `price + CTA` };
  }},
  // P0.6 — Demo / Exam / MiniCheck / Tutor / Oral cold-load fallbacks
  { id: 'P06_demo_journey', path: '/demo/journey', validate: (doc) => {
      const t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 200) return { ok: false, detail: `body=${t.length}` };
      const cta = doc.querySelector('a[data-cta-location^="demo_journey_"]');
      if (!cta) return { ok: false, detail: 'no journey CTA' };
      return { ok: true, detail: `body=${t.length} + CTA` };
  }},
  { id: 'P06_exam_simulation', path: '/exam-simulation', validate: (doc) => {
      const t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 200) return { ok: false, detail: `body=${t.length}` };
      const cta = doc.querySelector('a[data-cta-location^="exam_sim_"]');
      if (!cta) return { ok: false, detail: 'no exam-sim CTA' };
      return { ok: true, detail: `body=${t.length} + CTA` };
  }},
  { id: 'P06_minicheck', path: '/minicheck', validate: (doc) => {
      const t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 200) return { ok: false, detail: `body=${t.length}` };
      const cta = doc.querySelector('a[data-cta-location^="minicheck_"]');
      if (!cta) return { ok: false, detail: 'no minicheck CTA' };
      return { ok: true, detail: `body=${t.length} + CTA` };
  }},
  { id: 'P06_tutor', path: '/tutor', validate: (doc) => {
      const t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 200) return { ok: false, detail: `body=${t.length}` };
      const cta = doc.querySelector('a[data-cta-location^="tutor_"]');
      if (!cta) return { ok: false, detail: 'no tutor CTA' };
      return { ok: true, detail: `body=${t.length} + CTA` };
  }},
  { id: 'P06_oral', path: '/oral-exam', validate: (doc) => {
      const t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 200) return { ok: false, detail: `body=${t.length}` };
      const cta = doc.querySelector('a[data-cta-location^="oral_"]');
      if (!cta) return { ok: false, detail: 'no oral CTA' };
      return { ok: true, detail: `body=${t.length} + CTA` };
  }},
];

let pass = 0, fail = 0;
const rows = [];
for (const c of CHECKS) {
  const dom = new JSDOM(html, { url: `https://example.com${c.path}`, runScripts: 'dangerously' });
  // give inline pre-hydration script a tick
  const res = c.validate(dom.window.document);
  rows.push({ id: c.id, path: c.path, ...res });
  if (res.ok) pass++; else fail++;
  console.log(`${res.ok ? '✅' : '❌'} ${c.id.padEnd(28)} ${c.path.padEnd(10)} ${res.detail}`);
  dom.window.close();
}

console.log(`\n${pass}/${pass + fail} cold-load checks pass`);
process.exit(fail === 0 ? 0 : 1);
