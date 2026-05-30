/**
 * Button Reality Audit.
 * Geht über zentrale Public-Routen + Dashboard, listet jeden sichtbaren Button.
 * Jeder Button wird einmal geklickt; "Wirkung" = URL-Wechsel, Toast, Dialog oder DOM-Diff.
 * Resultat → reality-results/button-audit.json
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginOrSkip, ensureReportDir, REPORT_DIR, recordFinding } from '../_helpers';

interface ButtonRow {
  route: string;
  text: string;
  visible: boolean;
  effect: 'navigation' | 'toast' | 'dialog' | 'dom_change' | 'none' | 'crash';
  ok: boolean;
}

const PUBLIC_ROUTES = ['/', '/preise', '/berufe'];
const APP_ROUTES = ['/dashboard'];

async function auditButtons(page: any, route: string, rows: ButtonRow[]) {
  const res = await page.goto(route).catch(() => null);
  if (!res || !res.ok()) {
    rows.push({ route, text: '<page>', visible: false, effect: 'crash', ok: false });
    return;
  }
  await page.waitForLoadState('domcontentloaded');

  // Cookie-Banner einmal pro Route schließen
  const accept = page.getByRole('button', { name: /akzeptieren|accept/i }).first();
  if (await accept.isVisible().catch(() => false)) await accept.click().catch(() => {});

  const buttons = await page
    .locator('button:visible, a[href]:visible')
    .all();

  // Maximal 12 pro Route — Reality-Stichprobe, nicht Full-Crawl
  const sample = buttons.slice(0, 12);

  for (const b of sample) {
    let text = '';
    try {
      text = ((await b.innerText()) || '').trim().slice(0, 60);
    } catch {
      continue;
    }
    if (!text || /^(0|–|·|\s+)$/.test(text)) continue;

    const beforeUrl = page.url();
    const beforeDom = ((await page.locator('body').innerText().catch(() => '')) || '').length;

    let effect: ButtonRow['effect'] = 'none';
    try {
      await b.click({ timeout: 1500, trial: false });
      await page.waitForTimeout(700);

      if (page.url() !== beforeUrl) effect = 'navigation';
      else {
        const dialog = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
        const toast = await page.locator('[role="status"], [data-sonner-toast]').first().isVisible().catch(() => false);
        const afterDom = ((await page.locator('body').innerText().catch(() => '')) || '').length;
        if (dialog) effect = 'dialog';
        else if (toast) effect = 'toast';
        else if (Math.abs(afterDom - beforeDom) > 50) effect = 'dom_change';
      }
    } catch {
      effect = 'crash';
    }

    rows.push({ route, text, visible: true, effect, ok: effect !== 'none' && effect !== 'crash' });

    // zurück zur Route, wenn Klick navigiert hat — wir wollen weitere Buttons auf derselben Seite prüfen
    if (effect === 'navigation') {
      await page.goto(route).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    // Dialog/Sheet schließen
    if (effect === 'dialog') {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}

test('Button Reality Audit — public + app', async ({ page }) => {
  ensureReportDir();
  const rows: ButtonRow[] = [];

  for (const route of PUBLIC_ROUTES) {
    await auditButtons(page, route, rows);
  }

  // App-Routen nur wenn Login möglich
  if (process.env.REALITY_PM_EMAIL && process.env.REALITY_PM_PASSWORD) {
    try {
      await loginOrSkip(page, 'pm');
      for (const route of APP_ROUTES) {
        await auditButtons(page, route, rows);
      }
    } catch {
      // login_failed wurde bereits in C oder loginOrSkip aufgezeichnet
    }
  }

  fs.writeFileSync(
    path.join(REPORT_DIR, 'button-audit.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2),
  );

  // Tote Buttons → Findings (max 10, sonst Lärm)
  const dead = rows.filter((r) => r.visible && r.effect === 'none').slice(0, 10);
  for (const d of dead) {
    recordFinding({
      severity: 'P1',
      kind: 'dead_button',
      journey: 'AUDIT',
      route: d.route,
      detail: `Button "${d.text}" ohne erkennbare Wirkung.`,
      fix: 'Handler verkabeln, Disabled-State oder Element entfernen.',
    });
  }
});
