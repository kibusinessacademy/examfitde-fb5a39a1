// ExamFit E2E Flow Helpers – reusable learner journey steps
import { Page, expect, Locator } from '@playwright/test';

// ─── Console Error Collector ─────────────────────────────
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

export function filterBenignErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('serviceworker') &&
      !e.includes('Failed to load resource') &&
      !e.includes('net::ERR')
  );
}

// ─── Navigation Helpers ──────────────────────────────────
export async function navigateToDashboard(page: Page) {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
}

export async function navigateToCourses(page: Page) {
  await page.goto('/courses');
  await page.waitForLoadState('networkidle');
}

// ─── Drill Mode ──────────────────────────────────────────
export async function startDrill(page: Page, curriculumId: string, count = 5) {
  await page.goto(`/drill?curriculum=${curriculumId}`);
  await page.waitForLoadState('networkidle');
}

export async function answerDrillQuestions(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    // Wait for a question to appear
    const radioOption = page.locator('input[type="radio"]').first();
    const hasRadio = await radioOption.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!hasRadio) break;

    // Select first option
    await radioOption.check();

    // Click submit/confirm button
    const submitBtn = page.locator(
      'button:has-text("Antwort bestätigen"), button:has-text("Weiter"), button:has-text("Prüfen")'
    ).first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
    }

    // Wait for feedback or next question
    await page.waitForTimeout(1500);

    // Click "next" if visible
    const nextBtn = page.locator('button:has-text("Nächste"), button:has-text("Weiter")').first();
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(500);
    }
  }
}

// ─── Exam Simulation ─────────────────────────────────────
export async function startExamSimulation(page: Page, curriculumId?: string) {
  if (curriculumId) {
    await page.goto(`/exam-simulation`);
  } else {
    await page.goto('/exam-simulation');
  }
  await page.waitForLoadState('networkidle');
}

export async function answerExamQuestions(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    const radioOption = page.locator('input[type="radio"]').first();
    const hasRadio = await radioOption.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!hasRadio) break;

    await radioOption.check();

    const submitBtn = page.locator(
      'button:has-text("Antwort bestätigen"), button:has-text("Bestätigen")'
    ).first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
    }

    await page.waitForTimeout(1500);

    // Navigate to next question if possible
    const nextBtn = page.locator('button:has-text("Nächste"), button[aria-label*="next"], button:has-text("Weiter")').first();
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(500);
    }
  }
}

export async function submitExam(page: Page) {
  const submitBtn = page.locator(
    'button:has-text("Abgeben"), button:has-text("Prüfung beenden"), button:has-text("Submit")'
  ).first();
  if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submitBtn.click();
    // Confirm dialog if exists
    const confirmBtn = page.locator(
      'button:has-text("Ja"), button:has-text("Bestätigen"), [role="alertdialog"] button:has-text("Abgeben")'
    ).first();
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
    }
  }
}

// ─── Oral Exam ───────────────────────────────────────────
export async function startOralExam(page: Page, curriculumId?: string) {
  const url = curriculumId ? `/oral-exam?curriculum=${curriculumId}` : '/oral-exam';
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

export async function answerOralQuestion(page: Page, answer: string) {
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible({ timeout: 15_000 });
  await textarea.fill(answer);

  const submitBtn = page.locator(
    'button:has-text("Abgeben"), button:has-text("Bewerten"), button:has-text("Absenden")'
  ).first();
  await submitBtn.click();
  await page.waitForTimeout(3000);
}

// ─── MiniCheck ───────────────────────────────────────────
export async function answerMiniCheck(page: Page) {
  // Find and answer mini-check questions
  const radioOptions = page.locator('input[type="radio"]');
  const count = await radioOptions.count();

  if (count > 0) {
    await radioOptions.first().check();

    const submitBtn = page.locator(
      'button:has-text("Prüfen"), button:has-text("Antwort"), button:has-text("Weiter")'
    ).first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
    }
  }
}

// ─── AI Tutor ────────────────────────────────────────────
export async function askTutor(page: Page, question: string) {
  const input = page.locator('textarea, input[placeholder*="Frage"], input[placeholder*="frag"]').first();
  if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
    await input.fill(question);
    const sendBtn = page.locator(
      'button:has-text("Senden"), button:has-text("Fragen"), button[aria-label*="send"]'
    ).first();
    await sendBtn.click();
    // Wait for response
    await page.waitForTimeout(10_000);
  }
}

// ─── Lesson Player ───────────────────────────────────────
export async function openLesson(page: Page, lessonId: string) {
  await page.goto(`/lesson/${lessonId}`);
  await page.waitForLoadState('networkidle');
}

// ─── Coverage Report ─────────────────────────────────────
export interface CoverageEntry {
  curriculum_id: string;
  test: string;
  status: 'pass' | 'fail' | 'skip';
  duration_ms: number;
  error?: string;
  timestamp: string;
}

export class CoverageReport {
  entries: CoverageEntry[] = [];

  add(entry: Omit<CoverageEntry, 'timestamp'>) {
    this.entries.push({ ...entry, timestamp: new Date().toISOString() });
  }

  toJSON() {
    const passed = this.entries.filter((e) => e.status === 'pass').length;
    const failed = this.entries.filter((e) => e.status === 'fail').length;
    const skipped = this.entries.filter((e) => e.status === 'skip').length;
    return {
      summary: { total: this.entries.length, passed, failed, skipped },
      entries: this.entries,
      generated_at: new Date().toISOString(),
    };
  }
}
