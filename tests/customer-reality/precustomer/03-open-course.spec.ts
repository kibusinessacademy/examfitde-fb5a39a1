/**
 * P03 Kursseite öffnen + TIME_TO_COURSE Messung.
 * Weight: 15.
 * KPI: Homepage → erste Kursseite < 60s (Soft-Target).
 */
import { test } from '@playwright/test';
import { markJourney, recordFinding, expect, navigateVisitorToCourse, writeMetric } from './_pre-helpers';

test.describe('P03 Kursseite erreichen', () => {
  test('Visitor erreicht Kurs-/Produktseite ab Homepage', async ({ page }) => {
    let problems = 0;
    const { url, ms } = await navigateVisitorToCourse(page);

    writeMetric('time_to_course_ms', ms);
    writeMetric('time_to_course_url', url || 'NONE');

    if (!url) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'broken_route', journey: 'A',
        detail: 'Visitor erreicht keine Kurs-/Produktseite ab Homepage.',
        fix: 'Berufe-Hub muss klickbare Karten mit echten Detail-Routen liefern.',
      });
    } else {
      // Verifizieren, dass Detail-Seite Content hat
      const text = (await page.locator('body').innerText().catch(() => '')) || '';
      if (text.trim().length < 200) {
        problems++;
        recordFinding({
          severity: 'P0', kind: 'white_screen', journey: 'A', route: url,
          detail: 'Kurs-/Produktseite ist faktisch leer (<200 chars).',
          fix: 'Content-Fallback / SSR-Hydration für Produkt-Detail prüfen.',
        });
      }

      // Soft-KPI < 60s
      if (ms > 60_000) {
        recordFinding({
          severity: 'P1', kind: 'workflow_no_feedback', journey: 'A', route: url,
          detail: `TIME_TO_COURSE=${(ms / 1000).toFixed(1)}s > 60s Ziel.`,
          fix: 'Discovery-Pfad verkürzen — Berufe-Hub priorisieren, Click-Tiefe reduzieren.',
        });
      }
    }

    markJourney('P03_open_course', problems === 0 ? 'pass' : 'fail', `ttc=${ms}ms url=${url ?? 'NONE'}`);
    expect(problems, 'Kursseite muss erreichbar sein').toBe(0);
  });
});
