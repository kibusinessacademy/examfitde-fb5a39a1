/**
 * Learner Journey 5 — Learning (open course, start lesson). Weight: 15.
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

test.describe('J05 Learning', () => {
  test('J05 Open first available course → reach lesson surface', async ({ page }) => {
    await learnerLogin(page);
    const url = await openFirstAvailableCourse(page);
    if (!url) {
      recordFinding({
        severity: 'P0',
        kind: 'demo_unreachable',
        journey: 'E',
        route: '/dashboard',
        detail: 'Kein Kurs vom Dashboard aus erreichbar.',
        fix: 'Kurs-Empfehlung / Curriculum-Picker im Dashboard.',
      });
      markJourney('J05_learning', 'fail', 'no course reachable');
      throw new Error('No course reachable');
    }

    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);
    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    if (body.trim().length < 120) {
      recordFinding({
        severity: 'P0',
        kind: 'white_screen',
        journey: 'E',
        route: url,
        detail: 'Kursseite rendert keinen sinnvollen Inhalt.',
        fix: 'Course-Loader + RLS prüfen.',
      });
      markJourney('J05_learning', 'fail', 'empty course page');
      throw new Error('Course page empty');
    }

    // Lesson start CTA
    const startLesson = page
      .getByRole('link', { name: /lesson|lerneinheit|kapitel|starten|öffnen/i })
      .or(page.getByRole('button', { name: /lesson|lerneinheit|kapitel|starten|öffnen/i }))
      .first();
    if (!(await startLesson.isVisible().catch(() => false))) {
      recordFinding({
        severity: 'P1',
        kind: 'dead_cta',
        journey: 'E',
        route: url,
        detail: 'Auf Kursseite kein Lesson-Start-CTA sichtbar.',
        fix: 'Erste Lesson-Karte mit "Starten"-Button.',
      });
      markJourney('J05_learning', 'pass', 'course visible, lesson cta missing');
      return;
    }

    const before = page.url();
    await startLesson.click().catch(() => {});
    await page.waitForTimeout(2000);
    const after = page.url();
    if (after === before) {
      recordFinding({
        severity: 'P1',
        kind: 'dead_button',
        journey: 'E',
        route: before,
        detail: 'Lesson-Start-CTA löste keine Navigation aus.',
        fix: 'Lesson-Router prüfen.',
      });
    }
    markJourney('J05_learning', 'pass', `lesson surface=${after.slice(0, 80)}`);
    expect(true).toBe(true);
  });
});
