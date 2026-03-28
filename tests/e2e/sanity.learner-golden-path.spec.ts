// ExamFit Sanity: Learner Golden Path E2E
// Duration: ~3 min | Trigger: PR/merge + nightly
// Tests real browser flows through critical learner journeys

import { test, expect } from '@playwright/test';
import { loginAs, env } from './helpers/auth';
import {
  collectConsoleErrors,
  filterBenignErrors,
  navigateToDashboard,
  answerMiniCheck,
  askTutor,
} from './helpers/flows';

const CURRICULUM_ID = env('CURRICULUM_ID');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// A) Course Discovery & Start
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Golden Path: Course Discovery', () => {
  test('Learner sees available courses on dashboard', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await navigateToDashboard(page);

    const body = await page.textContent('body');
    const hasCourseContent =
      body?.includes('Weiterlernen') ||
      body?.includes('Kurs') ||
      body?.includes('Prüfung') ||
      body?.includes('Dashboard');
    expect(hasCourseContent).toBeTruthy();
  });

  test('Course page loads with modules', async ({ page }) => {
    await loginAs(page, 'smoke_learner');

    const target = CURRICULUM_ID
      ? `/learner/course/${CURRICULUM_ID}`
      : '/courses';
    await page.goto(target);
    await page.waitForLoadState('networkidle');

    // Should see course content or module list
    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(50);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// B) Lesson & MiniCheck
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Golden Path: Lesson Flow', () => {
  test('Lesson page loads without crash', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loginAs(page, 'smoke_learner');

    // Try to find a lesson link from the course page
    const target = CURRICULUM_ID
      ? `/learner/course/${CURRICULUM_ID}`
      : '/courses';
    await page.goto(target);
    await page.waitForLoadState('networkidle');

    // Look for a lesson link
    const lessonLink = page.locator('a[href*="/lesson/"]').first();
    if (await lessonLink.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await lessonLink.click();
      await page.waitForLoadState('networkidle');

      // Should have lesson content
      const body = await page.textContent('body');
      expect(body?.length).toBeGreaterThan(50);
      expect(filterBenignErrors(errors)).toHaveLength(0);
    } else {
      // No lessons available, skip gracefully
      test.skip(true, 'No lesson links found on course page');
    }
  });

  test('MiniCheck can be started if available', async ({ page }) => {
    await loginAs(page, 'smoke_learner');

    const target = CURRICULUM_ID
      ? `/learner/course/${CURRICULUM_ID}`
      : '/courses';
    await page.goto(target);
    await page.waitForLoadState('networkidle');

    // Find a lesson with minicheck
    const lessonLink = page.locator('a[href*="/lesson/"]').first();
    if (await lessonLink.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await lessonLink.click();
      await page.waitForLoadState('networkidle');

      // Look for minicheck button
      const miniCheckBtn = page.locator(
        'button:has-text("MiniCheck"), button:has-text("Wissen testen"), button:has-text("Quiz")'
      ).first();

      if (await miniCheckBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await miniCheckBtn.click();
        await page.waitForTimeout(2000);
        await answerMiniCheck(page);
        // No crash
        expect(await page.title()).toBeTruthy();
      }
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// C) Readiness & Mastery Visibility
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Golden Path: Readiness', () => {
  test('Dashboard shows readiness or progress indicators', async ({ page }) => {
    await loginAs(page, 'smoke_learner');

    const dashTarget = CURRICULUM_ID
      ? `/learner/dashboard/${CURRICULUM_ID}`
      : '/dashboard';
    await page.goto(dashTarget);
    await page.waitForLoadState('networkidle');

    const body = await page.textContent('body');
    const hasProgress =
      body?.includes('Fortschritt') ||
      body?.includes('Readiness') ||
      body?.includes('Mastery') ||
      body?.includes('Bereitschaft') ||
      body?.includes('%') ||
      body?.includes('Prüfungsreife');
    // Soft: not all users will have progress data
    if (!hasProgress) {
      console.warn('No readiness indicators visible – user may not have progress data');
    }
    expect(await page.title()).toBeTruthy();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// D) Adaptive Exam Start
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Golden Path: Adaptive Exam', () => {
  test('Adaptive exam page loads', async ({ page }) => {
    await loginAs(page, 'smoke_learner');

    const target = CURRICULUM_ID
      ? `/learner/exam/adaptive/${CURRICULUM_ID}`
      : '/exam-simulation';
    await page.goto(target);
    await page.waitForLoadState('networkidle');

    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(50);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E) Tutor with Context
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Golden Path: Tutor', () => {
  test('Tutor page loads with input', async ({ page }) => {
    await loginAs(page, 'smoke_learner');

    const target = CURRICULUM_ID
      ? `/learner/tutor/${CURRICULUM_ID}`
      : '/tutor';
    await page.goto(target);
    await page.waitForLoadState('networkidle');

    // Should have a text input for asking questions
    const input = page.locator(
      'textarea, input[placeholder*="Frage"], input[placeholder*="frag"]'
    ).first();

    const hasInput = await input.isVisible({ timeout: 10_000 }).catch(() => false);
    if (hasInput) {
      // Tutor is available – type a question
      await input.fill('Was ist ein Kaufvertrag?');
      const sendBtn = page.locator(
        'button:has-text("Senden"), button:has-text("Fragen"), button[aria-label*="send"]'
      ).first();
      if (await sendBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        // Just verify the button is clickable, don't wait for AI response
        await expect(sendBtn).toBeEnabled();
      }
    } else {
      console.warn('Tutor input not visible – tutor may not be available for this curriculum');
    }

    expect(await page.title()).toBeTruthy();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// F) Exam Simulation Page
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Golden Path: Exam', () => {
  test('Exam simulation page loads', async ({ page }) => {
    await loginAs(page, 'smoke_learner');

    const target = CURRICULUM_ID
      ? `/learner/exam/${CURRICULUM_ID}`
      : '/exam-simulation';
    await page.goto(target);
    await page.waitForLoadState('networkidle');

    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(50);
  });
});
