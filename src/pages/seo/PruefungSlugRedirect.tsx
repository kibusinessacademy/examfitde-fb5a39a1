import { useEffect } from 'react';
import { useParams, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useCertificationSeoMapping } from '@/hooks/useCertificationSeoMapping';

/**
 * /pruefung/:slug → 301-style Redirect auf die kanonische Kategorie-URL
 * (z.B. /fachwirt/fachwirt-einkauf-ihk-pruefung).
 *
 * Ist die SEO-Page nicht im Mapping bekannt, fallen wir auf /ausbildung/:slug
 * zurück (CertificationSEOPage zeigt dann die "nicht gefunden"-View).
 */
export default function PruefungSlugRedirect() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { data: mapping, isLoading } = useCertificationSeoMapping(slug);

  // Soft-301: replace history-Eintrag, damit Back-Button nicht in der Loop landet.
  // (echtes 301 ist Hosting-Sache; SPA macht client-seitigen Redirect.)
  useEffect(() => {
    if (typeof document !== 'undefined') {
      // Hint für Crawler — Canonical wird im Ziel-Page erneut gesetzt.
      // (Optional: hier nur Loader anzeigen.)
    }
  }, [slug]);

  if (!slug) return <Navigate to="/" replace />;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <span className="sr-only">Weiterleitung …</span>
      </div>
    );
  }

  const target = mapping?.canonical_url_path ?? `/ausbildung/${slug}`;
  return <Navigate to={target + location.search + location.hash} replace />;
}
