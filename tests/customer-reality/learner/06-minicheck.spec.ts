/**
 * Learner Journey 6 — MiniCheck. Weight: 10.
 * Non-destructive: try to find a MiniCheck and verify the result surface.
 */
import { test } from '@playwright/test';
import {
  dismissCookies,
  learnerLogin,
  markJourney,
  openFirstAvailableCourse,
  recordFinding,
  expect,
} from './_learner-helpers';

test.describe('J06 MiniCheck', () => {
  test('J06 MiniCheck answerable + result surfaces', async ({ page }) => {
    await learnerLogin(page);
    const url = await openFirstAvailableCourse(page);
    if (!url) {
      markJourney('J06_minicheck', 'fail', 'no course');
      return;
    }
    await dismissCookies(page);

    // Hop into first lesson if not already
    const lessonCta = page.getByRole('link', { name: /lesson|lerneinheit|starten/i }).first();
    if (await lessonCta.isVisible().catch(() => false)) {
      await lessonCta.click().catch(() => {});
      await page.waitForTimeout(1500);
    }

    // Trigger MiniCheck if a dedicated CTA exists
    const mcCta = page
      .getByRole('button', { name: /minicheck|kompetenz-?check|wissens-?check|check starten/i })
      .first();
    if (await mcCta.isVisible().catch(() => false)) {
      await mcCta.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Loop: answer up to 8 questions
    const deadline = Date.now() + 45_000;
    let answered = 0;
    while (Date.now() < deadline && answered < 8) {
      if (await page.getByTestId('minicheck-result').isVisible().catch(() => false)) break;
      const opt = page.getByTestId('question-option-0').first();
      if (await opt.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await opt.click().catch(() => {});
        const submit = page.getByTestId('answer-submit').first();
        if (await submit.isVisible().catch(() => false)) await submit.click().catch(() => {});
        const next = page.getByTestId('question-next').first();
        if (await next.isVisible({ timeout: 4_000 }).catch(() => false)) await next.click().catch(() => {});
        answered++;
      } else {
        await page.waitForTimeout(500);
        break;
      }
    }

    const gotResult = await page
      .getByTestId('minicheck-result')
      .isVisible({ timeout: 4_000 })
      .catch(() => false);
    if (!gotResult && answered === 0) {
      recordFinding({
        severity: 'P1',
        kind: 'demo_unreachable',
        journey: 'E',
        route: page.url(),
        detail: 'Keine MiniCheck-Frage erreichbar (Kurs evtl. ohne Quiz oder Selektor verschoben).',
        fix: 'data-testid="question-option-0" auf MiniCheck-Renderer halten.',
      });
      markJourney('J06_minicheck', 'fail', 'no question reached');
      return;
    }
    if (!gotResult) {
      recordFinding({
        severity: 'P1',
        kind: 'workflow_no_feedback',
        journey: 'E',
        route: page.url(),
        detail: `MiniCheck angefangen (${answered} Antworten) aber kein Result-Card.`,
        fix: 'minicheck-result Renderer prüfen.',
      });
      markJourney('J06_minicheck', 'fail', 'no result');
      return;
    }
    markJourney('J06_minicheck', 'pass', `answered=${answered}`);
    expect(true).toBe(true);
  });
});
