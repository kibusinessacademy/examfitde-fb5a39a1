/**
 * Authority-Href SSOT — single resolver for canonical links AND CTA targets.
 *
 * Reality-Gate Domain-Drift-Fix (2026-06-05):
 *   Bisher konnten CTAs als relative Pfade rendern und über den Hosting-Redirect
 *   auf eine andere Authority springen (z. B. lovable.app → berufos.com).
 *   Der Reality-Gate hat das als "berufos.com"-Finding gegen einen
 *   `examfitde.lovable.app`-Base-URL geloggt → unklare Drift.
 *
 *   Lösung: EIN Resolver für Canonical-Links UND CTA-Ziele. Im Gate-Lauf
 *   (build-time flag `VITE_FORCE_AUTHORITY_CTAS=true` ODER runtime URL-Param
 *   `?_authority=1`) werden alle internen Targets auf `https://berufos.com`
 *   absolutisiert, damit Tests garantiert auf der Authority bleiben.
 *
 *   Im normalen Browse-Mode bleibt das Verhalten relativ (SPA-freundlich).
 *
 * Konsumiert von:
 *   - SafeCta (`src/components/cta/SafeCta.tsx`) — Internal-Link-Targets
 *   - SEOHead canonical (alle Pages)
 *   - PathAwareLoadingFallback (Pre-Hydration-Shell-Anchors)
 *   - index.html inline Pre-Hydration-Skript (parallele Logik, halten!)
 */

import { SEO_CANONICAL_ORIGIN, isSeoAuthorityHost } from './authorityHost';

/** Build-time flag (Vite injection). True = Gate-Lauf, alle Targets absolut. */
const BUILD_FORCE_AUTHORITY =
  typeof import.meta !== 'undefined' &&
  // @ts-ignore — vite env shape
  import.meta.env?.VITE_FORCE_AUTHORITY_CTAS === 'true';

/**
 * Runtime check: ist Authority-Force aktiv?
 *  - Build-Flag VITE_FORCE_AUTHORITY_CTAS=true (CI/Gate-Build)
 *  - oder URL `?_authority=1` (Ad-hoc Debug-Sessions)
 *  - oder Host ist BEREITS Authority (dann kein Rewrite nötig — wir sind dort)
 */
export function isAuthorityForceActive(): boolean {
  if (BUILD_FORCE_AUTHORITY) return true;
  if (typeof window === 'undefined') return false;
  try {
    if (isSeoAuthorityHost(window.location.hostname)) return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('_authority') === '1';
  } catch {
    return false;
  }
}

/**
 * SSOT: rewrite an internal path/href to the SEO authority origin when the
 * gate/force mode is active. External URLs (http/https/mailto/tel) pass
 * through untouched. Empty/hash-only stays as-is.
 */
export function resolveAuthorityHref(target: string | undefined | null): string {
  if (!target) return '/';
  const t = String(target).trim();
  if (!t) return '/';
  if (/^(https?:|mailto:|tel:)/i.test(t)) return t;
  if (t.startsWith('#')) return t;

  // normalize to leading-slash path
  const path = t.startsWith('/') ? t : `/${t}`;

  if (isAuthorityForceActive()) {
    return `${SEO_CANONICAL_ORIGIN}${path}`;
  }
  return path;
}

/**
 * Canonical-URL Resolver — IMMER absolut auf der Authority.
 * Re-export aus authorityHost mit klarem Namen für Konsumenten, die nicht
 * wissen müssen, ob es ein Canonical oder CTA-Target ist.
 */
export { buildCanonicalUrl as resolveCanonicalUrl } from './authorityHost';
