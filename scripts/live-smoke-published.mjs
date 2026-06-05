#!/usr/bin/env node
/**
 * Live Published Smoke (Reality Gate Pre-Flight)
 * ──────────────────────────────────────────────────────────────────
 * Hits the *deployed* base URL with plain HTTP fetches (no browser,
 * no JS hydration) and verifies that the new build is actually live
 * before the Customer Reality Gate spends ~25 min on Playwright.
 *
 * Why: cold-load-verify.mjs runs against the local repo's index.html
 * — it proves the SOURCE is correct, not the DEPLOY. This script
 * proves the DEPLOY is correct.
 *
 * Checks (all against `${REALITY_BASE_URL}<path>`):
 *   1. /berufe       → ≥ 10 distinct /berufe/<slug> anchors
 *   2. /preise       → "24,90" present in body
 *   3. /oral-exam    → "oral-exam-surface" OR "Prüfungstraining" present
 *
 * Exit 0 on success, 2 on failure (fail-fast for the workflow gate).
 *
 * Env:
 *   REALITY_BASE_URL  required (e.g. https://examfitde.lovable.app or https://berufos.com)
 */
const BASE = (process.env.REALITY_BASE_URL || '').replace(/\/$/, '');
if (!BASE) {
  console.error('FAIL: REALITY_BASE_URL not set');
  process.exit(2);
}

const UA =
  'LovableRealityGate-LiveSmoke/1.0 (+https://github.com/lovable-dev)';

async function fetchText(pathname) {
  const url = `${BASE}${pathname}`;
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const body = await res.text();
  return { url, body, finalUrl: res.url };
}

const CHECKS = [
  {
    id: 'live_berufe_links',
    path: '/berufe',
    validate: ({ body }) => {
      const matches = body.match(/href="\/berufe\/[a-z0-9-]+"/gi) || [];
      const unique = new Set(matches.map((m) => m.toLowerCase()));
      if (unique.size < 10) {
        return { ok: false, detail: `only ${unique.size} unique /berufe/<slug> links (need ≥10)` };
      }
      return { ok: true, detail: `${unique.size} unique beruf links` };
    },
  },
  {
    id: 'live_preise_price',
    path: '/preise',
    validate: ({ body }) => {
      if (!/24,90/.test(body)) {
        return { ok: false, detail: 'price "24,90" not in body' };
      }
      return { ok: true, detail: 'price 24,90 present' };
    },
  },
  {
    id: 'live_oral_surface',
    path: '/oral-exam',
    validate: ({ body }) => {
      const hasSurface = /oral-exam-surface/.test(body);
      const hasCopy = /Prüfungstraining|mündliche prüfung/i.test(body);
      if (!hasSurface && !hasCopy) {
        return {
          ok: false,
          detail: 'neither "oral-exam-surface" nor "Prüfungstraining" found',
        };
      }
      return {
        ok: true,
        detail: `surface=${hasSurface} copy=${hasCopy}`,
      };
    },
  },
];

let failed = 0;
console.log(`\n=== Live Smoke against ${BASE} ===`);
for (const c of CHECKS) {
  try {
    const res = await fetchText(c.path);
    const r = c.validate(res);
    if (r.ok) {
      console.log(`✅ ${c.id.padEnd(28)} ${c.path.padEnd(12)} ${r.detail}`);
    } else {
      failed++;
      console.log(`❌ ${c.id.padEnd(28)} ${c.path.padEnd(12)} ${r.detail}`);
    }
  } catch (e) {
    failed++;
    console.log(`❌ ${c.id.padEnd(28)} ${c.path.padEnd(12)} ${e.message}`);
  }
}

console.log(
  `\n${failed === 0 ? '✅' : '❌'} ${CHECKS.length - failed}/${CHECKS.length} live smoke checks pass\n`,
);
process.exit(failed === 0 ? 0 : 2);
