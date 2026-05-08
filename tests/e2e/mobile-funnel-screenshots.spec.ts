/**
 * Mini-Sprint 2 — Mobile Funnel Screenshot Pack
 *
 * Generates reproducible 390/430 screenshots for the conversion funnel.
 *
 * Usage:
 *   E2E_TARGET=preview npx playwright test --project=mobile-screenshots
 *   E2E_TARGET=production npx playwright test --project=mobile-screenshots
 *
 * Output: artifacts/mobile-funnel-screenshots/{viewport}/{route-state}.png
 *
 * Findings (horizontal scroll, sticky-cta visibility, banner overlap) are
 * collected and printed at the end as a Markdown table.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
] as const;

const OUT_ROOT = path.resolve('artifacts/mobile-funnel-screenshots');
fs.mkdirSync(OUT_ROOT, { recursive: true });

type Finding = {
  viewport: string;
  shot: string;
  hScroll: boolean;
  bannerOverlap: boolean;
  ctaVisible: boolean | null;
  notes: string[];
};
const findings: Finding[] = [];

async function dismissOrAcceptBanner(page: Page, mode: 'pending' | 'accepted') {
  if (mode === 'accepted') {
    // Pre-seed consent so banner does not render on initial paint
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'ef_consent_v1',
          JSON.stringify({ status: 'accepted', categories: ['necessary', 'analytics', 'marketing'], ts: Date.now() }),
        );
      } catch {}
    });
  } else {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('ef_consent_v1');
      } catch {}
    });
  }
}

async function audit(page: Page, viewport: string, shot: string) {
  const f: Finding = { viewport, shot, hScroll: false, bannerOverlap: false, ctaVisible: null, notes: [] };

  // horizontal scroll
  f.hScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

  // banner + sticky cta overlap
  const banner = page.locator('[data-testid="cookie-banner"]').first();
  const cta = page.locator('[data-testid="sticky-cta"]').first();
  const bannerVisible = await banner.isVisible().catch(() => false);
  const ctaVisible = await cta.isVisible().catch(() => false);
  f.ctaVisible = ctaVisible;

  if (bannerVisible && ctaVisible) {
    const a = await banner.boundingBox();
    const b = await cta.boundingBox();
    if (a && b) {
      const overlap = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top + 1 || b.bottom <= a.top + 1);
      f.bannerOverlap = overlap;
    }
  }

  // headline clipping (heuristic): h1/h2 with scrollWidth > clientWidth
  const clipped = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('h1, h2'));
    return els.filter((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1).length;
  });
  if (clipped > 0) f.notes.push(`headline-clip:${clipped}`);

  findings.push(f);
}

async function shoot(page: Page, viewport: string, name: string) {
  const dir = path.join(OUT_ROOT, viewport);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  await audit(page, viewport, name);
}

for (const vp of VIEWPORTS) {
  test.describe(`mobile-funnel-screenshots @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`pending — full route sweep`, async ({ page }) => {
      await dismissOrAcceptBanner(page, 'pending');

      // 1. Home
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await shoot(page, vp.name, '01-home-hero-pending');
      // scroll to demo gallery
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.4));
      await page.waitForTimeout(500);
      await shoot(page, vp.name, '02-home-demo-gallery-pending');

      // 2. Beruf
      await page.goto('/berufe/bankkaufmann', { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(800);
      await shoot(page, vp.name, '03-beruf-hero-pending');
      await page.evaluate(() => window.scrollTo(0, 800));
      await page.waitForTimeout(400);
      await shoot(page, vp.name, '04-beruf-readiness-pending');
      await page.evaluate(() => window.scrollTo(0, 1600));
      await page.waitForTimeout(400);
      await shoot(page, vp.name, '05-beruf-personas-pending');

      // 3. Prüfungsreife
      await page.goto('/pruefungsreife-check', { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(600);
      await shoot(page, vp.name, '06-quiz-start-pending');

      // start the quiz — wait for stable testid instead of timeouts
      const startBtn = page.locator('[data-testid="quiz-start"]');
      if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await startBtn.click();
        await page.locator('[data-testid="quiz-running"]').waitFor({ state: 'visible', timeout: 5000 });
        await shoot(page, vp.name, '07-quiz-q1-pending');

        for (let i = 0; i < 12; i++) {
          if (await page.locator('[data-testid="quiz-result"]').isVisible().catch(() => false)) break;
          const ans = page.locator('[data-testid="quiz-answer"]').first();
          if (!(await ans.isVisible({ timeout: 2000 }).catch(() => false))) break;
          await ans.click();
        }
        await page.locator('[data-testid="quiz-result"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await shoot(page, vp.name, '08-quiz-result-pending');
      } else {
        findings.push({ viewport: vp.name, shot: '07/08-quiz', hScroll: false, bannerOverlap: false, ctaVisible: null, notes: ['quiz-start testid not found'] });
      }

      // 4. Prüfungsreife with Beruf context
      await page.goto('/pruefungsreife-check?source=beruf&slug=bankkaufmann', { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(600);
      await shoot(page, vp.name, '09-quiz-start-beruf-pending');

      // 5. Bundle
      await page.goto('/bundle/bankkaufmann', { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(600);
      await shoot(page, vp.name, '10-bundle-hero-pending');
      await page.evaluate(() => window.scrollTo(0, 1000));
      await page.waitForTimeout(300);
      await shoot(page, vp.name, '11-bundle-modules-pending');
      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.waitForTimeout(300);
      await shoot(page, vp.name, '12-bundle-comparison-pending');

      // 6. Admin growth — likely auth-gated, capture whatever renders
      await page.goto('/admin/growth', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(800);
      await shoot(page, vp.name, '13-admin-growth-pending');
    });

    test(`accepted — key routes (banner gone)`, async ({ page }) => {
      await dismissOrAcceptBanner(page, 'accepted');

      const routes: [string, string][] = [
        ['/', '01-home-hero-accepted'],
        ['/berufe/bankkaufmann', '03-beruf-hero-accepted'],
        ['/pruefungsreife-check', '06-quiz-start-accepted'],
        ['/pruefungsreife-check?source=beruf&slug=bankkaufmann', '09-quiz-start-beruf-accepted'],
        ['/bundle/bankkaufmann', '10-bundle-hero-accepted'],
      ];

      for (const [url, name] of routes) {
        await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(700);
        await shoot(page, vp.name, name);
      }
    });
  });
}

test.afterAll(async () => {
  const lines = ['# Mobile Funnel Screenshot Findings', '', '| Viewport | Shot | hScroll | BannerOverlap | StickyCTA | Notes |', '|---|---|---|---|---|---|'];
  for (const f of findings) {
    lines.push(
      `| ${f.viewport} | ${f.shot} | ${f.hScroll ? '⚠️' : '✅'} | ${f.bannerOverlap ? '⚠️' : '✅'} | ${f.ctaVisible === null ? '–' : f.ctaVisible ? '✅' : '∅'} | ${f.notes.join(', ') || '—'} |`,
    );
  }
  const out = path.join(OUT_ROOT, 'FINDINGS.md');
  fs.writeFileSync(out, lines.join('\n'));
  // eslint-disable-next-line no-console
  console.log('\n' + lines.join('\n') + `\n\nWritten: ${out}\n`);
});
