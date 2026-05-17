/**
 * LegacyProductRedirect
 * Komplettpaket-Strategie: Alle Legacy-Produktrouten leiten dauerhaft auf /paket/:slug um.
 *
 * SEO-Hinweis:
 *   Auf statischem SPA-Hosting (Lovable) gibt es keine HTTP-301-Header. Wir geben Crawlern
 *   stattdessen ein eindeutiges, mehrfach redundantes Signal:
 *     1. <link rel="canonical"> auf die Paket-URL.
 *     2. <meta name="robots" content="noindex, follow"> für den Legacy-Pfad.
 *     3. <meta http-equiv="refresh" ...> als Fallback für JS-lose Crawler.
 *     4. Direkte Navigation für echte Nutzer.
 *
 * Betroffene Routen:
 *  - /lernkurse/:slug         -> /paket/:slug
 *  - /pruefungstrainer/:slug  -> /paket/:slug
 *  - /lernkurse               -> /paket
 *  - /pruefungstrainer        -> /paket
 *
 * /bundle/* wird separat über BundleToPaketRedirect umgeleitet.
 */
import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { SITE_URL } from '@/lib/seo';

export default function LegacyProductRedirect() {
  const { slug } = useParams<{ slug?: string }>();
  const target = slug ? `/paket/${slug}` : '/paket';
  const absoluteTarget = `${SITE_URL}${target}`;

  // Defensive: nudge bots that ignore meta-refresh
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', target);
    }
  }, [target]);

  return (
    <>
      <Helmet>
        <link rel="canonical" href={absoluteTarget} />
        <meta name="robots" content="noindex, follow" />
        <meta httpEquiv="refresh" content={`0; url=${target}`} />
        <title>Weiterleitung zu {absoluteTarget}</title>
      </Helmet>
      <Navigate to={target} replace />
    </>
  );
}
