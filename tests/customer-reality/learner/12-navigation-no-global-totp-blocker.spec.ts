/**
 * J11 — Navigation must not be globally blocked by TOTP/Security hard-gate.
 *
 * Reality-Guard: Wir verhalten uns wie ein echter Learner. Nach Login klicken
 * wir nacheinander die wichtigsten Learner-Navigationsziele an. Bleibt der
 * fachliche Inhalt stehen oder ist es weiterhin die globale Sicherheits-/
 * TOTP-Seite → P0 BLOCK.
 *
 * Akzeptanz pro Klick:
 *  a) Kein globaler TOTP/Security-Blocker im Body.
 *  b) Body unterscheidet sich von der vorherigen Sicherheitsseite.
 *  c) Mindestens ein fachliches Signal sichtbar.
 */
import { test, expect } from '@playwright/test';
import {
  learnerLogin,
  dismissCookies,
  markJourney,
  recordFinding,
} from './_learner-helpers';
import {
  detectGlobalTotpBlocker,
  hasBusinessContent,
  normalize,
  readBody,
} from './_p0-ux-criteria';

const JOURNEY_ID = 'J11_navigation_no_totp_blocker';

const NAV_TARGETS: { label: string; pattern: RegExp; route?: string }[] = [
  { label: 'Dashboard', pattern: /^dashboard$|mein\s*dashboard/i, route: '/dashboard' },
  { label: 'Heute', pattern: /^heute$|^cockpit$/i },
  { label: 'Kurse', pattern: /kurse|meine kurse|lernen/i },
  { label: 'MiniCheck', pattern: /minicheck/i },
  { label: 'AI Tutor', pattern: /tutor/i },
  { label: 'Prüfung', pattern: /prüfung|simulation/i },
];

test('J11 — Navigation darf nicht im globalen TOTP/Security-Blocker hängen', async ({ page }) => {
  await learnerLogin(page);
  await page.goto('/dashboard');
  await page.waitForLoadState('domcontentloaded');
  await dismissCookies(page);
  await page.waitForTimeout(800);

  // Hard-Gate-Check sofort nach Dashboard-Load.
  const initialBody = await readBody(page);
  if (detectGlobalTotpBlocker(initialBody)) {
    recordFinding({
      severity: 'P0',
      kind: 'global_security_blocker',
      journey: 'F',
      route: '/dashboard',
      detail:
        'Nach Login zeigt /dashboard den globalen TOTP/Sicherheits-Blocker statt fachlicher Lerneinheit.',
      fix: 'Globales MFA/TOTP-Hard-Gate aus der AppShell entfernen; Security nur action-/seitenbezogen erzwingen.',
    });
    markJourney(JOURNEY_ID, 'fail', 'global TOTP blocker on /dashboard after login');
    throw new Error('P0 UX BLOCK: global TOTP blocker on /dashboard');
  }

  const visitedFailures: string[] = [];

  for (const target of NAV_TARGETS) {
    const before = normalize(await readBody(page));
    const beforeUrl = page.url();

    const link = page
      .getByRole('link', { name: target.pattern })
      .or(page.getByRole('button', { name: target.pattern }))
      .first();

    const visible = await link.isVisible().catch(() => false);
    if (!visible) {
      if (target.route) {
        await page.goto(target.route).catch(() => {});
      } else {
        continue; // Navigationspunkt nicht sichtbar → kein Klick-Test möglich.
      }
    } else {
      await link.click().catch(() => {});
    }

    await page.waitForTimeout(1400);

    const after = await readBody(page);
    const afterNorm = normalize(after);
    const route = page.url();

    if (detectGlobalTotpBlocker(after)) {
      recordFinding({
        severity: 'P0',
        kind: 'global_security_blocker',
        journey: 'F',
        route,
        detail: `Klick auf "${target.label}" führt nicht zu fachlicher Seite; Inhalt bleibt globaler TOTP/Sicherheits-Blocker.`,
        fix: 'Globales MFA/TOTP-Hard-Gate aus der AppShell entfernen; Security nur action-/seitenbezogen erzwingen.',
      });
      visitedFailures.push(`${target.label}→global_security_blocker`);
      continue;
    }

    if (afterNorm === before && route === beforeUrl) {
      recordFinding({
        severity: 'P0',
        kind: 'navigation_no_content_change',
        journey: 'F',
        route,
        detail: `Klick auf "${target.label}" erzeugt keine sichtbare fachliche Zustandsänderung (Inhalt + URL unverändert).`,
        fix: 'Routing/Render der Learner-AppShell prüfen — Navigationsklick muss zu neuer fachlicher Seite führen.',
      });
      visitedFailures.push(`${target.label}→no_content_change`);
      continue;
    }

    if (!hasBusinessContent(after)) {
      recordFinding({
        severity: 'P0',
        kind: 'placeholder_end_state',
        journey: 'F',
        route,
        detail: `Klick auf "${target.label}" zeigt keinen fachlichen Inhalt (kein Dashboard-/Kurs-/Tutor-/Prüfungs-Signal).`,
      });
      visitedFailures.push(`${target.label}→no_business_content`);
    }
  }

  if (visitedFailures.length > 0) {
    markJourney(JOURNEY_ID, 'fail', `nav failures: ${visitedFailures.join(', ')}`);
    throw new Error(`P0 UX BLOCK: ${visitedFailures.join(', ')}`);
  }

  markJourney(JOURNEY_ID, 'pass', 'no global TOTP/security blocker across nav targets');
  expect(visitedFailures.length).toBe(0);
});
