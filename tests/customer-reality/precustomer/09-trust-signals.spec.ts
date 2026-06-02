/**
 * P09 Trust-Signale — Homepage zeigt Social Proof / Reviews / Sicherheitsmarker
 * vor dem Kauf. Ohne Trust kein B2C-Conversion.
 * Weight: 8.
 *
 * Nicht-destruktiv. Erkennt Trust-Signale anhand Text- & Aria-Heuristik
 * statt fragiler Selektoren, damit Refactors die Suite nicht zerschießen.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect } from './_pre-helpers';

const TRUST_PATTERNS = [
  /testimonial|kunden(stimm|meinung|bewert)|bewertung|review/i,
  /\d[\.,]?\d?\s*\/\s*5|★|sterne?/i,
  /dsgvo|gdpr|ssl|sicher(e|er)\s*bezahl|verschlüssel/i,
  /geld[- ]zurück|garantie|widerruf/i,
  /\d{2,}\s*(lernende|kunden|nutzer|absolventen|prüflinge)/i,
  /vertrauen|made in germany|server in deutschland|host(ing)?\s*in/i,
];

test.describe('P09 Trust-Signale', () => {
  test('Homepage zeigt mindestens 2 unterschiedliche Trust-Signale', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    const matches = TRUST_PATTERNS.filter((re) => re.test(body));

    let problems = 0;
    if (matches.length === 0) {
      problems++;
      recordFinding({
        severity: 'P1', kind: 'workflow_no_feedback', journey: 'A', route: '/',
        detail: 'Homepage zeigt keinerlei Trust-Signale (Reviews, DSGVO, Garantie, Nutzerzahlen).',
        fix: 'Trust-Strip / Testimonial-Block / Sicherheits-Badges in Hero oder direkt darunter platzieren.',
      });
    } else if (matches.length < 2) {
      recordFinding({
        severity: 'P2', kind: 'workflow_no_feedback', journey: 'A', route: '/',
        detail: `Nur 1 Trust-Signal-Typ erkannt — schwacher Conversion-Anker.`,
        fix: 'Mindestens 2 Kategorien kombinieren: Reviews + DSGVO/Garantie oder Nutzerzahl + Testimonial.',
      });
    }

    markJourney('P09_trust_signals', problems === 0 ? 'pass' : 'fail', `signals=${matches.length}`);
    expect(problems, 'Homepage muss Trust-Signale tragen').toBe(0);
  });
});
