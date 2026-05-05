/**
 * Learner Progress-Save Regression (hardened)
 * -------------------------------------------
 * Verifies the most important learner promise:
 *   "Lernen starten und Fortschritt behalten."
 *
 * Determinism:
 *   - E2E_QA_COURSE_ID  — pin a specific course (recommended for CI).
 *   - E2E_QA_LESSON_ID  — pin a specific lesson within that course (optional).
 *   - Fallback: stable sort by id and pick the first ready course with ≥2 lessons
 *     (NOT "middle of list" — which drifted whenever new courses were published).
 *
 * Anti-flake:
 *   - waitForLessonPlayerReady() polls until either the complete-btn or the
 *     completed-badge is visible (covers initial loading, slow networks, and
 *     the "already completed from a prior run" case).
 *   - All getByTestId calls use explicit timeouts.
 *   - Hard reload waits for player shell + badge before asserting persistence.
 *   - On failure, course/lesson ids and a screenshot are attached to the report.
 *   - Progressbar aria-valuenow is captured before/after to assert the course
 *     progress strictly increases (when a fresh lesson is completed).
 */
import { test, expect, Page, TestInfo } from '@playwright/test';
import { loginAs, TEST_USERS } from './helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const PINNED_COURSE_ID = process.env.E2E_QA_COURSE_ID || '';
const PINNED_LESSON_ID = process.env.E2E_QA_LESSON_ID || '';

type Ready = { id: string; title: string; modules: number; lessons: number; is_ready: boolean };

async function fetchReadyCourses(): Promise<Ready[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing');
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_learner_course_readiness`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!r.ok) throw new Error(`readiness RPC ${r.status}: ${await r.text()}`);
  return (await r.json()) as Ready[];
}

async function pickRepresentativeCourse(): Promise<Ready> {
  if (PINNED_COURSE_ID) {
    const all = await fetchReadyCourses();
    const hit = all.find((c) => c.id === PINNED_COURSE_ID);
    if (!hit) throw new Error(`E2E_QA_COURSE_ID=${PINNED_COURSE_ID} not in readiness RPC`);
    if (!hit.is_ready)
      throw new Error(`Pinned course ${PINNED_COURSE_ID} is not ready (modules=${hit.modules}, lessons=${hit.lessons})`);
    return hit;
  }
  const all = await fetchReadyCourses();
  const ready = all
    .filter((c) => c.is_ready && c.lessons >= 2)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!ready.length) throw new Error('No ready courses with >=2 lessons available');
  // Stable: first by id-sort. Reproducible across runs unless catalog changes.
  return ready[0];
}

async function pickEmptyCourse(): Promise<Ready | null> {
  const all = await fetchReadyCourses();
  return all.find((c) => !c.is_ready && c.modules === 0) ?? null;
}

async function annotate(testInfo: TestInfo, key: string, value: string) {
  testInfo.annotations.push({ type: key, description: value });
}

async function attachOnFailure(page: Page, testInfo: TestInfo, label: string) {
  if (testInfo.status === testInfo.expectedStatus) return;
  try {
    const buf = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${label}.png`, { body: buf, contentType: 'image/png' });
  } catch {
    /* ignore */
  }
}

/**
 * Wait until the lesson player is interactive: either the complete button is
 * visible (fresh lesson) OR the completed badge is visible (already done).
 * Returns which state we landed in.
 */
async function waitForLessonPlayerReady(page: Page): Promise<'ready_to_complete' | 'already_completed'> {
  await expect(page.getByTestId('lesson-player')).toBeVisible({ timeout: 20_000 });
  const completeBtn = page.getByTestId('lesson-complete-btn');
  const completedBadge = page.getByTestId('lesson-completed-badge');
  // Race the two via Promise.any-style loop with explicit budget.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await completedBadge.isVisible().catch(() => false)) return 'already_completed';
    if (await completeBtn.isVisible().catch(() => false)) return 'ready_to_complete';
    await page.waitForTimeout(250);
  }
  throw new Error('Lesson player did not become interactive within 15s');
}

async function openLesson(page: Page, courseId: string, lessonId?: string): Promise<string> {
  if (lessonId) {
    await page.goto(`/lesson/${lessonId}`);
    return lessonId;
  }
  await page.goto(`/course/${courseId}`);
  await expect(page.getByTestId('course-title')).toBeVisible({ timeout: 20_000 });
  const items = page.getByTestId('lesson-item');
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    if ((await item.getAttribute('data-lesson-locked')) === 'false') {
      const id = await item.getAttribute('data-lesson-id');
      await item.click();
      await page.waitForURL(/\/lesson\//, { timeout: 15_000 });
      return id || '';
    }
  }
  throw new Error(`No unlocked lesson found on course ${courseId}`);
}

async function readCourseProgressPercent(page: Page): Promise<number | null> {
  const bar = page.getByRole('progressbar').first();
  if (!(await bar.isVisible({ timeout: 5_000 }).catch(() => false))) return null;
  const v = await bar.getAttribute('aria-valuenow');
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

test.describe('Learner: progress is saved and survives reload', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'qa_allaccess');
  });

  test('mark lesson completed → reload → still completed', async ({ page }, testInfo) => {
    const course = await pickRepresentativeCourse();
    await annotate(testInfo, 'course', `${course.id} :: ${course.title}`);
    if (PINNED_LESSON_ID) await annotate(testInfo, 'pinned_lesson', PINNED_LESSON_ID);

    try {
      // Capture progress baseline (before completion).
      await page.goto(`/course/${course.id}`);
      await expect(page.getByTestId('course-title')).toBeVisible({ timeout: 20_000 });
      const progressBefore = await readCourseProgressPercent(page);
      await annotate(testInfo, 'progress_before', String(progressBefore));

      const lessonId = await openLesson(page, course.id, PINNED_LESSON_ID || undefined);
      await annotate(testInfo, 'lesson', lessonId);

      const state = await waitForLessonPlayerReady(page);
      const completedBadge = page.getByTestId('lesson-completed-badge');

      if (state === 'ready_to_complete') {
        await page.getByTestId('lesson-complete-btn').click();
        await expect(completedBadge).toBeVisible({ timeout: 20_000 });
      } else {
        // Idempotent: lesson already completed from prior run.
        await annotate(testInfo, 'precondition', 'lesson_already_completed');
      }

      // Hard reload — progress must be persisted server-side.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('lesson-player')).toBeVisible({ timeout: 20_000 });
      await expect(completedBadge).toBeVisible({ timeout: 20_000 });

      // Course view reflects the new state.
      await page.goto(`/course/${course.id}`);
      await expect(page.getByTestId('course-title')).toBeVisible({ timeout: 20_000 });
      const item = page.locator(`[data-testid="lesson-item"][data-lesson-id="${lessonId}"]`);
      await expect(item).toBeVisible({ timeout: 10_000 });
      const status = await item.getAttribute('data-lesson-status');
      await annotate(testInfo, 'lesson_status_after', String(status));
      expect(status, `lesson status after reload=${status}`).not.toBe('not_started');

      // Progress percentage must not regress; on a fresh completion it must rise.
      const progressAfter = await readCourseProgressPercent(page);
      await annotate(testInfo, 'progress_after', String(progressAfter));
      if (progressBefore !== null && progressAfter !== null) {
        if (state === 'ready_to_complete') {
          expect(progressAfter, 'progress should increase after a fresh completion').toBeGreaterThan(
            progressBefore,
          );
        } else {
          expect(progressAfter, 'progress must not regress on reload').toBeGreaterThanOrEqual(
            progressBefore,
          );
        }
      }
    } finally {
      await attachOnFailure(page, testInfo, 'progress-persistence');
    }
  });
});

test.describe('Learner: negative states', () => {
  test('anonymous visitor sees login CTA on lesson route, never the player', async ({ browser }, testInfo) => {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    try {
      const course = await pickRepresentativeCourse();
      await annotate(testInfo, 'course', course.id);
      await page.goto(`/course/${course.id}`);

      const anonCta = page
        .getByRole('button', { name: /anmelden|anmelden & starten|jetzt einschreiben/i })
        .first();
      await expect(anonCta).toBeVisible({ timeout: 20_000 });

      const items = page.getByTestId('lesson-item');
      if ((await items.count()) > 0) {
        const lessonId = await items.first().getAttribute('data-lesson-id');
        if (lessonId) {
          await page.goto(`/lesson/${lessonId}`);
          await page.waitForLoadState('domcontentloaded');
          await expect(page.getByTestId('lesson-player')).toHaveCount(0, { timeout: 8_000 });
        }
      }
    } finally {
      await attachOnFailure(page, testInfo, 'anon-paywall');
      await ctx.close();
    }
  });

  test('logged-in user without entitlement sees Lizenz/Paywall CTA', async ({ page }, testInfo) => {
    if (
      !TEST_USERS.smoke_no_entitlement.email ||
      !TEST_USERS.smoke_no_entitlement.password
    ) {
      test.skip(true, 'smoke_no_entitlement creds missing');
    }
    try {
      await loginAs(page, 'smoke_no_entitlement');
      const course = await pickRepresentativeCourse();
      await annotate(testInfo, 'course', course.id);

      await page.goto(`/course/${course.id}`);
      await expect(page.getByTestId('course-title')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('course-continue-btn')).toHaveCount(0, { timeout: 8_000 });
      const licenseCta = page.getByRole('button', { name: /lizenz/i }).first();
      await expect(licenseCta).toBeVisible({ timeout: 15_000 });
    } finally {
      await attachOnFailure(page, testInfo, 'no-entitlement');
    }
  });

  test('empty course renders "in Vorbereitung" state, not a broken page', async ({ page }, testInfo) => {
    const empty = await pickEmptyCourse();
    test.skip(!empty, 'No empty published courses currently in catalog');
    try {
      await annotate(testInfo, 'course', empty!.id);
      await loginAs(page, 'qa_allaccess');
      await page.goto(`/course/${empty!.id}`);

      const emptyState = page.getByText(
        /noch keine module|werden gerade vorbereitet|in vorbereitung/i,
      );
      const visible = await emptyState.first().isVisible({ timeout: 8_000 }).catch(() => false);
      if (!visible) {
        await expect(page.getByTestId('lesson-item')).toHaveCount(0);
      }
    } finally {
      await attachOnFailure(page, testInfo, 'empty-course');
    }
  });
});
