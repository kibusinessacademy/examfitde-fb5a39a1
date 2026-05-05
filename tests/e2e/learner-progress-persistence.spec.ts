/**
 * Learner Progress-Save Regression
 * --------------------------------
 * Verifies the most important learner promise:
 *   "Lernen starten und Fortschritt behalten."
 *
 * Flow:
 *   1. Login as qa_allaccess (full entitlement)
 *   2. Pick a representative ready course (via public_learner_course_readiness)
 *   3. Open course detail → click first unlocked lesson
 *   4. Mark lesson as completed
 *   5. Reload the lesson page → completed badge still visible
 *   6. Navigate back to course → lesson item shows mastered/in_progress status
 *
 * Plus a Negative-State block (separate describe):
 *   - anonymous: lesson page shows login CTA (no progress write)
 *   - logged-in but no entitlement: paywall / "Lizenz" CTA on course
 *   - empty course (modules=0): "in Vorbereitung" / no lesson items
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, TEST_USERS } from './helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

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
  const all = await fetchReadyCourses();
  const ready = all.filter((c) => c.is_ready && c.lessons >= 2);
  if (!ready.length) throw new Error('No ready courses with >=2 lessons available');
  // Deterministic: middle of the list (avoids edge biases).
  return ready[Math.floor(ready.length / 2)];
}

async function pickEmptyCourse(): Promise<Ready | null> {
  const all = await fetchReadyCourses();
  return all.find((c) => !c.is_ready && c.modules === 0) ?? null;
}

async function openFirstUnlockedLesson(page: Page, courseId: string): Promise<string | null> {
  await page.goto(`/course/${courseId}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.getByTestId('course-title')).toBeVisible({ timeout: 15_000 });

  const items = page.getByTestId('lesson-item');
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const locked = await item.getAttribute('data-lesson-locked');
    if (locked === 'false') {
      const lessonId = await item.getAttribute('data-lesson-id');
      await item.click();
      await page.waitForURL(/\/lesson\//, { timeout: 15_000 });
      return lessonId;
    }
  }
  return null;
}

test.describe('Learner: progress is saved and survives reload', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'qa_allaccess');
  });

  test('mark lesson completed → reload → still completed', async ({ page }) => {
    const course = await pickRepresentativeCourse();
    test.info().annotations.push({ type: 'course', description: `${course.id} :: ${course.title}` });

    const lessonId = await openFirstUnlockedLesson(page, course.id);
    expect(lessonId, 'no unlocked lesson found on representative course').toBeTruthy();

    // Lesson player shell visible
    await expect(page.getByTestId('lesson-player')).toBeVisible({ timeout: 15_000 });

    // Mark as completed (idempotent: if already completed, skip click)
    const completeBtn = page.getByTestId('lesson-complete-btn');
    const completedBadge = page.getByTestId('lesson-completed-badge');

    if (await completeBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await completeBtn.click();
      await expect(completedBadge).toBeVisible({ timeout: 15_000 });
    } else {
      // Already completed from prior run — still a valid persistence assertion.
      await expect(completedBadge).toBeVisible({ timeout: 5_000 });
    }

    // Hard reload — must persist server-side, not just in component state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('lesson-player')).toBeVisible({ timeout: 15_000 });
    await expect(completedBadge).toBeVisible({ timeout: 15_000 });

    // Navigate back to course → lesson item reflects non-"not_started" state.
    await page.goto(`/course/${course.id}`);
    await expect(page.getByTestId('course-title')).toBeVisible({ timeout: 15_000 });
    const item = page.locator(`[data-testid="lesson-item"][data-lesson-id="${lessonId}"]`);
    await expect(item).toBeVisible();
    const status = await item.getAttribute('data-lesson-status');
    expect(status, `lesson status after reload=${status}`).not.toBe('not_started');
  });
});

test.describe('Learner: negative states', () => {
  test('anonymous visitor sees login CTA on lesson route, never the player', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();

    const course = await pickRepresentativeCourse();
    await page.goto(`/course/${course.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    // Course page is public, but an anonymous user must see "Anmelden" CTA, not "Fortsetzen".
    const anonCta = page
      .getByRole('button', { name: /anmelden|anmelden & starten|jetzt einschreiben/i })
      .first();
    await expect(anonCta).toBeVisible({ timeout: 15_000 });

    // Direct lesson access must NOT render the lesson player.
    // Try first unlocked lesson id from the course page.
    const items = page.getByTestId('lesson-item');
    if ((await items.count()) > 0) {
      const lessonId = await items.first().getAttribute('data-lesson-id');
      if (lessonId) {
        await page.goto(`/lesson/${lessonId}`);
        await page.waitForLoadState('domcontentloaded');
        // Either redirected to /auth or shown a Lock state — but never the lesson-player shell.
        await expect(page.getByTestId('lesson-player')).toHaveCount(0, { timeout: 5_000 });
      }
    }

    await ctx.close();
  });

  test('logged-in user without entitlement sees Lizenz/Paywall CTA', async ({ page }) => {
    if (
      !TEST_USERS.smoke_no_entitlement.email ||
      !TEST_USERS.smoke_no_entitlement.password
    ) {
      test.skip(true, 'smoke_no_entitlement creds missing');
    }
    await loginAs(page, 'smoke_no_entitlement');

    const course = await pickRepresentativeCourse();
    await page.goto(`/course/${course.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page.getByTestId('course-title')).toBeVisible({ timeout: 15_000 });

    // Continue button (entitled state) must NOT appear; license CTA must.
    await expect(page.getByTestId('course-continue-btn')).toHaveCount(0, { timeout: 5_000 });
    const licenseCta = page.getByRole('button', { name: /lizenz/i }).first();
    await expect(licenseCta).toBeVisible({ timeout: 10_000 });
  });

  test('empty course renders "in Vorbereitung" state, not a broken page', async ({ page }) => {
    const empty = await pickEmptyCourse();
    test.skip(!empty, 'No empty published courses currently in catalog');

    await loginAs(page, 'qa_allaccess');
    await page.goto(`/course/${empty!.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    // Either the course is hidden (404 / not visible) OR it shows the prepared empty-state copy.
    const emptyState = page.getByText(/noch keine module|werden gerade vorbereitet|in vorbereitung/i);
    const visible = await emptyState.first().isVisible({ timeout: 5_000 }).catch(() => false);
    if (!visible) {
      // Acceptable alternative: zero lesson items + zero hard errors.
      await expect(page.getByTestId('lesson-item')).toHaveCount(0);
    }
  });
});
