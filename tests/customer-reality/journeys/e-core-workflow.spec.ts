/**
 * Journey E — Kern-Workflow.
 * Mindestens ein sinnvoller CTA pro Hauptsektion + er erzeugt sichtbares Feedback
 * (Navigation, Toast, Dialog, neues DOM).
 */
import { test, expect } from '@playwright/test';
import { loginOrSkip, recordFinding } from '../_helpers';

const SECTIONS = ['/dashboard', '/berufe'];

test.describe('Journey E — Kern-Workflow', () => {
  test('E1 Erster CTA pro Sektion erzeugt sichtbares Feedback', async ({ page }) => {
    await loginOrSkip(page, 'pm');

    for (const route of SECTIONS) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');

      const btn = page
        .getByRole('button', { name: /starten|weiter|jetzt|öffnen|prüfen|trainer/i })
        .or(page.getByRole('link', { name: /starten|weiter|jetzt|öffnen|prüfen|trainer/i }))
        .first();

      if (!(await btn.isVisible().catch(() => false))) {
        recordFinding({
          severity: 'P1',
          kind: 'workflow_no_feedback',
          journey: 'E',
          route,
          detail: 'Kein sinnvoller Workflow-CTA auf Hauptsektion.',
          fix: 'Mindestens einen klar benannten Next-Step-Button bereitstellen.',
        });
        continue;
      }

      const beforeUrl = page.url();
      const beforeDom = (await page.locator('body').innerText()).length;

      await btn.click().catch(() => {});
      await page.waitForTimeout(1500);

      const afterUrl = page.url();
      const afterDom = (await page.locator('body').innerText()).length;
      const toast = await page
        .locator('[role="status"], [data-sonner-toast], [role="dialog"]')
        .first()
        .isVisible()
        .catch(() => false);

      const feedback =
        afterUrl !== beforeUrl ||
        toast ||
        Math.abs(afterDom - beforeDom) > 50;

      if (!feedback) {
        recordFinding({
          severity: 'P0',
          kind: 'dead_button',
          journey: 'E',
          route,
          detail: 'Workflow-CTA hat weder Navigation noch Toast/Dialog noch DOM-Änderung ausgelöst.',
          fix: 'Handler verkabeln oder Button entfernen.',
        });
      }
      expect(feedback, `CTA auf ${route} muss Wirkung haben`).toBe(true);
    }
  });
});
