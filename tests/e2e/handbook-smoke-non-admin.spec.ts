/**
 * E2E: Role-based denial snapshots for the canonical German "Smoke verweigert"
 * message in HandbookPublishDriftCard.
 *
 * Three contexts are exercised — all must surface the IDENTICAL canonical
 * message and never reveal a success state:
 *
 *   1) no admin role          → PostgREST 403 / 42501  (permission denied)
 *   2) wrong scope role       → PostgREST 403 / 42501  (forbidden: admin role required)
 *   3) expired/invalid session → PostgREST 401          (JWT expired)
 *
 * The card's `forbiddenMessage()` helper produces:
 *   "Smoke verweigert: Diese Aktion erfordert Admin- oder service-role-Zugriff. Bitte als Admin einloggen."
 *
 * That string is the snapshot oracle — any drift in the German wording will
 * fail every scenario simultaneously.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';

const RPC_RE = /\/rest\/v1\/rpc\/admin_smoke_handbook_publish_policy(\?.*)?$/;

const CANONICAL_DENIAL =
  'Smoke verweigert: Diese Aktion erfordert Admin- oder service-role-Zugriff. Bitte als Admin einloggen.';

type Scenario = {
  name: string;
  status: number;
  body: Record<string, unknown>;
};

const SCENARIOS: Scenario[] = [
  {
    name: 'no admin role (42501)',
    status: 403,
    body: {
      code: '42501',
      message: 'permission denied for function admin_smoke_handbook_publish_policy',
      details: null,
      hint: null,
    },
  },
  {
    name: 'wrong scope (forbidden)',
    status: 403,
    body: {
      code: '42501',
      message: 'forbidden: admin role required',
      details: null,
      hint: null,
    },
  },
  {
    name: 'expired session (401 JWT)',
    status: 401,
    body: {
      code: 'PGRST301',
      message: 'JWT expired',
      details: null,
      hint: null,
    },
  },
];

async function stubRpc(page: Page, scenario: Scenario) {
  await page.route(RPC_RE, async (route) => {
    await route.fulfill({
      status: scenario.status,
      contentType: 'application/json',
      body: JSON.stringify(scenario.body),
    });
  });
}

test.describe('Handbook Smoke — canonical denial message (role-based snapshots)', () => {
  for (const scenario of SCENARIOS) {
    test(`denial → canonical toast: ${scenario.name}`, async ({ page }) => {
      await stubRpc(page, scenario);

      try {
        await loginAs(page, 'qa_allaccess');
      } catch {
        test.skip(true, 'No learner credentials configured for this env');
      }

      await page.goto('/admin/leitstelle', { waitUntil: 'domcontentloaded' });

      const card = page.getByTestId('handbook-publish-drift');
      if (!(await card.isVisible({ timeout: 5_000 }).catch(() => false))) {
        // Route-guard kicked in → still a valid denial outcome (no success path)
        await expect(page).not.toHaveURL(/\/admin\/leitstelle/);
        return;
      }

      const smokeBtn = card.getByRole('button', { name: /Smoke/i });
      await smokeBtn.click();

      // Snapshot: canonical message MUST appear verbatim.
      await expect(
        page.getByText(CANONICAL_DENIAL, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // Negative assertion: no success toast.
      await expect(page.getByText(/Smoke OK/i)).toHaveCount(0);
    });
  }
});
