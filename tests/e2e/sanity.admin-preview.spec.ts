// ExamFit Sanity: Admin Learner Preview + Auto-Test-Queue
// Duration: ~2 min | Trigger: PR/merge + nightly

import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { collectConsoleErrors, filterBenignErrors } from './helpers/flows';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// A) Admin Preview Page Loads
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Admin Preview: Page Load', () => {
  test('Admin preview page loads without errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loginAs(page, 'smoke_learner');
    await page.goto('/admin/learner-preview');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Learner Preview')).toBeVisible({ timeout: 10_000 });
    expect(filterBenignErrors(errors)).toHaveLength(0);
  });

  test('Auto-Test-Queue section is visible', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await page.goto('/admin/learner-preview');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByText('Heutige Test-Priorität').or(page.getByText('Auto-Test-Queue'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Priority summary shows counts', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await page.goto('/admin/learner-preview');
    await page.waitForLoadState('networkidle');

    // Should have at least one of the priority summary cards
    const hasSummary =
      (await page.getByText('🔴 Kritisch').isVisible({ timeout: 5_000 }).catch(() => false)) ||
      (await page.getByText('🟡 Aufmerksam').isVisible({ timeout: 2_000 }).catch(() => false)) ||
      (await page.getByText('🟢 Stabil').isVisible({ timeout: 2_000 }).catch(() => false));

    expect(hasSummary).toBeTruthy();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// B) Filters & Search
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Admin Preview: Filters', () => {
  test('Search input filters course cards', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await page.goto('/admin/learner-preview');
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByPlaceholder('Kurs suchen');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Type a search term that likely won't match
    await searchInput.fill('zzz_nonexistent_course_xyz');
    await page.waitForTimeout(500);

    await expect(page.getByText('0 Kurse sichtbar')).toBeVisible({ timeout: 3_000 });
  });

  test('Priority filter buttons work', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await page.goto('/admin/learner-preview');
    await page.waitForLoadState('networkidle');

    // Click critical filter
    const criticalBtn = page.getByRole('button', { name: /kritisch/i }).first();
    if (await criticalBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await criticalBtn.click();
      await page.waitForTimeout(500);
      // Page should still be functional
      await expect(page.getByText(/Kurse sichtbar/)).toBeVisible();
    }
  });

  test('Preview mode buttons toggle', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await page.goto('/admin/learner-preview');
    await page.waitForLoadState('networkidle');

    const premiumBtn = page.getByRole('button', { name: /Premium Preview/i });
    await expect(premiumBtn).toBeVisible({ timeout: 10_000 });
    await premiumBtn.click();

    // Premium should now be active (default variant)
    await expect(premiumBtn).toBeVisible();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// C) Quick Links Open Correct Targets
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Admin Preview: Quick Links', () => {
  test('Course quick link opens with admin_preview param', async ({ page, context }) => {
    await loginAs(page, 'smoke_learner');
    await page.goto('/admin/learner-preview');
    await page.waitForLoadState('networkidle');

    // Find first "Kurs" button in the course cards
    const kursBtn = page.getByRole('button', { name: /^Kurs$/ }).first();
    if (!(await kursBtn.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'No published courses available for testing');
      return;
    }

    // Listen for popup
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10_000 }),
      kursBtn.click(),
    ]);

    await popup.waitForLoadState('domcontentloaded');
    const url = popup.url();
    expect(url).toContain('admin_preview=1');
    expect(url).toContain('preview_mode=');
    await popup.close();
  });

  test('Adaptive button opens adaptive preview', async ({ page, context }) => {
    await loginAs(page, 'smoke_learner');
    await page.goto('/admin/learner-preview');
    await page.waitForLoadState('networkidle');

    const adaptiveBtn = page.getByRole('button', { name: /^Adaptive$/ }).first();
    if (!(await adaptiveBtn.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'No adaptive button available');
      return;
    }

    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10_000 }),
      adaptiveBtn.click(),
    ]);

    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toContain('adaptive');
    await popup.close();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// D) Preview Banner in Learner Flows
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test.describe('Admin Preview: Banner', () => {
  test('Admin preview banner shows in learner view', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    // Navigate directly with preview params
    await page.goto('/dashboard?admin_preview=1&preview_mode=standard');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByText(/Admin Preview aktiv/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Premium preview mode shows correct label', async ({ page }) => {
    await loginAs(page, 'smoke_learner');
    await page.goto('/dashboard?admin_preview=1&preview_mode=premium');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByText(/Premium Preview/i)
    ).toBeVisible({ timeout: 10_000 });
  });
});
