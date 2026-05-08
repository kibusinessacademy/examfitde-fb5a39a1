/**
 * Mobile overlap regression — Cookie banner must NEVER cover sticky CTAs
 * on small viewports (390x844 iPhone 12/13/14 · 430x932 iPhone 14/15 Pro Max).
 *
 * Run:  npx playwright test --project=mobile-overlap
 * Targets BASE_URL (default: preview deployment, see playwright.config.ts).
 */
import { test, expect, type Page, type Locator } from '@playwright/test';

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
];

const ROUTES = [
  { name: 'home',     path: '/' },
  { name: 'beruf',    path: '/berufe/bankkaufmann' },
  { name: 'bundle',   path: '/bundle/bankkaufmann' },
  { name: 'check',    path: '/pruefungsreife-check?source=beruf&slug=bankkaufmann' },
];

type ConsentState = 'pending' | 'rejected' | 'accepted';

async function applyConsent(page: Page, state: ConsentState) {
  await page.addInitScript((s) => {
    try {
      if (s === 'pending') {
        localStorage.removeItem('ef_consent_v1');
      } else if (s === 'rejected') {
        localStorage.setItem('ef_consent_v1', JSON.stringify({ analytics: false, ad: false }));
      } else {
        localStorage.setItem('ef_consent_v1', JSON.stringify({ analytics: true, ad: true }));
      }
    } catch {
      /* storage blocked */
    }
  }, state);
}

/** Force-trigger sticky CTAs by scrolling to ~50% of the page. */
async function revealStickyCtas(page: Page) {
  await page.evaluate(() => {
    const target = document.documentElement.scrollHeight * 0.55;
    window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
  });
  // marketing StickyCTA waits ~2s on mobile after scroll threshold
  await page.waitForTimeout(2400);
}

/** Assert two visible boxes don't intersect (allowing 1px AA slop). */
export async function expectNoOverlap(a: Locator, b: Locator) {
  const [boxA, boxB] = await Promise.all([a.boundingBox(), b.boundingBox()]);
  expect(boxA, 'locator A has no bounding box').not.toBeNull();
  expect(boxB, 'locator B has no bounding box').not.toBeNull();
  if (!boxA || !boxB) return;
  const overlap =
    boxA.x < boxB.x + boxB.width - 1 &&
    boxA.x + boxA.width > boxB.x + 1 &&
    boxA.y < boxB.y + boxB.height - 1 &&
    boxA.y + boxA.height > boxB.y + 1;
  expect(
    overlap,
    `Overlap detected: A=${JSON.stringify(boxA)} B=${JSON.stringify(boxB)}`,
  ).toBe(false);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal scrollbar present').toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
  test.describe(`Cookie-Banner vs Sticky-CTA · ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const route of ROUTES) {
      test(`[A pending] ${route.name} — banner visible, no overlap`, async ({ page }) => {
        await applyConsent(page, 'pending');
        await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        const banner = page.getByTestId('cookie-banner');
        await expect(banner, 'banner should be visible').toBeVisible({ timeout: 5000 });
        await expectNoHorizontalScroll(page);

        await revealStickyCtas(page);

        const sticky = page.getByTestId('sticky-cta').first();
        const stickyCount = await page.getByTestId('sticky-cta').count();
        if (stickyCount > 0) {
          await expect(sticky).toBeVisible();
          await expectNoOverlap(sticky, banner);
        }

        // Banner buttons must remain interactive (not occluded).
        await expect(banner.getByRole('button', { name: /alle akzeptieren/i })).toBeVisible();
        await expect(banner.getByRole('button', { name: /alle ablehnen/i })).toBeVisible();
      });

      test(`[B rejected] ${route.name} — sticky CTA flush bottom`, async ({ page }) => {
        await applyConsent(page, 'rejected');
        await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
        await expectNoHorizontalScroll(page);
        await revealStickyCtas(page);
        const sticky = page.getByTestId('sticky-cta').first();
        if ((await page.getByTestId('sticky-cta').count()) > 0) {
          const box = await sticky.boundingBox();
          expect(box, 'sticky CTA should have a box').not.toBeNull();
          if (box) {
            // Should sit within ~12px of the viewport bottom (no banner pushing it up).
            expect(vp.height - (box.y + box.height)).toBeLessThanOrEqual(16);
          }
        }
      });

      test(`[C accepted] ${route.name} — sticky CTA flush bottom`, async ({ page }) => {
        await applyConsent(page, 'accepted');
        await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
        await expectNoHorizontalScroll(page);
        await revealStickyCtas(page);
        const sticky = page.getByTestId('sticky-cta').first();
        if ((await page.getByTestId('sticky-cta').count()) > 0) {
          const box = await sticky.boundingBox();
          if (box) {
            expect(vp.height - (box.y + box.height)).toBeLessThanOrEqual(16);
          }
        }
      });
    }
  });
}
