import { useLocation, useParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

const QualityScorePage = lazy(() => import('@/pages/seo/QualityScorePage'));
const CertificationSEOPage = lazy(() => import('@/pages/seo/CertificationSEOPage'));

// PDP.HERO.CLS.STABILIZE.1 — reserve PDP-typische Höhe, damit der Footer
// während Chunk-Load NICHT in den Viewport rutscht und beim Mount des echten
// Inhalts einen großen Layout-Shift (gemessen 0.65 desktop) auslöst.
const LoadingFallback = () => (
  <div className="flex items-start justify-center min-h-[1800px] pt-24">
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

/** Slugs reserved by other route groups — must not be handled here */
const RESERVED_SLUGS = new Set([
  'work', 'berufski', 'shop', 'auth', 'admin', 'dashboard',
  'installieren', 'purchase-success',
  // App-Bereiche, die nicht als SEO-Slug missverstanden werden dürfen
  'org', 'orgs', 'organization', 'personas', 'preise', 'berufe',
  'heatmap', 'exam-trainer', 'exam', 'training', 'shuttle',
  'ai-tutor', 'tutor', 'profile', 'settings',
]);

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
  const segment = pathname.replace(/^\//, '').split('/')[0];

  // Reserved slugs handled by other route groups — render nothing so RR falls through
  if (RESERVED_SLUGS.has(segment)) {
    return null;
  }

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
