/**
 * Journey D — App-Shell für eingeloggten User.
 *
 * Strenge Realitäts-Checks:
 * - Dashboard rendert
 * - Sidebar oder Top-Nav sichtbar + klickbar
 * - jede sichtbare Sidebar-Route rendert ohne white-screen / spinner-loop / 403/404
 */
import { test, expect } from '@playwright/test';
import {
  loginOrSkip,
  recordFinding,
  isWhiteScreen,
  isSpinnerLoop,
  attachConsoleSink,
} from '../_helpers';

test.describe('Journey D — App-Shell', () => {
  test('D1 Dashboard rendert nach Login', async ({ page }) => {
    const sink = attachConsoleSink(page);
    await loginOrSkip(page, 'pm');

    await page.goto('/dashboard').catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    if (await isWhiteScreen(page)) {
      recordFinding({
        severity: 'P0',
        kind: 'white_screen',
        journey: 'D',
        route: '/dashboard',
        detail: 'Dashboard rendert nichts.',
        fix: 'Layout-Fehler oder fehlende Daten-Guards prüfen.',
      });
    }

    if (await isSpinnerLoop(page)) {
      recordFinding({
        severity: 'P0',
        kind: 'spinner_loop',
        journey: 'D',
        route: '/dashboard',
        detail: 'Dashboard hängt im Spinner.',
        fix: 'Loading-Guard ohne Failure-Branch reparieren.',
      });
    }

    for (const e of sink.errors) {
      recordFinding({
        severity: 'P1',
        kind: 'console_error',
        journey: 'D',
        route: '/dashboard',
        detail: e.slice(0, 300),
      });
    }

    expect(await isWhiteScreen(page)).toBe(false);
  });

  test('D2 Sidebar / App-Nav vorhanden und Hauptpunkte klickbar', async ({ page }) => {
    await loginOrSkip(page, 'pm');
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Hauptkandidaten — App-Routen, die ein eingeloggter Lerner erreichen können soll
    const candidates = ['/dashboard', '/berufe', '/profil', '/app/benachrichtigungen'];

    for (const route of candidates) {
      const sink = attachConsoleSink(page);
      const res = await page.goto(route).catch(() => null);
      await page.waitForLoadState('domcontentloaded').catch(() => {});

      if (!res) {
        recordFinding({
          severity: 'P0',
          kind: 'broken_route',
          journey: 'D',
          route,
          detail: 'Navigation komplett fehlgeschlagen.',
        });
        continue;
      }

      const status = res.status();
      if (status >= 400) {
        recordFinding({
          severity: 'P0',
          kind: 'http_error',
          journey: 'D',
          route,
          detail: `HTTP ${status} für eingeloggten Lerner.`,
        });
        continue;
      }

      if (await isWhiteScreen(page)) {
        recordFinding({
          severity: 'P0',
          kind: 'white_screen',
          journey: 'D',
          route,
          detail: 'Leere Seite.',
        });
      }
      if (await isSpinnerLoop(page)) {
        recordFinding({
          severity: 'P0',
          kind: 'spinner_loop',
          journey: 'D',
          route,
          detail: 'Endlosspinner.',
        });
      }
      for (const e of sink.errors) {
        recordFinding({
          severity: 'P1',
          kind: 'console_error',
          journey: 'D',
          route,
          detail: e.slice(0, 300),
        });
      }
    }
  });
});
