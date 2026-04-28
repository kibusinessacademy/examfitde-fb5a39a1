/**
 * LegacyProductRedirect
 * Bundle-only Strategie: Alle Legacy-Produktrouten leiten dauerhaft auf /bundle/:slug um.
 *
 * SEO-Hinweis:
 *   Auf statischem SPA-Hosting (Lovable) gibt es keine HTTP-301-Header. Wir geben Crawlern
 *   stattdessen ein eindeutiges, mehrfach redundantes Signal:
 *     1. <link rel="canonical"> auf die Bundle-URL.
 *     2. <meta name="robots" content="noindex, follow"> für den Legacy-Pfad.
 *     3. <meta http-equiv="refresh" ...> als Fallback für JS-lose Crawler.
 *     4. Direkte Navigation für echte Nutzer.
 *
 * Betroffene Routen:
 *  - /lernkurse/:slug         -> /bundle/:slug
 *  - /pruefungstrainer/:slug  -> /bundle/:slug
 *  - /lernkurse               -> /bundle
 *  - /pruefungstrainer        -> /bundle
 */
import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { SITE_URL } from '@/lib/seo';

export default function LegacyProductRedirect() {
  const { slug } = useParams<{ slug?: string }>();
  const target = slug ? `/bundle/${slug}` : '/bundle';
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
