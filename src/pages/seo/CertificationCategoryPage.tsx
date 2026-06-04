import { Helmet } from 'react-helmet-async';
import { Link, useParams } from 'react-router-dom';
import { useCertificationCatalog, CERTIFICATION_CATEGORY_ROUTES } from '@/hooks/useCertificationSEO';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { calculateHybridTargetFromDefaults } from '@/lib/hybridExamTarget';

const CertificationCategoryPage = () => {
  const { category } = useParams<{ category: string }>();
  const { data: catalog, isLoading } = useCertificationCatalog();

  const categoryConfig = CERTIFICATION_CATEGORY_ROUTES[category || ''];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Filter catalog by certification_level matching category
  const filteredCerts = catalog?.filter(c => {
    const level = (c as Record<string, unknown>).certification_level as string || 'ausbildung';
    return level === category;
  }) ?? [];

  const pageTitle = categoryConfig?.seoTitle || `${category} Prüfungen`;
  const pageDescription = `Prüfungsvorbereitung für ${pageTitle} — mit KI-gestütztem Prüfungstrainer, originalgetreuen Fragen und Simulation. Jetzt mit ExamFit bestehen!`;

  return (
    <>
      <Helmet>
        <title>{pageTitle} 2026 | ExamFit</title>
        <meta name="description" content={pageDescription} />
        <link rel="canonical" href={`https://berufos.com/${category}`} />
      </Helmet>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">{pageTitle}</h1>
        <p className="text-lg text-muted-foreground mb-8">{pageDescription}</p>

        {filteredCerts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg">
              Prüfungen in dieser Kategorie werden derzeit aufgebaut.
            </p>
            <Link to="/" className="text-primary hover:underline mt-4 inline-block">
              Alle Prüfungen ansehen
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCerts.map((cert) => {
              const target = calculateHybridTargetFromDefaults(null, cert.track);
              return (
                <Link key={cert.id} to={`/${category}/${cert.slug}`}>
                  <Card className="h-full hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary">{cert.chamber_type}</Badge>
                        <Badge variant="outline">{cert.track}</Badge>
                      </div>
                      <CardTitle className="text-lg">{cert.title}</CardTitle>
                      <CardDescription>
                        {target.marketingLabel} • KI-Simulation • Mündliche Prüfung
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}

        {/* Category cross-links */}
        <nav className="mt-16 border-t pt-8">
          <h2 className="text-xl font-semibold mb-4">Weitere Prüfungskategorien</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(CERTIFICATION_CATEGORY_ROUTES)
              .filter(([key]) => key !== category)
              .map(([key, config]) => (
                <Link
                  key={key}
                  to={config.path}
                  className="px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium transition-colors"
                >
                  {config.label}
                </Link>
              ))}
          </div>
        </nav>
      </div>
    </>
  );
};

export default CertificationCategoryPage;
