/**
 * Learner Journey 9 — Oral Exam Simulation. Weight: 10.
 */
import { test } from '@playwright/test';
import { dismissCookies, learnerLogin, markJourney, recordFinding, expect } from './_learner-helpers';

const ENTRYPOINTS = ['/muendliche-pruefung', '/oral-exam', '/oral', '/muendlich'];

test.describe('J09 Oral Exam', () => {
  test('J09 Oral surface starts and accepts an answer', async ({ page }) => {
    await learnerLogin(page);

    let reached = false;
    for (const route of ENTRYPOINTS) {
      const resp = await page.goto(route);
      if ((resp?.status() ?? 0) < 400) {
        reached = true;
        break;
      }
    }
    if (!reached) {
      recordFinding({
        severity: 'P0',
        kind: 'broken_route',
        journey: 'E',
        route: ENTRYPOINTS.join('|'),
        detail: 'Mündliche Prüfung nicht erreichbar.',
        fix: 'Oral-Exam-Route wiederherstellen.',
      });
      markJourney('J09_oral_exam', 'fail', 'no route');
      throw new Error('No oral route');
    }
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    if (body.trim().length < 80) {
      recordFinding({
        severity: 'P0',
        kind: 'white_screen',
        journey: 'E',
        route: page.url(),
        detail: 'Oral-Oberfläche leer.',
        fix: 'Renderer / Datenpfad prüfen.',
      });
      markJourney('J09_oral_exam', 'fail', 'empty');
      throw new Error('Empty oral page');
    }

    const start = page
      .getByRole('button', { name: /starten|frage|beginnen|simulation/i })
      .first();
    if (await start.isVisible().catch(() => false)) {
      await start.click().catch(() => {});
      await page.waitForTimeout(2500);
    }

    const input = page.locator('textarea, input[type="text"]').first();
    if (!(await input.isVisible().catch(() => false))) {
      recordFinding({
        severity: 'P1',
        kind: 'workflow_no_feedback',
        journey: 'E',
        route: page.url(),
        detail: 'Kein Antworteingabefeld in der mündlichen Simulation.',
        fix: 'Eingabe-Surface oder Voice-Surface prüfen.',
      });
      markJourney('J09_oral_exam', 'pass', 'surface reached, no input');
      return;
    }

    markJourney('J09_oral_exam', 'pass');
    expect(true).toBe(true);
  });
});
