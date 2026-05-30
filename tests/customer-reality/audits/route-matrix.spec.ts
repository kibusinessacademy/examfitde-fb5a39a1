/**
 * Route Matrix Audit.
 * Liste statischer Pflicht-Routen + Status, Rendered-Marker, Console-Errors.
 * Output: reality-results/route-matrix.json
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  ensureReportDir,
  REPORT_DIR,
  recordFinding,
  isWhiteScreen,
  isSpinnerLoop,
  attachConsoleSink,
  loginOrSkip,
} from '../_helpers';

interface RouteRow {
  route: string;
  role: 'public' | 'authenticated';
  http_status: number;
  rendered: boolean;
  white_screen: boolean;
  spinner_loop: boolean;
  console_errors: number;
  ok: boolean;
}

const PUBLIC_ROUTES = ['/', '/preise', '/berufe', '/unternehmen', '/komplettpaket', '/shop', '/impressum', '/datenschutz', '/agb'];
const AUTH_ROUTES = ['/dashboard', '/profil', '/app/benachrichtigungen'];

async function probe(page: any, route: string, role: 'public' | 'authenticated'): Promise<RouteRow> {
  const sink = attachConsoleSink(page);
  const res = await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => null);
  const http_status = res?.status() ?? 0;
  await page.waitForTimeout(500);

  const white = await isWhiteScreen(page);
  const spinner = await isSpinnerLoop(page, 4000);
  const rendered = !!res && http_status < 400 && !white && !spinner;
  const ok = rendered && sink.errors.length === 0;

  if (http_status >= 400) {
    recordFinding({
      severity: 'P0',
      kind: 'http_error',
      journey: 'D',
      route,
      detail: `HTTP ${http_status}`,
      fix: 'Route reparieren oder aus Navigation entfernen.',
    });
  } else if (white) {
    recordFinding({ severity: 'P0', kind: 'white_screen', journey: 'D', route, detail: 'Leere Seite.' });
  } else if (spinner) {
    recordFinding({ severity: 'P0', kind: 'spinner_loop', journey: 'D', route, detail: 'Endlosspinner.' });
  }

  return {
    route,
    role,
    http_status,
    rendered,
    white_screen: white,
    spinner_loop: spinner,
    console_errors: sink.errors.length,
    ok,
  };
}

test('Route Matrix Audit', async ({ page }) => {
  ensureReportDir();
  const rows: RouteRow[] = [];

  for (const route of PUBLIC_ROUTES) rows.push(await probe(page, route, 'public'));

  if (process.env.REALITY_PM_EMAIL && process.env.REALITY_PM_PASSWORD) {
    try {
      await loginOrSkip(page, 'pm');
      for (const route of AUTH_ROUTES) rows.push(await probe(page, route, 'authenticated'));
    } catch {
      // login_failed wurde bereits aufgezeichnet
    }
  }

  fs.writeFileSync(
    path.join(REPORT_DIR, 'route-matrix.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2),
  );
});
