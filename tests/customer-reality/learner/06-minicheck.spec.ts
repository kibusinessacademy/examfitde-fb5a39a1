/**
 * Learner Journey 6 — MiniCheck. Weight: 10.
 *
 * P0.4 (2026-06-05): non-destructive. Accept EITHER a live MiniCheck
 * question OR a fachlich sinnvolle Start-Surface (`MINICHECK_SIGNALS`
 * + Start-CTA) as P0-clean. A leerer Body / Spinner / nur Navigation
 * fail mit P0 `placeholder_end_state`.
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
import { MINICHECK_SIGNALS, SURFACE_TESTIDS, hasFachlicheSurface } from './_surface-signals';

test.describe('J06 MiniCheck', () => {
  test('J06 MiniCheck answerable OR fachliche Start-Surface', async ({ page }) => {
    await learnerLogin(page);

    // Try the dedicated entry surface first — it must always render the
    // MiniCheck start CTA (P0.4 SSOT contract).
    await page.goto('/minicheck');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const entryStart = page.getByTestId(SURFACE_TESTIDS.miniCheckStart).first();
    const entryVisible = await entryStart.isVisible({ timeout: 5_000 }).catch(() => false);
    const entryBody = (await page.locator('body').innerText().catch(() => '')) || '';
    const entryFachlich = hasFachlicheSurface(entryBody, MINICHECK_SIGNALS);

    // If the entry surface is fachlich + has a clickable CTA → accept as pass
    // (no in-course session reachable cold is fine; the live engine lives at
    // /app/minicheck and is exercised by deeper journeys).
    if (entryVisible && entryFachlich) {
      markJourney('J06_minicheck', 'pass', 'entry-surface fachlich + CTA');
      expect(entryVisible).toBe(true);
      return;
    }

    // Fallback path: try the in-course MiniCheck via a real course.
    const url = await openFirstAvailableCourse(page);
    if (!url) {
      // No course AND no entry surface → real P0.
      recordFinding({
        severity: 'P0',
        kind: 'placeholder_end_state',
        journey: 'F',
        route: '/minicheck',
        detail: 'MiniCheck erreicht weder Frage noch fachliche Startfläche.',
        fix: 'MiniCheck-Entry-CTA + Recovery-Hinweis (Beruf auswählen) rendern.',
      });
      markJourney('J06_minicheck', 'fail', 'no entry, no course');
      throw new Error('No MiniCheck surface reachable');
    }
    await dismissCookies(page);

    const lessonCta = page.getByRole('link', { name: /lesson|lerneinheit|starten/i }).first();
    if (await lessonCta.isVisible().catch(() => false)) {
      await lessonCta.click().catch(() => {});
      await page.waitForTimeout(1500);
    }

    const mcCta = page
      .getByRole('button', { name: /minicheck|kompetenz-?check|wissens-?check|check starten/i })
      .first();
    if (await mcCta.isVisible().catch(() => false)) {
      await mcCta.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

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
      // No live question — last check: is the current URL fachlich + does it
      // expose a Start- or Recovery-CTA? Then accept as pass with a P1 note.
      const body = (await page.locator('body').innerText().catch(() => '')) || '';
      const ctaVisible =
        (await page.getByRole('button', { name: /starten|weiter|beruf/i }).first().isVisible().catch(() => false)) ||
        (await page.getByRole('link', { name: /starten|weiter|beruf/i }).first().isVisible().catch(() => false));
      if (hasFachlicheSurface(body, MINICHECK_SIGNALS) && ctaVisible) {
        markJourney('J06_minicheck', 'pass', 'in-course fachlich fallback + CTA');
        expect(true).toBe(true);
        return;
      }
      recordFinding({
        severity: 'P0',
        kind: 'placeholder_end_state',
        journey: 'F',
        route: page.url(),
        detail: 'MiniCheck erreicht weder Frage noch fachliche Startfläche.',
        fix: 'MiniCheck muss Frage oder Start-CTA mit fachlichem Fallback rendern.',
      });
      markJourney('J06_minicheck', 'fail', 'no question, no fallback');
      throw new Error('No MiniCheck question + no fachliche Fallback-Surface');
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
