/**
 * E2E: Learner Full Journey – "Kompletter Kurs von A–Z"
 *
 * Tests the entire learner golden path:
 *   1. Login → Course open → Lesson rendering
 *   2. MiniCheck with answer verification + feedback
 *   3. Exam simulation (start, answer, submit, results)
 *   4. Console error gate across key pages
 *   5. DB REST reachability (optional)
 *
 * Selector strategy: data-testid attributes on all critical elements.
 * Auto-answer strategy: option[0] always, verify UI evaluates correctly.
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Config ───
const BASE_URL = process.env.E2E_BASE_URL || process.env.BASE_URL || 'https://examfitde.lovable.app';
const EMAIL = process.env.E2E_TEST_USER_EMAIL || process.env.E2E_EMAIL || '';
const PASSWORD = process.env.E2E_TEST_USER_PASSWORD || process.env.E2E_PASSWORD || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const MAX_LESSONS = Number(process.env.E2E_MAX_LESSONS || '3');
const MAX_MINICHECK_Q = Number(process.env.E2E_MAX_MINICHECK_QUESTIONS || '3');
const MAX_EXAM_Q = Number(process.env.E2E_EXAM_QUESTIONS || '5');

// ─── Helpers ───

async function login(page: Page) {
  if (!EMAIL || !PASSWORD) throw new Error('Missing E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD');

  await page.goto(`${BASE_URL}/auth`, { waitUntil: 'domcontentloaded' });

  // Use standard selectors with fallback
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for redirect away from auth
  await page.waitForURL((url) => !url.pathname.includes('/auth'), { timeout: 15_000 });
}

async function openFirstCourse(page: Page) {
  await page.goto(`${BASE_URL}/courses`, { waitUntil: 'domcontentloaded' });

  // Click first course card or link
  const courseCard = page.locator('[data-testid="course-card"]').first();
  const courseLink = page.locator('a[href*="/course/"]').first();

  if (await courseCard.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await courseCard.click();
  } else if (await courseLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await courseLink.click();
  } else {
    return false;
  }

  await expect(page.locator('[data-testid="course-title"]')).toBeVisible({ timeout: 15_000 });
  return true;
}

async function runMiniCheck(page: Page) {
  const player = page.locator('[data-testid="minicheck-player"]');
  if (!(await player.isVisible({ timeout: 5_000 }).catch(() => false))) return;

  for (let q = 0; q < MAX_MINICHECK_Q; q++) {
    const qText = page.locator('[data-testid="question-text"]');
    if (!(await qText.isVisible({ timeout: 3_000 }).catch(() => false))) break;

    // Select first option
    const opt0 = page.locator('[data-testid="question-option-0"]');
    if (!(await opt0.isVisible({ timeout: 3_000 }).catch(() => false))) break;
    await opt0.click();

    // Submit answer
    const submit = page.locator('[data-testid="answer-submit"]');
    if (await submit.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await submit.click();
      await page.waitForTimeout(2_000); // Wait for server response
    }

    // Verify feedback appears (correct OR incorrect)
    const hasFeedback =
      (await page.locator('[data-testid="feedback-correct"]').isVisible({ timeout: 3_000 }).catch(() => false)) ||
      (await page.locator('[data-testid="feedback-incorrect"]').isVisible({ timeout: 1_000 }).catch(() => false));
    expect(hasFeedback).toBeTruthy();

    // Click next
    const nextBtn = page.locator('[data-testid="question-next"]');
    if (await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(500);
    } else {
      break;
    }
  }

  // Check for result screen
  const resultCard = page.locator('[data-testid="minicheck-result"]');
  if (await resultCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const scoreText = await page.locator('[data-testid="minicheck-result-score"]').textContent();
    expect(scoreText).toMatch(/\d+ \/ \d+/);
  }
}

// ─── Test Suite ───

test.describe('Learner Full Journey – Golden Path', () => {
  test('1. Login → Course → Lessons → MiniCheck', async ({ page }) => {
    await login(page);
    const courseOpened = await openFirstCourse(page);
    test.skip(!courseOpened, 'No published course found');

    // Enter first lesson via continue button or lesson link
    const continueBtn = page.locator('[data-testid="course-continue-btn"]');
    if (await continueBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await continueBtn.click();
    } else {
      const firstLesson = page.locator('a[href*="/lesson/"]').first();
      if (await firstLesson.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await firstLesson.click();
      } else {
        test.skip(true, 'No lesson links found');
        return;
      }
    }

    // Verify lesson player renders with real content
    const lessonPlayer = page.locator('[data-testid="lesson-player"]');
    await expect(lessonPlayer).toBeVisible({ timeout: 15_000 });

    const contentCard = page.locator('[data-testid="lesson-content"]');
    await expect(contentCard).toBeVisible();
    const contentText = await contentCard.textContent();
    expect(contentText && contentText.length > 20).toBeTruthy();

    // MiniCheck (if present in this lesson)
    await runMiniCheck(page);
  });

  test('2. Exam Simulation → Answer → Submit → Score', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/exam-simulation`, { waitUntil: 'domcontentloaded' });

    // Wait for blueprint selector or active session
    const blueprintCard = page.locator('text=Prüfungssimulation');
    const activeExam = page.locator('[data-testid="exam-question-card"]');

    const hasBlueprint = await blueprintCard.isVisible({ timeout: 8_000 }).catch(() => false);
    const hasActive = await activeExam.isVisible({ timeout: 2_000 }).catch(() => false);

    if (hasBlueprint && !hasActive) {
      const startBtn = page.locator('button:has-text("Starten"), button:has-text("Start")').first();
      if (await startBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await startBtn.click();
        await page.waitForTimeout(3_000);
      }
    }

    // Answer exam questions if visible
    const questionCard = page.locator('[data-testid="exam-question-card"]');
    if (!(await questionCard.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, 'No exam questions available');
      return;
    }

    for (let i = 0; i < MAX_EXAM_Q; i++) {
      const opt = page.locator('[data-testid="exam-option-0"]');
      if (!(await opt.isVisible({ timeout: 3_000 }).catch(() => false))) break;
      await opt.click();

      const submitBtn = page.locator('[data-testid="exam-answer-submit"]');
      if (await submitBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(1_500);
      }

      // Navigate to next question
      const nextBtn = page.locator('button:has-text("Weiter")').first();
      if (await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Finish the exam
    const finishBtn = page.locator('button:has-text("Beenden")').first();
    if (await finishBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await finishBtn.click();
      // Confirm dialog
      const confirmBtn = page.locator('button:has-text("abschließen"), button:has-text("Bestätigen")').first();
      if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await confirmBtn.click();
      }
    }

    // Check results screen
    const resultCard = page.locator('[data-testid="exam-result-card"]');
    if (await resultCard.isVisible({ timeout: 8_000 }).catch(() => false)) {
      const score = page.locator('[data-testid="exam-result-score"]');
      await expect(score).toBeVisible();
      const scoreText = await score.textContent();
      expect(scoreText).toMatch(/\d+\.?\d*%/);
    }
  });

  test('3. Console Error Gate', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await login(page);

    const routes = ['/courses', '/dashboard', '/exam-simulation'];
    for (const route of routes) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(2_000);
    }

    const critical = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('manifest') &&
        !e.includes('ResizeObserver') &&
        !e.includes('net::ERR') &&
        !e.toLowerCase().includes('sw ')
    );

    expect(critical.length).toBeLessThanOrEqual(3);
  });

  test('4. DB Smoke: REST reachable (optional)', async () => {
    test.skip(!SUPABASE_URL || !SUPABASE_ANON_KEY, 'No SUPABASE_URL/SUPABASE_ANON_KEY set');

    const res = await fetch(`${SUPABASE_URL}/rest/v1/courses?select=id&limit=1`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });

    expect(res.ok).toBeTruthy();
  });
});
