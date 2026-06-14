/**
 * KIMI.3.6 — B2B Route Render Guard
 *
 * Ensures /org/enterprise, /app/org and /org/einladung/<invalid> render
 * contentful UI (no skeleton-only screens) once hydration is ready.
 *
 * Acceptance (per KIMI.3.6):
 *   Route                          text ≥   CTA ≥
 *   /org/enterprise                3000     2
 *   /app/org                       1200     2
 *   /org/einladung/<invalid>       800      2
 *
 * All routes: hydration ready, no skeleton-only screen, has <h1>.
 */
import { test, expect, Page } from '@playwright/test';

type RouteSpec = {
  path: string;
  minText: number;
  minCtas: number;
  label: string;
};

const ROUTES: RouteSpec[] = [
  { path: '/org/enterprise', minText: 3000, minCtas: 2, label: 'public_enterprise_landing' },
  { path: '/app/org', minText: 1200, minCtas: 2, label: 'org_console_no_org_fallback' },
  {
    path: `/org/einladung/${encodeURIComponent('invalid-token-kimi-36')}`,
    minText: 800,
    minCtas: 2,
    label: 'invite_invalid_recovery',
  },
];

async function waitForHydration(page: Page) {
  // Hydration heuristic: <h1> visible AND no full-screen skeleton blocker.
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => {
      const h1 = document.querySelector('h1');
      const hasH1Text = !!h1 && (h1.textContent || '').trim().length > 0;
      // Skeleton-only detection: body text is essentially empty AND skeletons exist.
      const skeletons = document.querySelectorAll('[data-skeleton], .skeleton, [class*="skeleton"]');
      const bodyText = (document.body.innerText || '').trim();
      const isSkeletonOnly = bodyText.length < 200 && skeletons.length > 3;
      return hasH1Text && !isSkeletonOnly;
    },
    { timeout: 15_000 },
  );
}

for (const route of ROUTES) {
  test(`[B2B render] ${route.label} (${route.path}) is contentful`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);

    // 1. <h1> present + non-empty
    const h1Text = (await page.locator('h1').first().innerText()).trim();
    expect(h1Text.length, `${route.label}: <h1> must render text`).toBeGreaterThan(0);

    // 2. Body text volume
    const bodyText = await page.evaluate(() => (document.body.innerText || '').trim());
    expect(
      bodyText.length,
      `${route.label}: body text must be ≥ ${route.minText}b (got ${bodyText.length})`,
    ).toBeGreaterThanOrEqual(route.minText);

    // 3. CTA count (buttons + links acting as CTAs)
    const ctaCount = await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('a[href], button'),
      ) as HTMLElement[];
      return nodes.filter((el) => {
        const txt = (el.innerText || '').trim();
        if (!txt || txt.length < 2) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length;
    });
    expect(
      ctaCount,
      `${route.label}: visible CTAs must be ≥ ${route.minCtas} (got ${ctaCount})`,
    ).toBeGreaterThanOrEqual(route.minCtas);

    // 4. Not skeleton-only
    const skeletonOnly = await page.evaluate(() => {
      const skeletons = document.querySelectorAll(
        '[data-skeleton], .skeleton, [class*="skeleton"]',
      );
      const bodyLen = (document.body.innerText || '').trim().length;
      return skeletons.length > 3 && bodyLen < 200;
    });
    expect(skeletonOnly, `${route.label}: must not be skeleton-only`).toBe(false);
  });
}
