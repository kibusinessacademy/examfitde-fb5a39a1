/**
 * P01 Homepage — renders, primary CTA visible, no white screen, console clean enough.
 * Weight: 10.
 */
import { test } from '@playwright/test';
import { attachConsoleSink, isWhiteScreen } from '../_helpers';
import { dismissCookies, markJourney, recordFinding, expect } from './_pre-helpers';

test.describe('P01 Homepage', () => {
  test('Homepage rendert mit Primary CTA + ohne White-Screen', async ({ page }) => {
    const sink = attachConsoleSink(page);
    let problems = 0;

    const resp = await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const status = resp?.status() ?? 0;
    if (status >= 400) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'broken_route', journey: 'A', route: '/',
        detail: `Homepage HTTP ${status}.`, fix: 'Root-Route reparieren.',
      });
    }

    if (await isWhiteScreen(page)) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'white_screen', journey: 'A', route: '/',
        detail: 'Homepage erscheint als White-Screen (kein Body-Text).',
        fix: 'Initial-Render / SSR-Fallback prüfen.',
      });
    }

    const cta = page
      .getByRole('link', { name: /starten|jetzt|testen|loslegen|prüfung|beruf/i })
      .or(page.getByRole('button', { name: /starten|jetzt|testen|loslegen|prüfung|beruf/i }))
      .first();
    if (!(await cta.isVisible().catch(() => false))) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'dead_cta', journey: 'A', route: '/',
        detail: 'Kein primärer CTA above the fold.',
        fix: 'Hero-CTA sichtbar machen, Cookie-Banner darf CTA nicht verdecken.',
      });
    }

    if (sink.errors.length > 3) {
      recordFinding({
        severity: 'P1', kind: 'console_error', journey: 'A', route: '/',
        detail: `Homepage produziert ${sink.errors.length} Console-Errors.`,
        fix: 'Top-Error stack triagieren.',
      });
    }

    markJourney('P01_homepage', problems === 0 ? 'pass' : 'fail', `problems=${problems}`);
    expect(problems, 'Homepage muss ohne P0 bestehen').toBe(0);
  });
});
