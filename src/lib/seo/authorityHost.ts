/**
 * Hostname-basierter SEO Authority Guard (Pure Helpers).
 *
 * SSOT: Nur `examfit.de` und `www.examfit.de` sind SEO-autoritative Hosts.
 * Alle anderen Hostnamen (Lovable-Preview, Vercel-Preview, localhost, Legacy)
 * MÜSSEN noindex,nofollow tragen und canonical auf https://examfit.de${pathname}
 * setzen.
 *
 * Detail: mem://constraints/hosting-and-seo-authority-topology-v1
 *
 * Diese Helpers sind bewusst pure (kein window-Zugriff) damit sie
 * unit-testbar sind. React-Layer (RouteNoindex) konsumiert sie und reicht
 * window.location.{hostname,pathname,search} rein.
 */

export const SEO_AUTHORITY_HOSTS = ['examfit.de', 'www.examfit.de'] as const;
export const SEO_CANONICAL_ORIGIN = 'https://examfit.de';

/** True wenn Host SEO-autoritativ ist (Apex oder www). */
export function isSeoAuthorityHost(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().trim();
  return (SEO_AUTHORITY_HOSTS as readonly string[]).includes(h);
}

/**
 * True wenn der Host noindex bekommen MUSS. Praktisch: alles außer
 * den 2 Authority-Hosts. Inkludiert explizit localhost, *.lovable.app,
 * *.vercel.app, id-preview--*, *.lovableproject.com.
 */
export function shouldNoindexHost(hostname: string): boolean {
  return !isSeoAuthorityHost(hostname);
}

/**
 * Baut den kanonischen URL für eine gegebene Route.
 * Strippt Tracking-/UTM-/Session-Params konservativ. Behält nichts per Default —
 * SEO-relevante Query-Params müssen später explizit whitelisted werden.
 *
 * Hash wird immer entfernt (nie SEO-relevant für canonical).
 */
export function buildCanonicalUrl(pathname: string, search = ''): string {
  // Pathname normalisieren: leading slash sicherstellen, trailing slash
  // bei nicht-root entfernen (Apex bleibt /).
  let path = pathname || '/';
  if (!path.startsWith('/')) path = '/' + path;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  const allowedParams = filterCanonicalParams(search);
  const qs = allowedParams ? `?${allowedParams}` : '';
  return `${SEO_CANONICAL_ORIGIN}${path}${qs}`;
}

/**
 * Whitelist-Filter für Query-Params, die in canonical erhalten bleiben dürfen.
 * Default: NICHTS. UTM-, gclid-, fbclid-, ef_*-Tracking landen NIE im canonical.
 *
 * Erweiterbar via SEO_CANONICAL_ALLOWED_PARAMS, wenn echte SEO-Pagination/Filter
 * jemals nötig wird (z.B. ?page=2).
 */
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
  const s = out.toString();
  return s;
}
