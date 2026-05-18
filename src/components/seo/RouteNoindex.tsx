import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  isSeoAuthorityHost,
  buildCanonicalUrl,
} from '@/lib/seo/authorityHost';

/**
 * Pattern für Routen, die NIE im Index landen dürfen (auch nicht auf examfit.de).
 * Auth/Account/Checkout/Dashboard sind privat oder nutzerspezifisch.
 * robots.txt blockt klassische Crawler; dieser Hook setzt zusätzlich
 * meta name="robots" content="noindex, nofollow" für JS-fähige Crawler
 * (Google, Bing, Perplexity-mit-JS).
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
 * Globaler SEO-Guard. Mountet auf jeder Route.
 *
 * Zwei-Achsen-Logik (SSOT mem://constraints/hosting-and-seo-authority-topology-v1):
 * 1) HOST: Wenn der Host nicht `examfit.de` / `www.examfit.de` ist
 *    → IMMER noindex + canonical → apex. Greift für lovable.app,
 *      vercel.app, id-preview--*, localhost, jede sonstige Preview-/Legacy-URL.
 * 2) PATH: Auch auf Authority-Host sind geschützte Pfade noindex.
 *
 * Canonical regelt sich strikt über buildCanonicalUrl (apex + Query-Whitelist).
 */
export function RouteNoindex() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    const authorityHost = isSeoAuthorityHost(hostname);
    const protectedPath = isNoindexPath(pathname);
    const noindex = !authorityHost || protectedPath;

    // robots meta sicherstellen
    let robots = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!robots) {
      robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      document.head.appendChild(robots);
    }

    if (noindex) {
      robots.setAttribute('content', 'noindex, nofollow, noarchive, nosnippet');
    } else {
      robots.setAttribute(
        'content',
        'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
      );
    }

    // Canonical-Handling:
    // - Auf Authority-Host + indexierbarem Pfad: canonical = buildCanonicalUrl(path)
    //   (lassen wir hier stehen, damit per-route SEOHead-Komponenten ergänzen können,
    //   aber wir setzen einen konsistenten Default).
    // - Auf protected paths (auch auf Authority-Host): canonical entfernen,
    //   damit Google /dashboard nicht zu / dedupliziert.
    // - Auf Non-Authority-Host: canonical IMMER auf apex umbiegen, damit
    //   Preview-Hosts examfit.de als Original signalisieren.
    const existingCanon = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    const hreflangs = document.querySelectorAll('link[rel="alternate"][hreflang]');

    if (protectedPath) {
      if (existingCanon) existingCanon.remove();
      hreflangs.forEach((el) => el.remove());
    } else {
      // public, indexierbarer Pfad → canonical-Sicherheitsgurt auf apex
      const desired = buildCanonicalUrl(pathname, search);
      if (existingCanon) {
        if (existingCanon.href !== desired) existingCanon.href = desired;
      } else {
        const link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        link.setAttribute('href', desired);
        document.head.appendChild(link);
      }
      // Auf Non-Authority-Host: hreflangs entfernen, sie würden auf Preview-Host zeigen
      if (!authorityHost) {
        hreflangs.forEach((el) => el.remove());
      }
    }
  }, [pathname, search]);

  return null;
}
