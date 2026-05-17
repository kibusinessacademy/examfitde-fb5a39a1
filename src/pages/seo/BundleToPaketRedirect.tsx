/**
 * BundleToPaketRedirect
 *
 * Naming-Migration: Commerce-URL `/bundle/*` → kanonisch `/paket/*`.
 * Ein Beruf = ein Komplettpaket; "Bundle" war historisches Naming.
 *
 * Static-Hosting-Hinweis (siehe Memory seo/hosting-spa-fallback-blocks-prerender-v1):
 * Auf Lovable-Hosting gibt es keine HTTP-301-Header. Wir geben Crawlern hier
 * stattdessen redundante Signale: Canonical → /paket/..., noindex auf /bundle,
 * Meta-Refresh, plus echte Client-Navigation. Auf Vercel/Cloudflare wird
 * zusätzlich `_redirects` / `vercel.json` als 301 ausgeliefert.
 */
import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { SITE_URL } from '@/lib/seo';

export default function BundleToPaketRedirect() {
  const { slug } = useParams<{ slug?: string }>();
  const target = slug ? `/paket/${slug}` : '/paket';
  const absoluteTarget = `${SITE_URL}${target}`;

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
