/**
 * KIMI.3.5 — SPA-Aware Snapshot Layer
 *
 * Doktrin: Der Auditor misst, was ein echter Mensch nach vollständiger
 * Hydration sieht — nicht den rohen HTML-Bundle-Skelett der SPA.
 *
 * Strategie:
 *   1) goto(route, waitUntil='networkidle')  mit Fallback auf domcontentloaded
 *   2) Hydration-Wait: poll body.innerText.length bis stabil ODER bekannte
 *      App-Anker sichtbar (#root mit Children, [data-app-ready], main, h1)
 *   3) Cookies dismissen, kurz settlen
 *   4) Extraktion (text / ctas / headings / orientation / testids)
 *   5) Soft-Retry: falls text<200b UND cta=0 UND orient=0  →  +3s warten,
 *      einmal neu extrahieren (deckt langsam-hydrierende Routen ab)
 *
 * Liefert zusätzlich:
 *   hydration_state : 'ready' | 'slow' | 'empty'
 *   hydration_ms    : Zeit bis Hydration-Stabilität
 *   wait_strategy   : 'networkidle' | 'domcontentloaded-fallback'
 */

const NOISE = [
  /cookie/i, /consent/i, /datenschutz/i, /privacy/i, /impressum/i, /agb/i,
  /akzeptieren/i, /alle erlauben/i, /ablehnen/i, /usercentrics/i, /borlabs/i,
];

export function stripNoise(t) {
  if (!t) return t;
  return t.split('\n').filter((l) => {
    const s = l.trim();
    if (!s) return false;
    if (s.length < 80 && NOISE.some((p) => p.test(s))) return false;
    return true;
  }).join('\n');
}

export function filterNoise(arr, keyer) {
  return arr.filter((x) => !NOISE.some((p) => p.test(keyer(x))));
}

export async function dismissCookies(page) {
  for (const re of [/akzeptieren/i, /alle erlauben/i, /accept/i]) {
    const btn = page.getByRole('button', { name: re }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(400);
      return;
    }
  }
}

/**
 * Wait for SPA hydration: poll body text length until stable across two
 * consecutive samples ≥ minStableMs apart, OR until app-anchor selectors
 * indicate the React tree mounted, OR until budget exhausted.
 */
async function waitForHydration(page, { budgetMs = 6000, minStableMs = 500 } = {}) {
  const t0 = Date.now();
  let lastLen = -1;
  let stableSince = 0;
  while (Date.now() - t0 < budgetMs) {
    const len = await page.evaluate(() => (document.body?.innerText || '').length).catch(() => 0);
    // Anchor check: #root has children + (main|h1|[role=main]) present
    const anchored = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root || root.childElementCount === 0) return false;
      return !!(document.querySelector('main, [role="main"], h1, [data-app-ready]'));
    }).catch(() => false);

    if (len === lastLen && len > 200) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= minStableMs && anchored) {
        return { ms: Date.now() - t0, state: 'ready', len };
      }
    } else {
      stableSince = 0;
      lastLen = len;
    }
    await page.waitForTimeout(150);
  }
  const finalLen = await page.evaluate(() => (document.body?.innerText || '').length).catch(() => 0);
  return {
    ms: Date.now() - t0,
    state: finalLen > 200 ? 'slow' : 'empty',
    len: finalLen,
  };
}

async function extract(page) {
  const finalUrl = page.url();
  const title = await page.title().catch(() => '');
  const raw = (await page.locator('body').innerText().catch(() => '')) || '';
  const text = stripNoise(raw).slice(0, 4000);
  const headings = await page
    .$$eval('h1, h2', (els) => els.map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 10))
    .catch(() => []);
  const rc = await page
    .$$eval('button, [role="button"], a[href]', (els) => els.map((e) => {
      const tag = e.tagName.toLowerCase();
      const label = (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 80);
      const href = e.getAttribute('href') || '';
      const role = e.getAttribute('role') || '';
      const testid = e.getAttribute('data-testid') || '';
      const type = tag === 'a' ? (href.startsWith('#') ? 'anchor' : 'link') : (role === 'button' ? 'role-button' : 'button');
      return { tag, type, label, href, testid };
    }).filter((c) => c.label && c.type !== 'anchor').slice(0, 60))
    .catch(() => []);
  const ctas = filterNoise(rc, (c) => `${c.label} ${c.href}`).slice(0, 30);
  const testids = await page
    .$$eval('[data-testid]', (els) => Array.from(new Set(els.map((e) => e.getAttribute('data-testid')).filter(Boolean))).slice(0, 60))
    .catch(() => []);
  const orientation_markers = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-testid="journey-stepper"]').forEach((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
      if (t) out.push(`stepper:${t}`);
    });
    document.querySelectorAll('[aria-current="step"], [aria-current="page"]').forEach((el) => {
      const t = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 80);
      if (t) out.push(`active:${t}`);
    });
    document.querySelectorAll('nav[aria-label*="readcrumb" i], [data-testid*="breadcrumb" i]').forEach((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (t) out.push(`breadcrumb:${t}`);
    });
    return out.slice(0, 8);
  }).catch(() => []);
  return { finalUrl, title, text, headings, ctas, testids, orientation_markers };
}

/**
 * spaSnapshot(ctx, route, { baseUrl, fresh })
 *
 * SPA-aware snapshot. Returns the same shape that journey scripts feed into
 * the kimi-reality-auditor (visible_text, ctas, headings, orientation_markers, …),
 * plus hydration diagnostics.
 */
export async function spaSnapshot(ctx, route, { baseUrl, fresh = false } = {}) {
  let useCtx = ctx, ownCtx = null;
  if (fresh) {
    ownCtx = await ctx.browser().newContext({ viewport: { width: 1280, height: 900 } });
    useCtx = ownCtx;
  }
  const page = await useCtx.newPage();
  const target = baseUrl + route;
  let finalUrl = target, title = '', text = '';
  let ctas = [], testids = [], headings = [];
  let orientation_markers = [];
  let nav_error = null;
  let wait_strategy = 'networkidle';
  let hydration = { ms: 0, state: 'empty', len: 0 };

  try {
    try {
      await page.goto(target, { waitUntil: 'networkidle', timeout: 15_000 });
    } catch {
      // networkidle never settles (open WebSockets, polling) → fallback
      wait_strategy = 'domcontentloaded-fallback';
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    }
    hydration = await waitForHydration(page, { budgetMs: 6000, minStableMs: 500 });
    await dismissCookies(page);
    await page.waitForTimeout(400);

    let ex = await extract(page);
    // Soft-retry for slow SPAs: nothing meaningful yet → wait & retry once
    if (
      (ex.text.length < 200 && ex.ctas.length === 0 && ex.orientation_markers.length === 0) ||
      hydration.state === 'empty'
    ) {
      await page.waitForTimeout(3000);
      const ex2 = await extract(page);
      if (ex2.text.length + ex2.ctas.length * 20 > ex.text.length + ex.ctas.length * 20) {
        ex = ex2;
        hydration = { ...hydration, state: ex2.text.length > 200 ? 'slow' : 'empty' };
      }
    }

    finalUrl = ex.finalUrl;
    title = ex.title;
    text = ex.text;
    headings = ex.headings;
    ctas = ex.ctas;
    testids = ex.testids;
    orientation_markers = ex.orientation_markers;
  } catch (e) {
    nav_error = String(e).slice(0, 400);
  } finally {
    await page.close().catch(() => {});
    if (ownCtx) await ownCtx.close().catch(() => {});
  }

  const orientPrefix = orientation_markers.length
    ? `[ORIENTATION_MARKERS] ${orientation_markers.join(' | ')}\n\n`
    : '';
  const hydrationPrefix = `[HYDRATION] state=${hydration.state} ms=${hydration.ms} body_len=${hydration.len} wait=${wait_strategy}\n\n`;

  return {
    route,
    requested_url: target,
    final_url: finalUrl,
    auth_lost: /\/auth(\b|\/|\?)/.test(finalUrl) && route !== '/auth',
    nav_error,
    title,
    visible_text: (hydrationPrefix + orientPrefix + text).slice(0, 4400),
    headings,
    ctas,
    cta_labels: ctas.map((c) => c.label),
    cta_count: ctas.length,
    testids,
    orientation_markers,
    hydration_state: hydration.state,
    hydration_ms: hydration.ms,
    wait_strategy,
  };
}
