/**
 * P10 Mobile Funnel — 390x844 (iPhone 14): Homepage → /berufe → Produktseite
 * ohne CTA-Overlap, ohne horizontalen Scroll, mit erreichbarem Primary-CTA.
 * Weight: 10.
 *
 * Pre-customer-Pendant zu learner/11-mobile-discovery.spec.ts. Keine Login-Pfade.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect, navigateVisitorToCourse } from './_pre-helpers';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('P10 Mobile Funnel', () => {
  test('Mobile Visitor erreicht Kursseite mit sichtbarem CTA', async ({ page }) => {
    let problems = 0;

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    // Horizontaler Scroll = Layout-Bruch
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 4) {
      problems++;
      recordFinding({
        severity: 'P1', kind: 'workflow_no_feedback', journey: 'A', route: '/',
        detail: `Homepage hat horizontalen Overflow von ${overflow}px auf 390px Viewport.`,
        fix: 'Container-Padding/Hero-Asset prüfen — overflow-x verbieten.',
      });
    }

    // CTA above-the-fold (innerhalb der ersten 844px)
    const cta = page
      .getByRole('link', { name: /starten|jetzt|testen|loslegen|prüfung|beruf/i })
      .or(page.getByRole('button', { name: /starten|jetzt|testen|loslegen|prüfung|beruf/i }))
      .first();
    const box = await cta.boundingBox().catch(() => null);
    if (!box || box.y > 844) {
      problems++;
      recordFinding({
        severity: 'P1', kind: 'dead_cta', journey: 'A', route: '/',
        detail: 'Primary CTA mobile nicht above-the-fold (>844px).',
        fix: 'Hero verkürzen oder Sticky-CTA für Mobile.',
      });
    }

    // Funnel weiter: Beruf → Kurs
    const nav = await navigateVisitorToCourse(page);
    if (!nav.url) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'broken_route', journey: 'A',
        detail: 'Mobile-Discovery erreicht keine Kursseite ab Homepage.',
        fix: 'Berufe-Hub-Karten müssen auf 390px tappable sein (min 44px Höhe).',
      });
    } else {
      const overflow2 = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow2 > 4) {
        recordFinding({
          severity: 'P1', kind: 'workflow_no_feedback', journey: 'A', route: nav.url,
          detail: `Produktseite mobile Overflow ${overflow2}px.`,
          fix: 'Tabellen / Preis-Cards responsive prüfen.',
        });
      }
    }

    markJourney('P10_mobile_funnel', problems === 0 ? 'pass' : 'fail', `overflow=${overflow}`);
    expect(problems, 'Mobile Funnel muss ohne P0 bestehen').toBe(0);
  });
});
