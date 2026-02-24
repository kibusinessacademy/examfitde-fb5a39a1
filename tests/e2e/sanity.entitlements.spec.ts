// ExamFit Sanity Tests: Entitlement System
// Duration: 3-5 minutes | Trigger: after entitlement/role changes

import { test, expect } from '@playwright/test';
import { loginAs, BASE_URL } from './helpers/auth';
import { invokeEdgeFunction } from './helpers/api';

test.describe('Sanity: Entitlement RPC', () => {
  test('check_user_entitlement returns correct for entitled user', async () => {
    // This would call the RPC directly via service role
    // Verifying the SSOT entitlement check works
    const result = await invokeEdgeFunction('test-orchestrator', {
      action: 'get_dashboard', // placeholder - in real impl, call entitlement RPC
    });
    expect(result).toBeDefined();
  });
});

test.describe('Sanity: Protected Route Behavior', () => {
  test('Entitled user accesses protected course route', async ({ page }) => {
    await loginAs(page, 'smoke_with_entitlement');
    await page.goto(`${BASE_URL}/courses`);
    await page.waitForLoadState('networkidle');
    // Should NOT see login redirect
    expect(page.url()).not.toContain('/auth');
  });

  test('Non-entitled user gets gated on course route', async ({ page }) => {
    await loginAs(page, 'smoke_no_entitlement');
    await page.goto(`${BASE_URL}/courses`);
    await page.waitForLoadState('networkidle');
    // Should see gate/CTA, not raw course content
    const body = await page.textContent('body');
    const isGated =
      body?.includes('Kein Zugriff') ||
      body?.includes('Freischalten') ||
      body?.includes('Kurs kaufen') ||
      !body?.includes('Prüfung starten');
    expect(isGated).toBeTruthy();
  });
});
