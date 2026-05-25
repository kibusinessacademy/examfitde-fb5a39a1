/**
 * Hostname-basierter SEO Authority Guard (Pure Helpers).
 *
 * SSOT: Nur `berufos.com` und `www.berufos.com` sind SEO-autoritative Hosts.
 * Alle anderen Hostnamen (Lovable-Preview, Vercel-Preview, localhost, Legacy
 * `examfit.de`) MÜSSEN noindex,nofollow tragen und canonical auf
 * `https://berufos.com${pathname}` setzen. examfitwork.de / berufski.de
 * existieren NICHT — keine Referenzen aufbauen.
 *
 * Hardcut: 2026-05-25 — ExamFit.de wird Legacy-Redirect-Domain. BerufOS ist die
 * einzige Plattform-Authority. Siehe mem://strategie/ssot-strategic-north-star-v1
 * + Plan-File .lovable/plan.md (P1–P4 Hardcut auf BerufOS.com).
 *
 * Diese Helpers sind bewusst pure (kein window-Zugriff) damit sie
 * unit-testbar sind. React-Layer (RouteNoindex) konsumiert sie und reicht
 * window.location.{hostname,pathname,search} rein.
 */

export const SEO_AUTHORITY_HOSTS = ['berufos.com', 'www.berufos.com'] as const;
export const SEO_CANONICAL_ORIGIN = 'https://berufos.com';

/** True wenn Host SEO-autoritativ ist (Apex oder www). */
export function isSeoAuthorityHost(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().trim();
  return (SEO_AUTHORITY_HOSTS as readonly string[]).includes(h);
}

/**
 * True wenn der Host noindex bekommen MUSS. Praktisch: alles außer
 * den 2 Authority-Hosts. Inkludiert explizit localhost, *.lovable.app,
 * *.vercel.app, id-preview--*, *.lovableproject.com, examfit.de.
 */
export function shouldNoindexHost(hostname: string): boolean {
  return !isSeoAuthorityHost(hostname);
}

/**
 * Baut den kanonischen URL für eine gegebene Route auf berufos.com.
 * Strippt Tracking-/UTM-/Session-Params konservativ. Behält nichts per Default —
 * SEO-relevante Query-Params müssen später explizit whitelisted werden.
 *
 * Hash wird immer entfernt (nie SEO-relevant für canonical).
 */
export function buildCanonicalUrl(pathname: string, search = ''): string {
  let path = pathname || '/';
  if (!path.startsWith('/')) path = '/' + path;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  const allowedParams = filterCanonicalParams(search);
  const qs = allowedParams ? `?${allowedParams}` : '';
  return `${SEO_CANONICAL_ORIGIN}${path}${qs}`;
}

const SEO_CANONICAL_ALLOWED_PARAMS = new Set<string>([
  // bewusst leer — additiv erweitern, niemals blocklist-Pattern.
]);

function filterCanonicalParams(search: string): string {
  if (!search) return '';
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return '';
  const params = new URLSearchParams(raw);
  const out = new URLSearchParams();
  for (const [k, v] of params.entries()) {
    if (SEO_CANONICAL_ALLOWED_PARAMS.has(k)) out.append(k, v);
  }
  return out.toString();
}
