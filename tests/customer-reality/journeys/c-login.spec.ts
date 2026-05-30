/**
 * Journey C — Login. Pflicht für „grün".
 *
 * Ein Reality-Run ohne erfolgreichen Login darf NIE als RELEASE gewertet werden.
 * Der Aggregator wertet das Fehlen einer erfolgreichen C-Run als BLOCK.
 */
import { test, expect } from '@playwright/test';
import { loginOrSkip, recordFinding } from '../_helpers';
import fs from 'node:fs';
import path from 'node:path';

test.describe('Journey C — Login', () => {
  test('C1 Test-PM kann sich anmelden und landet außerhalb /auth', async ({ page }) => {
    await loginOrSkip(page, 'pm');

    if (page.url().includes('/auth')) {
      recordFinding({
        severity: 'P0',
        kind: 'login_failed',
        journey: 'C',
        route: '/auth',
        detail: 'Nach Submit immer noch /auth — Login ohne Redirect.',
        fix: 'Auth-Flow + Session prüfen.',
      });
    }
    expect(page.url()).not.toContain('/auth');

    // Marker schreiben, damit Aggregator die "echte Reality-Garantie" prüfen kann
    fs.mkdirSync(path.resolve('reality-results'), { recursive: true });
    fs.writeFileSync(
      path.resolve('reality-results/login-success.flag'),
      JSON.stringify({ ok: true, ts: new Date().toISOString() }),
    );
  });
});
