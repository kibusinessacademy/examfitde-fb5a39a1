/**
 * P13 Public Funnel Empty-State + Cold-Load Guard.
 *
 * Verifies:
 *  1. /berufe, /preise and /berufe/:slug NEVER render an empty body on cold load,
 *     for both fallback slugs (fb-*) and real DB catalog slugs.
 *  2. Funnel / → /berufe → /berufe/:slug → /preise → checkout-surface works
 *     without login and without waiting on XHR/RPC responses.
 *  3. Mobile 390px: above-the-fold CTA + Beruf cards remain tappable and are
 *     not occluded by the cookie banner.
 *
 * Weight: 20 (P0 funnel guard).
 */
import { test, expect, Page } from '@playwright/test';
import fallback from '../../../src/data/publishedBerufeFallback.json';
import { dismissCookies, markJourney } from './_pre-helpers';
import { recordFinding } from '../_helpers';

type FallbackBeruf = { id: string; slug: string; title: string };

const FALLBACK_SLUGS = (fallback as FallbackBeruf[])
  .filter((b) => b.id.startsWith('fb-'))
  .map((b) => b.slug);

// Real DB catalog slugs (UUID ids in fallback file) — sample a few stable ones.
const REAL_DB_SLUGS = ['bankkaufmann-frau', 'fachkraft-fuer-lagerlogistik', 'chemielaborant-in'];

const MIN_BODY_TEXT = 400; // chars of visible text required to count as non-empty.

async function visibleBodyText(page: Page): Promise<string> {
  return (await page.locator('main, body').first().innerText().catch(() => '')) || '';
}

async function assertNonEmpty(page: Page, route: string) {
  const resp = await page.goto(route, { waitUntil: 'domcontentloaded' });
  const status = resp?.status() ?? 0;
  expect(status, `${route} HTTP status`).toBeLessThan(400);

  await dismissCookies(page);
  const text = await visibleBodyText(page);
  if (text.trim().length < MIN_BODY_TEXT) {
    recordFinding({
      severity: 'P0',
      kind: 'broken_route',
      journey: 'A',
      route,
      detail: `Cold-load body too short (${text.trim().length} chars).`,
      fix: 'SSR / static fallback für Route sicherstellen.',
    });
  }
  expect(text.trim().length, `${route} must render visible body`).toBeGreaterThanOrEqual(
    MIN_BODY_TEXT,
  );
}

test.describe('P13 Public Funnel — no empty cold-load', () => {
  test('/berufe and /preise render non-empty without login', async ({ page }) => {
    await assertNonEmpty(page, '/berufe');
    await assertNonEmpty(page, '/preise');
    markJourney('P13_hub_pricing_nonempty', 'pass');
  });

  for (const slug of FALLBACK_SLUGS.slice(0, 4)) {
    test(`/berufe/${slug} (fallback) renders non-empty`, async ({ page }) => {
      await assertNonEmpty(page, `/berufe/${slug}`);
      markJourney(`P13_fallback_${slug}`, 'pass');
    });
  }

  for (const slug of REAL_DB_SLUGS) {
    test(`/berufe/${slug} (DB catalog) renders non-empty`, async ({ page }) => {
      await assertNonEmpty(page, `/berufe/${slug}`);
      markJourney(`P13_db_${slug}`, 'pass');
    });
  }

  test('public funnel / → /berufe → /berufe/:slug → /preise → checkout-surface (no login)', async ({
    page,
  }) => {
    // 1) Home — primary CTA visible
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await dismissCookies(page);
    const homeCta = page
      .getByRole('link', { name: /beruf auswählen|prüfungstraining starten|jetzt starten/i })
      .first();
    await expect(homeCta, 'Homepage primary CTA visible').toBeVisible({ timeout: 5_000 });

    // 2) /berufe — at least 3 beruf cards
    await page.goto('/berufe', { waitUntil: 'domcontentloaded' });
    await dismissCookies(page);
    const berufLinks = page.locator('a[href*="/berufe/"]');
    await expect.poll(() => berufLinks.count(), { timeout: 5_000 }).toBeGreaterThanOrEqual(3);

    // 3) /berufe/:slug — fallback slug guarantees no API dependency
    const slug = FALLBACK_SLUGS[0];
    await page.goto(`/berufe/${slug}`, { waitUntil: 'domcontentloaded' });
    await dismissCookies(page);
    const detailText = await visibleBodyText(page);
    expect(detailText, 'detail page contains price').toMatch(/24[,.]90/);

    // 4) /preise — price + buy CTA
    await page.goto('/preise', { waitUntil: 'domcontentloaded' });
    await dismissCookies(page);
    const priceText = await visibleBodyText(page);
    expect(priceText).toMatch(/24[,.]90/);
    const buyCta = page
      .getByRole('link', { name: /kaufen|beruf auswählen|jetzt starten|prüfungstraining/i })
      .first();
    await expect(buyCta, 'Pricing CTA visible').toBeVisible();

    // 5) Checkout surface — auth or checkout route reachable, page must not be blank
    const ctaHref = await buyCta.getAttribute('href');
    if (ctaHref) {
      await page.goto(ctaHref, { waitUntil: 'domcontentloaded' });
      await dismissCookies(page);
      const checkoutText = await visibleBodyText(page);
      expect(checkoutText.trim().length, 'checkout surface non-empty').toBeGreaterThan(200);
    }
    markJourney('P13_full_funnel', 'pass');
  });

  test('mobile 390px — above-the-fold CTA + Beruf cards tappable, not hidden by cookie banner', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Find the primary CTA WITHOUT dismissing the cookie banner first —
      // it must remain visible and tappable above-the-fold even with banner up.
      const cta = page
        .getByRole('link', { name: /beruf auswählen|prüfungstraining starten|jetzt starten/i })
        .first();
      await expect(cta, 'mobile CTA visible above-the-fold').toBeVisible({ timeout: 5_000 });

      const box = await cta.boundingBox();
      expect(box, 'CTA has bounding box').not.toBeNull();
      if (box) {
        // Top of CTA must be within first viewport height (above the fold).
        expect(box.y, 'CTA above the fold').toBeLessThan(844);
        // Tap target must be at least 32px tall (accessibility-ish minimum).
        expect(box.height, 'CTA tappable size').toBeGreaterThanOrEqual(32);

        // Verify the cookie banner does not occlude the CTA: hit-test the CTA
        // center and ensure the topmost element is the CTA (or descendant).
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const occluded = await page.evaluate(
          ({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            if (!el) return 'no-element';
            const banner = el.closest('[data-cookie-banner], [class*="cookie" i], [id*="cookie" i]');
            return banner ? 'cookie-banner' : 'ok';
          },
          { x: cx, y: cy },
        );
        expect(occluded, 'CTA not occluded by cookie banner').not.toBe('cookie-banner');
      }

      // /berufe cards remain tappable on mobile after banner dismiss.
      await dismissCookies(page);
      await page.goto('/berufe', { waitUntil: 'domcontentloaded' });
      await dismissCookies(page);
      const firstCard = page.locator('a[href*="/berufe/"]').first();
      await expect(firstCard, 'first Beruf card visible on mobile').toBeVisible({ timeout: 5_000 });
      const cardBox = await firstCard.boundingBox();
      expect(cardBox, 'card has bounding box').not.toBeNull();
      if (cardBox) {
        expect(cardBox.height, 'card tappable size').toBeGreaterThanOrEqual(32);
      }
      markJourney('P13_mobile_390', 'pass');
    } finally {
      await context.close();
    }
  });
});
