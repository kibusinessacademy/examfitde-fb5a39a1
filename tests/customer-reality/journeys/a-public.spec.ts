/**
 * Journey A — Public Landingpage
 *
 * Pflicht-Signale für einen Erstbesucher:
 * - Homepage lädt überhaupt
 * - Zielgruppe / Nutzen wird genannt (mind. ein erkennbarer Marker-Begriff)
 * - Haupt-CTA sichtbar + klickbar + führt irgendwohin (kein „toter" CTA)
 * - Impressum + Datenschutz erreichbar
 */
import { test, expect } from '@playwright/test';
import { attachConsoleSink, isWhiteScreen, recordFinding } from '../_helpers';

test.describe('Journey A — Public Landingpage', () => {
  test('A1 Homepage lädt und zeigt verständliche Zielgruppe', async ({ page }) => {
    const sink = attachConsoleSink(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    if (await isWhiteScreen(page)) {
      recordFinding({
        severity: 'P0',
        kind: 'white_screen',
        journey: 'A',
        route: '/',
        detail: 'Homepage rendert keinen sichtbaren Inhalt.',
        fix: 'Build / Hosting prüfen.',
      });
      throw new Error('Homepage white screen');
    }

    const body = (await page.locator('body').innerText()).toLowerCase();
    const targetMarkers = ['prüfung', 'azubi', 'ihk', 'beruf', 'lernen'];
    const hit = targetMarkers.some((m) => body.includes(m));
    if (!hit) {
      recordFinding({
        severity: 'P1',
        kind: 'placeholder_end_state',
        journey: 'A',
        route: '/',
        detail: 'Keiner der Zielgruppen-Marker (Prüfung/Azubi/IHK/Beruf/Lernen) in der Homepage gefunden.',
        fix: 'Hero-Headline mit klarer Zielgruppen-Ansprache versehen.',
      });
    }

    for (const e of sink.errors) {
      recordFinding({
        severity: 'P1',
        kind: 'console_error',
        journey: 'A',
        route: '/',
        detail: e.slice(0, 300),
        fix: 'Console-Error fixen oder als bekannt deklarieren.',
      });
    }

    expect(hit, 'Homepage muss Zielgruppe ansprechen').toBe(true);
  });

  test('A2 Haupt-CTA sichtbar und führt zu echter Folge-Route', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Cookie-Banner annehmen, falls vorhanden (sonst blockt er CTAs)
    const accept = page.getByRole('button', { name: /akzeptieren|accept/i }).first();
    if (await accept.isVisible().catch(() => false)) await accept.click().catch(() => {});

    const cta = page
      .getByRole('link', { name: /starten|jetzt|testen|prüfung|loslegen/i })
      .or(page.getByRole('button', { name: /starten|jetzt|testen|prüfung|loslegen/i }))
      .first();

    if (!(await cta.isVisible().catch(() => false))) {
      recordFinding({
        severity: 'P0',
        kind: 'dead_cta',
        journey: 'A',
        route: '/',
        detail: 'Kein primärer CTA im sichtbaren Bereich gefunden.',
        fix: 'Primary-CTA im Hero sicherstellen.',
      });
      throw new Error('No primary CTA visible');
    }

    const before = page.url();
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      cta.click().catch(() => {}),
    ]);
    await page.waitForTimeout(1500);
    const after = page.url();

    const moved = after !== before;
    const dialog = await page
      .locator('[role="dialog"], [data-state="open"]')
      .first()
      .isVisible()
      .catch(() => false);

    if (!moved && !dialog) {
      recordFinding({
        severity: 'P0',
        kind: 'dead_cta',
        journey: 'A',
        route: '/',
        detail: 'Primary-CTA hat weder Navigation noch Dialog ausgelöst.',
        fix: 'CTA-Handler verbinden oder Element entfernen.',
      });
    }

    expect(moved || dialog, 'CTA muss Wirkung haben').toBe(true);
  });

  test('A3 Impressum + Datenschutz verlinkt und erreichbar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const targets: Array<{ name: RegExp; route: string }> = [
      { name: /impressum/i, route: 'impressum' },
      { name: /datenschutz/i, route: 'datenschutz' },
    ];

    for (const t of targets) {
      const link = page.getByRole('link', { name: t.name }).first();
      const visible = await link.isVisible().catch(() => false);
      if (!visible) {
        recordFinding({
          severity: 'P0',
          kind: 'missing_trust_page',
          journey: 'F',
          route: '/',
          detail: `Pflicht-Link "${t.route}" nicht im Footer/Page sichtbar.`,
          fix: `Footer-Link zu /${t.route} ergänzen.`,
        });
        continue;
      }
      const href = await link.getAttribute('href');
      if (!href) continue;
      const res = await page.request.get(new URL(href, page.url()).toString());
      if (!res.ok()) {
        recordFinding({
          severity: 'P0',
          kind: 'missing_trust_page',
          journey: 'F',
          route: href,
          detail: `${t.route} antwortet mit ${res.status()}.`,
          fix: 'Route reparieren oder Link korrigieren.',
        });
      }
    }
  });
});
