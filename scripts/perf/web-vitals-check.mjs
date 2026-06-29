#!/usr/bin/env node
/**
 * Web Vitals Performance Check
 * Measures LCP & CLS on key shop/PDP routes to verify
 * sizes/srcSet/fetchPriority changes on course images.
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 node scripts/perf/web-vitals-check.mjs
 *   BASE_URL=https://examfitde.lovable.app node scripts/perf/web-vitals-check.mjs
 *
 * Optional:
 *   ROUTES="/berufe,/fiae-pruefungsvorbereitung" node scripts/perf/web-vitals-check.mjs
 *   DEVICE=mobile|desktop (default: both)
 *   OUT=reports/web-vitals.json
 *
 * Thresholds (Core Web Vitals "good"):
 *   LCP <= 2500ms, CLS <= 0.1
 * Exits non-zero if any route exceeds budget.
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

// Resolve a chromium binary even when node-playwright browsers aren't installed.
function resolveChromiumExecutable() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const candidates = [
    '/chromium_headless_shell-1194/chrome-linux/headless_shell',
    '/chromium-1194/chrome-linux/chrome',
    '/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  return candidates.find((p) => existsSync(p)) || undefined;
}
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const ROUTES = (process.env.ROUTES || [
  // Shop / Storefront catalogs (CoursePremiumCard grid)
  '/examfit',
  '/berufe',
  '/preise',                                  // Pricing landing
  // Hubs (CoursePremiumCard)
  '/pruefungstraining',
  '/pruefungstraining-azubis',
  // Category PDPs (PruefungstrainingCategoryPage)
  '/pruefungstraining/ausbildung',
  '/pruefungstraining/fachwirt',
  '/pruefungstraining/meister',
  '/pruefungstraining/aevo',
  // SEO certification PDP heroes (ProductHeroSection / CertificationSEOPage)
  '/fiae-pruefungsvorbereitung',
  '/bilanzbuchhalter-pruefungsvorbereitung',
  '/ihk-pruefungsvorbereitung',
  '/aevo-pruefungsvorbereitung',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const DEVICES = (process.env.DEVICE
  ? [process.env.DEVICE]
  : ['mobile', 'desktop']
);

const OUT = process.env.OUT || 'reports/web-vitals.json';

const VIEWPORTS = {
  mobile:  { width: 390,  height: 844,  deviceScaleFactor: 3, isMobile: true,  hasTouch: true,
             userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' },
  desktop: { width: 1366, height: 900,  deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

const BUDGET = {
  LCP_MS: Number(process.env.LCP_BUDGET_MS || 2500),
  CLS:    Number(process.env.CLS_BUDGET    || 0.1),
};

const VITALS_SCRIPT = `
window.__vitals = { lcp: null, cls: 0, lcpElement: null };
try {
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    if (last) {
      window.__vitals.lcp = last.renderTime || last.loadTime || last.startTime;
      const el = last.element;
      window.__vitals.lcpElement = el ? (el.tagName + (el.id ? '#' + el.id : '') +
        (el.src ? ' src=' + el.src.slice(0, 120) : '')) : null;
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch (e) {}
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) window.__vitals.cls += entry.value;
    }
  }).observe({ type: 'layout-shift', buffered: true });
} catch (e) {}
`;

async function measure(browser, route, deviceName) {
  const vp = VIEWPORTS[deviceName];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    userAgent: vp.userAgent,
  });
  const page = await context.newPage();
  await page.addInitScript(VITALS_SCRIPT);
  const url = BASE_URL.replace(/\/$/, '') + route;
  const t0 = Date.now();
  let status = 0;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    status = resp?.status() ?? 0;
  } catch (err) {
    await context.close();
    return { route, device: deviceName, error: String(err.message || err), ok: false };
  }
  // Allow late LCP/CLS to settle
  await page.waitForTimeout(1500);
  const vitals = await page.evaluate(() => window.__vitals);
  const loadMs = Date.now() - t0;
  await context.close();

  const lcp = vitals.lcp ? Math.round(vitals.lcp) : null;
  const cls = Number(vitals.cls?.toFixed?.(4) ?? 0);
  const lcpOk = lcp != null && lcp <= BUDGET.LCP_MS;
  const clsOk = cls <= BUDGET.CLS;
  return {
    route, device: deviceName, status, loadMs,
    lcp_ms: lcp, cls,
    lcp_element: vitals.lcpElement,
    budget: BUDGET,
    pass: lcpOk && clsOk && status === 200,
    failures: [
      ...(status !== 200 ? [`HTTP ${status}`] : []),
      ...(!lcpOk ? [`LCP ${lcp}ms > ${BUDGET.LCP_MS}ms`] : []),
      ...(!clsOk ? [`CLS ${cls} > ${BUDGET.CLS}`] : []),
    ],
  };
}

(async () => {
  console.log(`▶ Web Vitals check @ ${BASE_URL}`);
  console.log(`  routes: ${ROUTES.join(', ')}`);
  console.log(`  devices: ${DEVICES.join(', ')}`);
  console.log(`  budget: LCP≤${BUDGET.LCP_MS}ms, CLS≤${BUDGET.CLS}`);

  const executablePath = resolveChromiumExecutable();
  if (executablePath) console.log(`  chromium: ${executablePath}`);
  const browser = await chromium.launch({ headless: true, executablePath });
  const results = [];
  for (const route of ROUTES) {
    for (const device of DEVICES) {
      process.stdout.write(`  • ${device.padEnd(7)} ${route} ... `);
      const r = await measure(browser, route, device);
      results.push(r);
      if (r.error) {
        console.log(`ERROR: ${r.error}`);
      } else {
        console.log(`${r.pass ? '✓ PASS' : '✗ FAIL'}  LCP=${r.lcp_ms ?? '–'}ms  CLS=${r.cls}  (${r.loadMs}ms total)`);
        if (r.lcp_element) console.log(`      LCP element: ${r.lcp_element}`);
        if (r.failures.length) console.log(`      ${r.failures.join('; ')}`);
      }
    }
  }
  await browser.close();

  const summary = {
    base_url: BASE_URL,
    generated_at: new Date().toISOString(),
    budget: BUDGET,
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(summary, null, 2));
  console.log(`\n→ Report: ${OUT}`);
  console.log(`  ${summary.passed}/${summary.total} passed`);

  process.exit(summary.failed > 0 ? 1 : 0);
})();
