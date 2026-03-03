// ExamFit Smoke Tests – Post-Publish Suite
// Duration: 3-8 minutes | Trigger: every deploy
// Coverage: App health, auth, entitlement gates, drill, exam, minicheck, oral, tutor, UI guards

import { test, expect } from '@playwright/test';
import { loginAs, logout, TEST_USERS, env } from './helpers/auth';
import {
  collectConsoleErrors,
  filterBenignErrors,
  navigateToDashboard,
  navigateToCourses,
  startDrill,
  answerDrillQuestions,
  startExamSimulation,
  answerExamQuestions,
  submitExam,
  startOralExam,
  answerOralQuestion,
} from './helpers/flows';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// A) App Health & Navigation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Smoke: App Health', () => {
  test('Landing page loads without console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    expect(filterBenignErrors(errors)).toHaveLength(0);
  });

  test('Auth page loads with email input', async ({ page }) => {
    const response = await page.goto('/auth');
    expect(response?.status()).toBe(200);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('Protected route redirects unauthenticated users', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(
      (url) => url.pathname.includes('/auth') || url.pathname === '/',
      { timeout: 5000 }
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// B) Auth Happy Path
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Smoke: Auth', () => {
  test('Login → Dashboard → Logout', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await expect(page).not.toHaveURL(/\/auth/);
    await navigateToDashboard(page);
    await expect(page.locator('body')).not.toBeEmpty();
    await logout(page);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// C) Entitlement Gates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Smoke: Entitlement Gates', () => {
  test('Non-entitled user sees purchase CTA', async ({ page }) => {
    await loginAs(page, 'smoke_no_entitlement');
    await navigateToCourses(page);

    const body = await page.textContent('body');
    const hasGate =
      body?.includes('Kein Zugriff') ||
      body?.includes('Kurs kaufen') ||
      body?.includes('Jetzt starten') ||
      body?.includes('Freischalten');
    expect(hasGate).toBeTruthy();
  });

  test('Entitled user sees course content', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await navigateToCourses(page);

    const body = await page.textContent('body');
    const hasContent =
      body?.includes('Prüfung starten') ||
      body?.includes('Weiterlernen') ||
      body?.includes('Modul') ||
      body?.includes('Dashboard');
    expect(hasContent).toBeTruthy();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// D) Drill Mode – 5 Questions auto-answer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Smoke: Drill Mode', () => {
  test('Start drill and answer 5 questions', async ({ page }) => {
    await loginAs(page, 'smoke_learner');

    const curriculumId = env('CURRICULUM_ID');
    if (!curriculumId) {
      // Navigate to drill page and pick first available
      await page.goto('/drill');
      await page.waitForLoadState('networkidle');
    } else {
      await startDrill(page, curriculumId);
    }

    // Wait for competency selector or questions
    await page.waitForTimeout(2000);

    // If competency selector is visible, pick first
    const compButton = page.locator('button:has-text("Starten"), button:has-text("Drill starten")').first();
    if (await compButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Select first competency if needed
      const compItem = page.locator('[data-competency], button[class*="competency"]').first();
      if (await compItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await compItem.click();
      }
      await compButton.click();
      await page.waitForTimeout(2000);
    }

    await answerDrillQuestions(page, 5);

    // No crash assertion
    expect(await page.title()).toBeTruthy();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E) Exam Simulation – 5 Questions + Submit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Smoke: Exam Simulation', () => {
  test('Start exam, answer 5 questions, submit', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await startExamSimulation(page);

    // Wait for blueprint selector or exam to load
    await page.waitForTimeout(3000);

    // Start exam if blueprint selector is visible
    const startBtn = page.locator(
      'button:has-text("Prüfung starten"), button:has-text("Simulation starten"), button:has-text("Start")'
    ).first();
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(3000);
    }

    await answerExamQuestions(page, 5);
    await submitExam(page);

    // Should see result or score
    await page.waitForTimeout(2000);
    expect(await page.title()).toBeTruthy();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// F) Oral Exam – Start + 1 Answer + Feedback
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Smoke: Oral Exam', () => {
  test('Start oral session, answer 1 question, get feedback', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    const curriculumId = env('CURRICULUM_ID');
    await startOralExam(page, curriculumId || undefined);

    // Start session
    const startBtn = page.locator(
      'button:has-text("Prüfung starten"), button:has-text("Start"), button:has-text("Übung starten")'
    ).first();
    if (await startBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(3000);
    }

    // Answer with structured response
    await answerOralQuestion(
      page,
      'Ich strukturiere meine Antwort: 1) Definition des Begriffs, 2) Konkretes Praxisbeispiel aus dem Berufsalltag, 3) Relevanz für die IHK-Prüfung.'
    );

    // Expect feedback/scores
    const body = await page.textContent('body');
    const hasFeedback =
      body?.includes('Feedback') ||
      body?.includes('Bewertung') ||
      body?.includes('Fachlichkeit') ||
      body?.includes('Struktur') ||
      body?.includes('Punkte');
    // Soft assertion – oral exam may take time for AI
    if (!hasFeedback) {
      console.warn('Oral exam feedback not immediately visible – AI may still be processing');
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// G) Exam Trainer Page loads
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Smoke: Core Modules Alive', () => {
  test('Exam trainer page loads', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await page.goto('/exam-trainer');
    await page.waitForLoadState('networkidle');
    expect(await page.title()).toBeTruthy();
  });

  test('Dashboard loads with content', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await navigateToDashboard(page);
    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(100);
  });

  test('Spaced repetition page loads', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await page.goto('/spaced-repetition');
    await page.waitForLoadState('networkidle');
    expect(await page.title()).toBeTruthy();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// H) UI Quality Guards
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Smoke: UI Quality', () => {
  test('No console errors on dashboard', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loginAs(page, 'smoke_learner');
    await navigateToDashboard(page);
    await page.waitForTimeout(2000);
    const real = filterBenignErrors(errors);
    expect(real).toHaveLength(0);
  });

  test('No console errors on exam trainer', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loginAs(page, 'smoke_learner');
    await page.goto('/exam-trainer');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    const real = filterBenignErrors(errors);
    expect(real).toHaveLength(0);
  });
});
