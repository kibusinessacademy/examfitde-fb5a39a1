import { useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

const QualityScorePage = lazy(() => import('@/pages/seo/QualityScorePage'));
const CertificationSEOPage = lazy(() => import('@/pages/seo/CertificationSEOPage'));

const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

/**
 * Single dispatcher for all programmatic SEO routes (/:slug-suffix).
 * React Router v6 can't distinguish between /:slug-pruefung and /:slug-qualitaet
 * because they're all single-segment dynamic params with identical ranking.
 * This component inspects the pathname suffix and renders the correct page.
 */
const ProgrammaticSEODispatcher = () => {
  const { pathname } = useLocation();
  const segment = pathname.replace(/^\//, '');

  if (segment.endsWith('-qualitaet')) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <QualityScorePage />
      </Suspense>
    );
  }

  // All other suffixes (-pruefung, -durchfallquote, -muendliche-pruefung, etc.)
  return (
    <Suspense fallback={<LoadingFallback />}>
      <CertificationSEOPage />
    </Suspense>
  );
};

export default ProgrammaticSEODispatcher;
