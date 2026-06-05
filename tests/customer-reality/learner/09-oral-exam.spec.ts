/**
 * Learner Journey 9 — Oral Exam Simulation. Weight: 10.
 *
 * P0.4 (2026-06-05): Oral surface must always render a sichtbare
 * Startfläche mit CTA — sei es Curriculum-Picker, Start-Button oder
 * Beruf-Recovery-CTA. White-Screen / leerer Body / nur Spinner
 * failt mit P0 `white_screen`. Eine fachliche Startfläche ohne
 * Voice-Input ist akzeptabel (pass, P1 Note).
 */
import { test } from '@playwright/test';
import { dismissCookies, learnerLogin, markJourney, recordFinding, expect } from './_learner-helpers';
import { ORAL_SIGNALS, SURFACE_TESTIDS, hasFachlicheSurface } from './_surface-signals';

const ENTRYPOINTS = ['/oral-exam', '/muendliche-pruefung', '/oral', '/muendlich'];

test.describe('J09 Oral Exam', () => {
  test('J09 Oral surface starts OR exposes Recovery-CTA', async ({ page }) => {
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
        journey: 'F',
        route: page.url(),
        detail: 'Oral-Exam-Oberfläche leer oder ohne Startaktion.',
        fix: 'Oral Exam muss Startfläche, CTA oder Prüfungsfrage rendern.',
      });
      markJourney('J09_oral_exam', 'fail', 'empty');
      throw new Error('Empty oral page');
    }

    // P0: body must contain fachliche Oral-Signale (mindestens 2).
    if (!hasFachlicheSurface(body, ORAL_SIGNALS)) {
      recordFinding({
        severity: 'P0',
        kind: 'placeholder_end_state',
        journey: 'F',
        route: page.url(),
        detail: 'Oral-Body enthält keine fachlichen Signale (Mündlich/Simulation/Fachlichkeit/Struktur).',
        fix: 'Headline + Bewertungsdimensionen + Start- oder Recovery-CTA sichtbar lassen.',
      });
      markJourney('J09_oral_exam', 'fail', 'no fachliche signals');
      throw new Error('Oral surface not fachlich');
    }

    // Klickbare Startaktion verlangen — Start-CTA, Recovery-CTA oder Standard-Button.
    const startCta = page
      .getByTestId(SURFACE_TESTIDS.oralStart)
      .or(page.getByTestId(SURFACE_TESTIDS.oralRecovery))
      .or(page.getByRole('button', { name: /starten|frage|beginnen|simulation/i }))
      .or(page.getByRole('link', { name: /beruf auswählen|prüfungstraining|simulation/i }))
      .first();
    const startVisible = await startCta.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!startVisible) {
      recordFinding({
        severity: 'P0',
        kind: 'placeholder_end_state',
        journey: 'F',
        route: page.url(),
        detail: 'Oral-Surface rendert ohne sichtbaren Start- oder Recovery-CTA.',
        fix: 'oral-start-cta / oral-recovery-cta im Setup-Card behalten.',
      });
      markJourney('J09_oral_exam', 'fail', 'no start cta');
      throw new Error('No oral start CTA');
    }

    // Optional: versuche die Simulation zu starten (nicht-blockierend).
    await startCta.click().catch(() => {});
    await page.waitForTimeout(2500);

    const input = page.locator('textarea, input[type="text"]').first();
    if (!(await input.isVisible().catch(() => false))) {
      // Surface ist erreichbar + Start-CTA sichtbar, nur kein Voice/Text-Input.
      // Das ist akzeptabel (P1) — die Recovery-CTA führt fachlich weiter.
      recordFinding({
        severity: 'P1',
        kind: 'workflow_no_feedback',
        journey: 'E',
        route: page.url(),
        detail: 'Kein Antworteingabefeld in der mündlichen Simulation — Startfläche fachlich erreichbar.',
        fix: 'Eingabe-Surface oder Voice-Surface prüfen.',
      });
      markJourney('J09_oral_exam', 'pass', 'surface reached, no input');
      return;
    }

    markJourney('J09_oral_exam', 'pass');
    expect(true).toBe(true);
  });
});
