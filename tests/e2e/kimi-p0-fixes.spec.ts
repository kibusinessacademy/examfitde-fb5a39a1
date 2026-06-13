/**
 * KIMI.1.5 P0-Fix Regression Tests
 * ---------------------------------
 * Lockt die drei P0-Blocker fest, die der KIMI-Reality-Auditor
 * im authentifizierten Learner-Run gefunden hat:
 *
 *   1. /app/exam-simulation != 404   (Alias → /exam-simulation)
 *   2. /app/tutor Empty-State enthält klickbare CTA
 *   3. /app/minicheck "Impuls starten" führt zu echtem Folgezustand
 *
 * Auth ist optional. Ohne Credentials laufen die Smoke-Checks
 * weiter, weil /app/* ohne Auth auf /auth redirected — dann
 * prüfen wir nur, dass die Route nicht hard-404 ist.
 */
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const hasCreds = !!(process.env.E2E_TEST_USER_EMAIL && process.env.E2E_TEST_USER_PASSWORD);

test.describe('KIMI.1.5 P0 Fixes', () => {
  test('P0-1 /app/exam-simulation rendert keine 404', async ({ page }) => {
    const resp = await page.goto('/app/exam-simulation');
    expect(resp?.status() ?? 0).toBeLessThan(400);
    // Alias muss auf /exam-simulation oder /auth (wenn nicht eingeloggt) führen,
    // niemals auf einer 404-Surface stehen bleiben.
    await page.waitForLoadState('domcontentloaded');
    const url = page.url();
    expect(url).not.toMatch(/\/app\/exam-simulation\/?$/);
    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    expect(body).not.toMatch(/404|nicht gefunden|page not found/i);
  });

  test('P0-2 /app/tutor Empty-State hat klickbare CTA', async ({ page }) => {
    test.skip(!hasCreds, 'E2E_TEST_USER_* not set');
    await loginAs(page, 'qa_allaccess');
    await page.goto('/app/tutor');
    await page.waitForLoadState('domcontentloaded');

    // Entweder voll geladener Tutor oder Onboarding — in beiden Fällen
    // muss eine fachliche Folgeaktion sichtbar sein.
    const onboarding = page.getByTestId('tutor-onboarding-primary');
    const focusCta = page.getByRole('link', { name: /tutor starten|prüfung simulieren|lernpfad/i }).first();

    const onboardingVisible = await onboarding.isVisible().catch(() => false);
    const focusVisible = await focusCta.isVisible().catch(() => false);
    expect(onboardingVisible || focusVisible).toBe(true);

    if (onboardingVisible) {
      await onboarding.click();
      await page.waitForURL(/\/berufe/, { timeout: 8_000 });
    }
  });

  test('P0-3 /app/minicheck "Impuls starten" führt zu Folgezustand', async ({ page }) => {
    test.skip(!hasCreds, 'E2E_TEST_USER_* not set');
    await loginAs(page, 'qa_allaccess');
    await page.goto('/app/minicheck');
    await page.waitForLoadState('domcontentloaded');

    const start = page.getByTestId('minicheck-start');
    await expect(start).toBeVisible({ timeout: 8_000 });
    await start.click();

    // Folgezustand: Question-Stage erscheint (kein toter Klick).
    await expect(page.getByTestId('minicheck-question-stage')).toBeVisible({ timeout: 8_000 });
  });
});
