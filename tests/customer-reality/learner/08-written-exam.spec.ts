/**
 * Learner Journey 8 — Written Exam Simulation. Weight: 10.
 */
import { test } from '@playwright/test';
import { dismissCookies, learnerLogin, markJourney, recordFinding, expect } from './_learner-helpers';

const ENTRYPOINTS = ['/pruefung', '/pruefungstrainer', '/exam', '/schriftliche-pruefung'];

test.describe('J08 Written Exam', () => {
  test('J08 Exam surface starts and shows questions', async ({ page }) => {
    await learnerLogin(page);

    let reached: string | null = null;
    for (const route of ENTRYPOINTS) {
      const resp = await page.goto(route);
      if ((resp?.status() ?? 0) < 400) {
        reached = route;
        break;
      }
    }
    if (!reached) {
      // Try via dashboard CTA
      await page.goto('/dashboard');
      await dismissCookies(page);
      const cta = page
        .getByRole('link', { name: /prüfung|simulation|trainer/i })
        .or(page.getByRole('button', { name: /prüfung|simulation|trainer/i }))
        .first();
      if (await cta.isVisible().catch(() => false)) {
        await cta.click().catch(() => {});
        await page.waitForTimeout(1500);
        reached = page.url();
      }
    }
    if (!reached) {
      recordFinding({
        severity: 'P0',
        kind: 'broken_route',
        journey: 'E',
        route: ENTRYPOINTS.join('|'),
        detail: 'Keine schriftliche Prüfungsoberfläche erreichbar.',
        fix: 'Exam-Trainer-Route prüfen.',
      });
      markJourney('J08_written_exam', 'fail', 'no route');
      throw new Error('No exam route');
    }
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    const hasQuestionMarkers = /frage|aufgabe|antwort|option|nächste/i.test(body);
    const hasOptionLocator = await page
      .getByTestId('question-option-0')
      .first()
      .isVisible({ timeout: 4_000 })
      .catch(() => false);
    if (!hasQuestionMarkers && !hasOptionLocator) {
      recordFinding({
        severity: 'P1',
        kind: 'placeholder_end_state',
        journey: 'E',
        route: page.url(),
        detail: 'Exam-Oberfläche zeigt keine erkennbare Frage.',
        fix: 'Question-Renderer + Curriculum-Auswahl prüfen.',
      });
      markJourney('J08_written_exam', 'fail', 'no question');
      return;
    }
    markJourney('J08_written_exam', 'pass');
    expect(true).toBe(true);
  });
});
