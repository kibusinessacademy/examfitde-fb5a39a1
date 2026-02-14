import { useLocation, useParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

const QualityScorePage = lazy(() => import('@/pages/seo/QualityScorePage'));
const CertificationSEOPage = lazy(() => import('@/pages/seo/CertificationSEOPage'));

const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

/** Known programmatic SEO suffixes that this dispatcher handles */
const SEO_SUFFIXES = [
  '-pruefung',
  '-durchfallquote',
  '-muendliche-pruefung',
  '-schweregrad',
  '-pruefungssimulation',
  '-qualitaet',
] as const;

/**
 * Single dispatcher for all programmatic SEO routes (/:slug-suffix).
 * React Router v6 can't distinguish between /:slug-pruefung and /:slug-qualitaet
 * because they're all single-segment dynamic params with identical ranking.
 * This component inspects the pathname suffix and renders the correct page.
 *
 * If the URL doesn't match any known suffix, it falls through to
 * CertificationSEOPage which will show its "not found" state.
 */
const ProgrammaticSEODispatcher = () => {
  const { pathname } = useLocation();
  const segment = pathname.replace(/^\//, '');

  // Check if this URL has a known SEO suffix
  const hasKnownSuffix = SEO_SUFFIXES.some(suffix => segment.endsWith(suffix));

  if (!hasKnownSuffix) {
    // Not a programmatic SEO URL — render CertificationSEOPage
    // which will show "not found" for unknown slugs
    return (
      <Suspense fallback={<LoadingFallback />}>
        <CertificationSEOPage />
      </Suspense>
    );
  }

  if (segment.endsWith('-qualitaet')) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <QualityScorePage />
      </Suspense>
    );
  }

  // All other known suffixes (-pruefung, -durchfallquote, etc.)
  return (
    <Suspense fallback={<LoadingFallback />}>
      <CertificationSEOPage />
    </Suspense>
  );
};

export default ProgrammaticSEODispatcher;
