/**
 * UX.GAP.SCAN — Pre-Purchase Funnel (Discovery → Account → Purchase)
 * ────────────────────────────────────────────────────────────────────
 * Implements the 4 hard UX.GAP conditions from
 * `mem://constraints/architecture-invariants-8-rules-v1#7-uxgapscan`:
 *
 *   C1  "manuell suchen"     — kein direkt klickbarer nächster Schritt
 *   C2  "woanders hingehen"  — User muss den natürlichen Fluss verlassen
 *   C3  "Daten erneut eingeben" — Intent/Kontext geht über Auth-Sprung verloren
 *   C4  "keine Folgeaktion"  — Terminal-Screen ohne sichtbaren next-step
 *
 * SSOT integration (DUPLICATION.GUARD-konform, ZERO new infra):
 *   findings → reality-results/findings/ux-gap-prepurchase-*.json
 *           → scripts/ux-gap-scan.mjs picks up (status='fail'|severity='P0')
 *           → ux-gap-bridge Edge Fn
 *           → admin_p18_record_detection RPC (drift_type='ux_gap')
 *           → P18UxGapDetailPanel @ /admin/governance/architecture (UX-Gap tab)
 *
 * Scope: Pre-Purchase (Specs 01-03 area). Post-Purchase journey covered later
 * by a separate scan in BRIDGE.REQUIRED audit (Schritt 4).
 *
 * Read-only — never clicks "Kaufen", never submits forms. Surface checks only.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { dismissCookies } from './_pre-helpers';

const FINDINGS_DIR = path.resolve(process.cwd(), 'reality-results', 'findings');

type Cond = 'manuell_suchen' | 'woanders_hingehen' | 'daten_neu_eingeben' | 'keine_folgeaktion';
type Sev = 'P0' | 'P1' | 'P2';

interface UxGapEmission {
  step: 'discovery' | 'account' | 'purchase';
  cond: Cond;
  surface: string;           // route
  severity: Sev;
  detail: string;
  recommended_action: string;
}

function emit(e: UxGapEmission) {
  fs.mkdirSync(FINDINGS_DIR, { recursive: true });
  const id = `PRE_PURCHASE_${e.step.toUpperCase()}_${e.cond.toUpperCase()}`;
  const file = path.join(
    FINDINGS_DIR,
    `ux-gap-prepurchase-${e.step}-${e.cond}-${Date.now()}.json`,
  );
  // Shape matches scripts/ux-gap-scan.mjs scanReality() parser exactly.
  fs.writeFileSync(file, JSON.stringify({
    id,
    surface: e.surface,
    severity: e.severity,
    status: e.severity === 'P0' ? 'fail' : 'observed',
    detail: e.detail,
    recommended_action: e.recommended_action,
    matched_systems: [`pre-purchase:${e.step}`, e.surface],
    source: 'pre-customer-reality',
    detected_at: new Date().toISOString(),
    journey: 'pre_purchase_funnel',
  }, null, 2));
}

test.describe('UX.GAP.SCAN — Pre-Purchase Funnel', () => {
  test.describe.configure({ mode: 'serial' });

  test('Discovery — homepage MUST surface a direct course/purchase entry (C1+C2)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    // C1 manuell_suchen: at least ONE href that lands on a course/purchase surface
    const directEntries = await page
      .locator('a[href*="/berufe/"], a[href*="/kurs/"], a[href*="/course/"], a[href*="/preise"], a[href*="/checkout"]')
      .count();
    if (directEntries === 0) {
      emit({
        step: 'discovery', cond: 'manuell_suchen', surface: '/', severity: 'P0',
        detail: 'Homepage rendert keinen direkten Link zu Beruf/Kurs/Preis/Checkout. User muss manuell die Navigation durchsuchen.',
        recommended_action: 'Mindestens 1 Hero/ATF-CTA mit href auf /berufe/<slug> oder /preise. Idealerweise persona-gefilterte Liste.',
      });
    }

    // C2 woanders_hingehen: primary hero CTA should exist and not lead off-funnel
    const heroCta = page.getByRole('link', { name: /prüfung|kurs|jetzt starten|preise|kaufen/i }).first();
    const heroVisible = await heroCta.isVisible().catch(() => false);
    if (!heroVisible) {
      emit({
        step: 'discovery', cond: 'woanders_hingehen', surface: '/', severity: 'P1',
        detail: 'Kein sichtbarer Hero-CTA mit Funnel-Kontext-Vokabular gefunden — User muss raten oder die Marke verlassen.',
        recommended_action: 'Hero-CTA mit Funnel-Vokabular ("Prüfung starten" / "Kurs ansehen" / "Preise") direkt ATF platzieren.',
      });
    }
    expect(true).toBeTruthy(); // probes only — never hard-fail the run
  });

  test('Discovery — /berufe MUST be scannable without typing (C1)', async ({ page }) => {
    await page.goto('/berufe');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const visibleBerufLinks = await page
      .locator('a[href*="/berufe/"], a[href*="/beruf/"]')
      .count();
    if (visibleBerufLinks < 3) {
      emit({
        step: 'discovery', cond: 'manuell_suchen', surface: '/berufe', severity: 'P0',
        detail: `/berufe rendert nur ${visibleBerufLinks} klickbare Beruf-Karten — user muss Suchfeld bedienen statt scannen.`,
        recommended_action: 'Mindestens 6 Top-Berufe als statisch klickbare Karten ATF rendern (kein search-only).',
      });
    }
    expect(true).toBeTruthy();
  });

  test('Account — /auth MUST preserve redirect/intent (C3) and offer next-step (C4)', async ({ page }) => {
    // Simulate a user who clicked "kaufen" on a course and got bounced to auth
    await page.goto('/auth?redirect=%2Fpreise');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const html = await page.content();

    // C3 daten_neu_eingeben: redirect/from param must be honored (server- or client-side)
    // We check that the form action OR a hidden field OR the current URL still carries the redirect.
    const hasRedirectCtx =
      page.url().includes('redirect=') ||
      /name=["'](redirect|next|from|returnTo)["']/i.test(html) ||
      /href=["'][^"']*redirect=/i.test(html);
    if (!hasRedirectCtx) {
      emit({
        step: 'account', cond: 'daten_neu_eingeben', surface: '/auth', severity: 'P0',
        detail: '/auth?redirect=… verliert den redirect-Kontext im DOM. Post-Login wird User nicht zum ursprünglichen Ziel zurückgeführt → muss Kurs erneut suchen.',
        recommended_action: 'redirect-Param in URL halten ODER als hidden input ins Form ODER über sessionStorage persistieren; nach Login useNavigate(redirect) ausführen.',
      });
    }

    // C4 keine_folgeaktion: Auth-Screen MUST surface a next-step affordance
    // (Google/SSO button OR submit button OR "weiter" wording)
    const hasNextStep =
      (await page.locator('button[type="submit"], a[href*="google"], button:has-text("Anmelden"), button:has-text("Registrieren")').count()) > 0;
    if (!hasNextStep) {
      emit({
        step: 'account', cond: 'keine_folgeaktion', surface: '/auth', severity: 'P0',
        detail: '/auth rendert weder submit-Button noch SSO-Provider — User strandet ohne erkennbaren next-step.',
        recommended_action: 'Submit-Button + Google-SSO + Magic-Link-Option alle three immer sichtbar rendern.',
      });
    }
    expect(true).toBeTruthy();
  });

  test('Purchase — /preise MUST expose a clickable buy-CTA, not just info (C4)', async ({ page }) => {
    await page.goto('/preise');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    // C4 keine_folgeaktion: at least one CTA-like clickable that progresses the funnel
    const buyCta = page
      .locator('button, a')
      .filter({ hasText: /kaufen|jetzt|starten|freischalten|abonnieren|weiter/i });
    const count = await buyCta.count();
    if (count === 0) {
      emit({
        step: 'purchase', cond: 'keine_folgeaktion', surface: '/preise', severity: 'P0',
        detail: '/preise rendert keinen Kauf-CTA — User sieht Preise aber hat keinen Folgeschritt im Funnel.',
        recommended_action: 'Pro Plan mindestens 1 Primary-CTA „Jetzt starten" / „Kaufen" mit href zu Stripe/Checkout-Surface.',
      });
    }

    // C2 woanders_hingehen: buy-CTA must lead into checkout/Stripe, not back to discovery
    if (count > 0) {
      const firstHref = await buyCta.first().getAttribute('href').catch(() => null);
      if (firstHref && /\/(berufe|kurs|course|$)/.test(firstHref) && !/checkout|stripe|preise/.test(firstHref)) {
        emit({
          step: 'purchase', cond: 'woanders_hingehen', surface: '/preise', severity: 'P1',
          detail: `Primary-CTA auf /preise verweist auf "${firstHref}" — führt zurück in Discovery statt vorwärts in Checkout.`,
          recommended_action: 'Buy-CTA muss auf /checkout, Stripe-Session oder einen authenticated-only Aktivierungsschritt führen.',
        });
      }
    }
    expect(true).toBeTruthy();
  });
});
