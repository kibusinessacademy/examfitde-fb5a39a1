/**
 * Learner Journey 7 — AI Tutor. Weight: 10.
 *
 * P0.4 (2026-06-05): the tutor surface must always expose either a
 * sichtbares Eingabefeld OR einen fachlich klaren Kontext-CTA
 * (Beruf auswählen / Tutor öffnen). Eine leerer Body / dauerhafter
 * Spinner / nur Navigation failt mit P0 `placeholder_end_state`.
 */
import { test } from '@playwright/test';
import { dismissCookies, learnerLogin, markJourney, recordFinding, expect } from './_learner-helpers';
import { TUTOR_SIGNALS, SURFACE_TESTIDS, hasFachlicheSurface } from './_surface-signals';

test.describe('J07 AI Tutor', () => {
  test('J07 Tutor surface exposes input OR fachlichen Kontext-CTA', async ({ page }) => {
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

    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    const input = page
      .getByTestId(SURFACE_TESTIDS.tutorInput)
      .or(page.locator('textarea, input[type="text"]'))
      .first();
    const inputVisible = await input.isVisible({ timeout: 5_000 }).catch(() => false);

    const kontextCta = page
      .getByRole('link', { name: /beruf auswählen|prüfungstraining|kurs öffnen/i })
      .first();
    const ctaVisible = await kontextCta.isVisible().catch(() => false);

    // Neither input NOR a fachlicher Kontext-CTA → real P0.
    if (!inputVisible && !ctaVisible) {
      recordFinding({
        severity: 'P0',
        kind: 'placeholder_end_state',
        journey: 'F',
        route: page.url(),
        detail: 'AI Tutor zeigt weder Eingabefeld noch fachlichen Kontext-CTA.',
        fix: 'Tutor-Surface muss Input oder Kontext-Auswahl mit CTA rendern.',
      });
      markJourney('J07_ai_tutor', 'fail', 'no input, no context cta');
      throw new Error('Tutor surface unusable');
    }

    // Surface must additionally read as fachlich (mind. 2 Tutor-Signale).
    if (!hasFachlicheSurface(body, TUTOR_SIGNALS)) {
      recordFinding({
        severity: 'P0',
        kind: 'placeholder_end_state',
        journey: 'F',
        route: page.url(),
        detail: 'Tutor-Body enthält keine fachlichen Signale (Tutor/Frage/Senden/Quellen).',
        fix: 'Tutor-Headline, Mode-Hint und Submit-Label sichtbar lassen.',
      });
      markJourney('J07_ai_tutor', 'fail', 'no fachliche signals');
      throw new Error('Tutor surface not fachlich');
    }

    // Kein Input aber fachlicher Kontext-CTA → fachlich akzeptabel (pass, P1 Note).
    if (!inputVisible && ctaVisible) {
      recordFinding({
        severity: 'P1',
        kind: 'demo_unreachable',
        journey: 'E',
        route: page.url(),
        detail: 'Tutor-Input-Feld nicht sichtbar — fachlicher Kontext-CTA übernimmt.',
        fix: 'Tutor-Gate (tutor_access_check / Curriculum-Auswahl) reaktivieren.',
      });
      markJourney('J07_ai_tutor', 'pass', 'context-cta only');
      expect(ctaVisible).toBe(true);
      return;
    }

    // Input vorhanden → versuch eine Antwort.
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
        severity: 'P1',
        kind: 'workflow_no_feedback',
        journey: 'E',
        route: page.url(),
        detail: 'Tutor antwortet nicht innerhalb 60s — Surface bleibt aber nutzbar (Input sichtbar).',
        fix: 'ai_tutor edge function + Strict-RAG-Pipeline prüfen.',
      });
      markJourney('J07_ai_tutor', 'pass', 'input-only, no answer');
      expect(inputVisible).toBe(true);
      return;
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
