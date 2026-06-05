/**
 * P0 UX-Blocker Criteria — SSOT.
 *
 * Ein P0-UX-Blocker liegt vor, wenn ein Learner eine Kernaufgabe nicht
 * ausführen kann. Kanonisches Beispiel: globaler MFA/TOTP-Hard-Gate, der die
 * gesamte AppShell blockiert, sodass jeder Navigationsklick weiterhin nur
 * "Sicherheit / TOTP-Einrichtung erforderlich" zeigt.
 *
 * Security darf existieren, aber NUR seiten- oder action-bezogen.
 * Ein globales Hard-Gate über alle Learner-Routen ist IMMER P0.
 */
import type { Page } from '@playwright/test';

export const SECURITY_BLOCKER_PATTERNS: RegExp[] = [
  /Zwei-Faktor-Authentifizierung|2FA|TOTP|Authenticator/i,
  /TOTP-Einrichtung erforderlich/i,
  /AAL:\s*aal1/i,
  /enrolled:\s*nein/i,
  /Keine Faktoren registriert/i,
  /Authenticator hinzufügen/i,
];

/** Erwartete fachliche Signale auf einer Learner-Kernseite. */
export const CONTENT_SIGNAL_PATTERNS: RegExp[] = [
  /dashboard/i,
  /kurs|kurse|lerneinheit|lernen|lesson|modul/i,
  /minicheck/i,
  /tutor/i,
  /prüfung|simulation|exam/i,
  /frage|aufgabe|training/i,
  /fortschritt|wiedervorlage|frist|heute|cockpit/i,
];

/**
 * True wenn der Text wie der globale TOTP/Security-Hard-Gate aussieht.
 * Wir verlangen ≥2 unabhängige Treffer, damit ein einzelnes Wort
 * (z. B. "Sicherheit" im Footer) nicht falsch positiv triggert.
 */
export function detectGlobalTotpBlocker(text: string): boolean {
  if (!text) return false;
  const hits = SECURITY_BLOCKER_PATTERNS.filter((p) => p.test(text)).length;
  return hits >= 2;
}

export function hasBusinessContent(text: string): boolean {
  if (!text) return false;
  return CONTENT_SIGNAL_PATTERNS.some((p) => p.test(text));
}

export function normalize(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function readBody(page: Page): Promise<string> {
  return (await page.locator('body').innerText().catch(() => '')) || '';
}

/** Klassifikation eines Befunds — exposed for documentation/tests. */
export function isP0UxBlocker(reason: {
  globalSecurityBlocker?: boolean;
  contentUnchangedAfterClick?: boolean;
  noBusinessContent?: boolean;
  whiteScreen?: boolean;
}): boolean {
  return !!(
    reason.globalSecurityBlocker ||
    reason.contentUnchangedAfterClick ||
    reason.whiteScreen ||
    reason.noBusinessContent
  );
}
