/**
 * Authority-Href SSOT — single resolver for canonical links AND CTA targets.
 *
 * P0.1 Domain-Drift-Fix (2026-06-05, second pass):
 *   Vorheriger Versuch hat CTAs im Gate-Lauf auf `https://berufos.com`
 *   absolutisiert. Folge: ein Reality-Gate gegen einen Preview-Host
 *   (z. B. `examfitde.lovable.app`) hat CTAs erzeugt, die mid-journey
 *   auf berufos.com wegspringen → der Funnel-Test misst dann zwei
 *   verschiedene Systeme und das Ergebnis ist unbrauchbar.
 *
 *   Entscheidung: CTAs bleiben IMMER relativ. Der Host, gegen den der
 *   Gate läuft (oder den der User gerade browst), entscheidet — nicht ein
 *   Build-Flag. Canonical-Links via `resolveCanonicalUrl` bleiben absolut
 *   auf der SEO-Authority — das ist ein anderer Concern (SEO ≠ CTA).
 *
 * Konsumiert von:
 *   - SafeCta (`src/components/cta/SafeCta.tsx`) — Internal-Link-Targets
 *   - SEOHead canonical (alle Pages) via `resolveCanonicalUrl`
 *   - PathAwareLoadingFallback (Pre-Hydration-Shell-Anchors — bereits relativ)
 *   - index.html inline Pre-Hydration-Skript (canonical only)
 */

/**
 * SSOT: Authority-Force ist deaktiviert. CTAs MÜSSEN relativ bleiben,
 * damit Reality-Gate keine Cross-Origin-Drift produziert.
 *
 * Funktion bleibt exportiert, damit Bestands-Imports nicht brechen,
 * gibt aber konstant `false` zurück. NICHT reaktivieren ohne den
 * Reality-Gate-Domain-Contract neu zu verhandeln.
 */
export function isAuthorityForceActive(): boolean {
  return false;
}

/**
 * Normalisiert ein internes Ziel auf einen führenden Slash. Externe URLs
 * (http/https/mailto/tel) und Hash-Links passieren unverändert durch.
 *
 * Gibt NIE eine absolute https://berufos.com-URL zurück — das war der alte
 * Drift-Vektor (siehe Header). Wer wirklich einen kanonischen, absoluten
 * Link braucht (SEO `<link rel="canonical">`, Sitemap, structured data),
 * nutzt `resolveCanonicalUrl`.
 */
export function resolveAuthorityHref(target: string | undefined | null): string {
  if (!target) return '/';
  const t = String(target).trim();
  if (!t) return '/';
  if (/^(https?:|mailto:|tel:)/i.test(t)) return t;
  if (t.startsWith('#')) return t;
  return t.startsWith('/') ? t : `/${t}`;
}

/**
 * Canonical-URL Resolver — IMMER absolut auf der SEO-Authority.
 * Re-export aus authorityHost für Konsumenten, die explizit einen
 * kanonischen Link brauchen (NICHT für CTA-Targets verwenden).
 */
export { buildCanonicalUrl as resolveCanonicalUrl } from './authorityHost';
