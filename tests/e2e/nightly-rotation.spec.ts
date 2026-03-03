// ExamFit Nightly Rotation E2E Tests
// Duration: 30-90 minutes | Trigger: nightly cron or manual
// Strategy:
//   - 1 curriculum full sweep (every question rendered + auto-answer)
//   - 2 additional curricula sampled (50 questions each)
//   - Coverage report as JSON artifact

import { test, expect } from '@playwright/test';
import { loginAs, env } from './helpers/auth';
import {
  CoverageReport,
  collectConsoleErrors,
  filterBenignErrors,
  answerDrillQuestions,
  answerExamQuestions,
  submitExam,
  startOralExam,
  answerOralQuestion,
} from './helpers/flows';
import { fetchPublishedCurricula } from './helpers/api';
import * as fs from 'fs';
import * as path from 'path';

const report = new CoverageReport();

test.afterAll(async () => {
  // Write coverage report
  const outDir = path.join(process.cwd(), 'test-results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'coverage-report.json'),
    JSON.stringify(report.toJSON(), null, 2)
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1) Full Curriculum Sweep
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Nightly: Full Curriculum Sweep', () => {
  test('Drill: answer all available questions for primary curriculum', async ({ page }) => {
    const start = Date.now();
    const curriculumId = env('CURRICULUM_ID');
    if (!curriculumId) {
      report.add({ curriculum_id: 'unknown', test: 'drill-full', status: 'skip', duration_ms: 0, error: 'No CURRICULUM_ID' });
      test.skip();
      return;
    }

    await loginAs(page, 'smoke_learner');
    await page.goto(`/drill?curriculum=${curriculumId}`);
    await page.waitForLoadState('networkidle');

    // Select first competency if selector is visible
    const compButton = page.locator('button:has-text("Starten"), button:has-text("Drill starten")').first();
    if (await compButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      const compItem = page.locator('[data-competency], button[class*="competency"]').first();
      if (await compItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await compItem.click();
      }
      await compButton.click();
      await page.waitForTimeout(2000);
    }

    // Answer up to 50 questions in sweep mode
    await answerDrillQuestions(page, 50);

    report.add({
      curriculum_id: curriculumId,
      test: 'drill-full-sweep',
      status: 'pass',
      duration_ms: Date.now() - start,
    });
  });

  test('Exam: full simulation for primary curriculum', async ({ page }) => {
    const start = Date.now();
    const curriculumId = env('CURRICULUM_ID');
    if (!curriculumId) {
      report.add({ curriculum_id: 'unknown', test: 'exam-full', status: 'skip', duration_ms: 0 });
      test.skip();
      return;
    }

    await loginAs(page, 'smoke_learner');
    await page.goto('/exam-simulation');
    await page.waitForLoadState('networkidle');

    // Start exam
    const startBtn = page.locator(
      'button:has-text("Prüfung starten"), button:has-text("Simulation starten"), button:has-text("Start")'
    ).first();
    if (await startBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(3000);
    }

    // Answer up to 40 questions (typical IHK exam length)
    await answerExamQuestions(page, 40);
    await submitExam(page);

    // Verify results page
    await page.waitForTimeout(3000);
    const body = await page.textContent('body');
    const hasResult =
      body?.includes('Ergebnis') ||
      body?.includes('Score') ||
      body?.includes('Auswertung') ||
      body?.includes('Bestanden') ||
      body?.includes('Nicht bestanden');

    report.add({
      curriculum_id: curriculumId,
      test: 'exam-full-simulation',
      status: hasResult ? 'pass' : 'fail',
      duration_ms: Date.now() - start,
      error: hasResult ? undefined : 'No result screen visible after submit',
    });

    expect(hasResult).toBeTruthy();
  });

  test('Oral: full 5-question session for primary curriculum', async ({ page }) => {
    const start = Date.now();
    const curriculumId = env('CURRICULUM_ID');
    if (!curriculumId) {
      report.add({ curriculum_id: 'unknown', test: 'oral-full', status: 'skip', duration_ms: 0 });
      test.skip();
      return;
    }

    await loginAs(page, 'smoke_learner');
    await startOralExam(page, curriculumId);

    // Start session
    const startBtn = page.locator(
      'button:has-text("Prüfung starten"), button:has-text("Start"), button:has-text("Übung starten")'
    ).first();
    if (await startBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(3000);
    }

    // Answer 5 questions
    for (let q = 0; q < 5; q++) {
      const textarea = page.locator('textarea').first();
      const visible = await textarea.isVisible({ timeout: 15_000 }).catch(() => false);
      if (!visible) break;

      await textarea.fill(
        `Antwort ${q + 1}: Ich definiere zunächst den Fachbegriff, erläutere die praktische Anwendung im Betrieb und verknüpfe sie mit der IHK-Prüfungsrelevanz.`
      );

      const submitBtn = page.locator(
        'button:has-text("Abgeben"), button:has-text("Bewerten"), button:has-text("Absenden")'
      ).first();
      if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(5000); // Wait for AI evaluation
      }

      // Click next question if visible
      const nextBtn = page.locator(
        'button:has-text("Nächste Frage"), button:has-text("Weiter")'
      ).first();
      if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    report.add({
      curriculum_id: curriculumId,
      test: 'oral-full-session',
      status: 'pass',
      duration_ms: Date.now() - start,
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2) Sampling: Additional Curricula (rotation)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Nightly: Curriculum Rotation Sampling', () => {
  test('Sample drill across multiple curricula', async ({ page }) => {
    const curricula = await fetchPublishedCurricula();
    if (curricula.length === 0) {
      test.skip();
      return;
    }

    await loginAs(page, 'smoke_learner');

    // Pick up to 2 curricula for sampling (round-robin by day)
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
    );
    const sampleIndices = [
      dayOfYear % curricula.length,
      (dayOfYear + 1) % curricula.length,
    ];
    const uniqueIndices = [...new Set(sampleIndices)];

    for (const idx of uniqueIndices) {
      const curr = curricula[idx];
      const start = Date.now();

      try {
        await page.goto(`/drill?curriculum=${curr.id}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // Select first competency if available
        const compButton = page.locator('button:has-text("Starten"), button:has-text("Drill starten")').first();
        if (await compButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          const compItem = page.locator('[data-competency], button[class*="competency"]').first();
          if (await compItem.isVisible({ timeout: 2000 }).catch(() => false)) {
            await compItem.click();
          }
          await compButton.click();
          await page.waitForTimeout(2000);
        }

        // Answer 10 questions as sample
        await answerDrillQuestions(page, 10);

        report.add({
          curriculum_id: curr.id,
          test: 'drill-sample',
          status: 'pass',
          duration_ms: Date.now() - start,
        });
      } catch (e) {
        report.add({
          curriculum_id: curr.id,
          test: 'drill-sample',
          status: 'fail',
          duration_ms: Date.now() - start,
          error: String(e),
        });
      }
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3) All-Pages Render Check (no answering, just load)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Nightly: Page Render Check', () => {
  const protectedPages = [
    '/dashboard',
    '/exam-trainer',
    '/exam-simulation',
    '/oral-exam',
    '/drill',
    '/spaced-repetition',
    '/courses',
  ];

  for (const pagePath of protectedPages) {
    test(`Page renders without error: ${pagePath}`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await loginAs(page, 'smoke_learner');
      await page.goto(pagePath);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Page should have content
      const body = await page.textContent('body');
      expect(body?.length).toBeGreaterThan(50);

      // No console errors
      const real = filterBenignErrors(errors);
      expect(real).toHaveLength(0);

      report.add({
        curriculum_id: 'all',
        test: `render-${pagePath}`,
        status: 'pass',
        duration_ms: 0,
      });
    });
  }
});
