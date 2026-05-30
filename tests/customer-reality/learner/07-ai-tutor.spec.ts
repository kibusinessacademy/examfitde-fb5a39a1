/**
 * Learner Journey 7 — AI Tutor. Weight: 10.
 */
import { test } from '@playwright/test';
import { dismissCookies, learnerLogin, markJourney, recordFinding, expect } from './_learner-helpers';

test.describe('J07 AI Tutor', () => {
  test('J07 Tutor returns a non-empty contextual response', async ({ page }) => {
    await learnerLogin(page);

    let resp = await page.goto('/tutor');
    if ((resp?.status() ?? 0) >= 400) {
      resp = await page.goto('/ai-tutor');
    }
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const status = resp?.status() ?? 0;
    if (status >= 400) {
      recordFinding({
        severity: 'P0',
        kind: 'broken_route',
        journey: 'E',
        route: '/tutor',
        detail: `Tutor-Route nicht erreichbar (status=${status}).`,
        fix: 'Route /tutor oder /ai-tutor wiederherstellen.',
      });
      markJourney('J07_ai_tutor', 'fail', 'route 4xx');
      throw new Error('Tutor route 4xx');
    }

    const input = page.locator('textarea, input[type="text"]').first();
    if (!(await input.isVisible().catch(() => false))) {
      recordFinding({
        severity: 'P1',
        kind: 'demo_unreachable',
        journey: 'E',
        route: page.url(),
        detail: 'Tutor-Input-Feld nicht sichtbar (eventuell Curriculum-Picker oder Paywall).',
        fix: 'Tutor-Gate prüfen (tutor_access_check / Curriculum-Auswahl).',
      });
      markJourney('J07_ai_tutor', 'fail', 'no input');
      return;
    }

    await input.fill('Erkläre mir kurz den wichtigsten Prüfungsbereich mit einem Beispiel.');
    const send = page.getByRole('button', { name: /senden|send|fragen|ask|abschicken/i }).first();
    if (await send.isVisible().catch(() => false)) {
      await send.click().catch(() => {});
    } else {
      await input.press('Enter').catch(() => {});
    }

    const respLocator = page.locator(
      '[data-role="assistant-message"], [data-testid="assistant-message"], .assistant-message, .chat-bubble:not(.user)',
    ).first();
    const visible = await respLocator.isVisible({ timeout: 60_000 }).catch(() => false);
    if (!visible) {
      recordFinding({
        severity: 'P0',
        kind: 'workflow_no_feedback',
        journey: 'E',
        route: page.url(),
        detail: 'Tutor antwortet nicht innerhalb 60s.',
        fix: 'ai_tutor edge function + Strict-RAG-Pipeline prüfen.',
      });
      markJourney('J07_ai_tutor', 'fail', 'no answer');
      throw new Error('Tutor no answer');
    }
    const text = (await respLocator.textContent().catch(() => '')) || '';
    if (text.trim().length < 30) {
      recordFinding({
        severity: 'P1',
        kind: 'placeholder_end_state',
        journey: 'E',
        route: page.url(),
        detail: `Tutor-Antwort zu kurz (${text.length} chars).`,
        fix: 'Strict-RAG-Quellenblock + Mindestlänge prüfen.',
      });
      markJourney('J07_ai_tutor', 'pass', 'short answer');
    } else {
      markJourney('J07_ai_tutor', 'pass', `len=${text.length}`);
    }
    expect(visible).toBe(true);
  });
});
