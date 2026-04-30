import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Pattern für Routen, die NIE im Index landen dürfen.
 * - Auth/Account/Checkout/Dashboard sind privat oder nutzerspezifisch.
 * - robots.txt blockt klassische Crawler; dieser Hook setzt zusätzlich
 *   meta name="robots" content="noindex, nofollow" für JS-fähige Crawler
 *   (Google, Bing, Perplexity-mit-JS).
 *
 * Hosting-Hinweis: X-Robots-Tag in public/_headers liefert nur dort, wo
 * Hosting `_headers` respektiert (Vercel/Netlify/CF Pages — nicht Lovable).
 */
const NOINDEX_PATTERNS: RegExp[] = [
  /^\/auth(\/|$)/,
  /^\/dashboard(\/|$)/,
  /^\/account(\/|$)/,
  /^\/checkout(\/|$)/,
  /^\/purchase-success(\/|$)/,
  /^\/success(\/|$)/,
  /^\/org\//,
  /^\/partner(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/admin-v2(\/|$)/,
  /^\/exam-trainer(\/|$)/,
  /^\/oral-exam(\/|$)/,
  /^\/exam-simulation(\/|$)/,
  /^\/exam-results(\/|$)/,
  /^\/lesson(\/|$)/,
  /^\/spaced-repetition(\/|$)/,
  /^\/drill(\/|$)/,
  /^\/shuttle(\/|$)/,
  /^\/work\/buy(\/|$)/,
  /^\/work\/bundles(\/|$)/,
  /^\/work\/success(\/|$)/,
];

export function isNoindexPath(pathname: string): boolean {
  return NOINDEX_PATTERNS.some((re) => re.test(pathname));
}

/**
 * Mountet auf jeder Route. Wenn der Pfad geschützt ist:
 * - setzt meta robots = noindex, nofollow
 * - entfernt potentiell drift-anfälligen Canonical (würde auf / zeigen)
 * Sonst: stellt index, follow wieder her (Default aus index.html).
 */
export function RouteNoindex() {
  const { pathname } = useLocation();

  useEffect(() => {
    const noindex = isNoindexPath(pathname);

    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }

    if (noindex) {
      meta.setAttribute(
        'content',
        'noindex, nofollow, noarchive, nosnippet'
      );
      // Canonical entfernen, damit Google nicht /dashboard → / dedupliziert
      // und versehentlich / als Duplicate aus dem Index drückt.
      const canon = document.querySelector('link[rel="canonical"]');
      if (canon) canon.remove();
      const hreflangs = document.querySelectorAll('link[rel="alternate"][hreflang]');
      hreflangs.forEach((el) => el.remove());
    } else {
      meta.setAttribute(
        'content',
        'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
      );
    }
  }, [pathname]);

  return null;
}
