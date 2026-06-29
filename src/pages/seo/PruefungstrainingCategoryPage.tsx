import { useParams, Link } from 'react-router-dom';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateBreadcrumbSchema, SITE_URL } from '@/lib/seo';
import { useCertificationCatalog } from '@/hooks/useCertificationSEO';
import { usePublishedCertifications } from '@/hooks/usePublishedCertifications';
import { Target, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CoursePremiumCard } from '@/components/shop/CoursePremiumCard';

const CATEGORY_META: Record<string, { title: string; h1: string; description: string; filterFn: (c: any) => boolean }> = {
  ausbildung: {
    title: 'Prüfungstraining Ausbildung – IHK-Abschlussprüfung bestehen',
    h1: 'Prüfungstraining für Ausbildungsberufe',
    description: 'IHK-Prüfungstraining für alle Ausbildungsberufe: Prüfungssimulation, Musterfragen & KI-Coach. Finde dein Prüfungstraining und bestehe deine Abschlussprüfung sicher.',
    filterFn: (c: any) => c.catalog_type === 'Ausbildung',
  },
  fachwirt: {
    title: 'Prüfungstraining Fachwirt – IHK-Fortbildungsprüfung bestehen',
    h1: 'Prüfungstraining für Fachwirt-Prüfungen',
    description: 'Prüfungstraining für IHK-Fachwirt-Prüfungen: Wirtschaftsfachwirt, Handelsfachwirt, Industriefachwirt & mehr. Realistische Simulation + KI-Prüfungscoach.',
    filterFn: (c: any) => c.title.toLowerCase().includes('fachwirt'),
  },
  meister: {
    title: 'Prüfungstraining Meister – Meisterprüfung bestehen',
    h1: 'Prüfungstraining für Meisterprüfungen',
    description: 'Meisterprüfung Training: Industriemeister Metall, Elektrotechnik, Mechatronik & mehr. Prüfungssimulation und Musterfragen für die IHK-Meisterprüfung.',
    filterFn: (c: any) => c.catalog_type === 'Meister',
  },
  betriebswirt: {
    title: 'Prüfungstraining Betriebswirt – IHK-Prüfung bestehen',
    h1: 'Prüfungstraining für Betriebswirt-Prüfungen',
    description: 'Geprüfter Betriebswirt (IHK) & Technischer Betriebswirt: Prüfungstraining mit KI-Coach, Simulation und prüfungsrelevanten Aufgaben.',
    filterFn: (c: any) => c.title.toLowerCase().includes('betriebswirt'),
  },
  sachkunde: {
    title: 'Prüfungstraining Sachkunde – §34a/d/f bestehen',
    h1: 'Prüfungstraining für Sachkundeprüfungen',
    description: 'Sachkundeprüfung Training: §34a Bewachungsgewerbe, §34d Versicherungsvermittler, §34f Finanzanlagenvermittler. Online üben & bestehen.',
    filterFn: (c: any) => c.catalog_type === 'Sachkunde',
  },
};

const PruefungstrainingCategoryPage = () => {
  const params = useParams<{ category?: string; slug?: string }>();
  const category = params.category || params.slug;
  const { data: catalog, isLoading } = useCertificationCatalog();
  const { data: publishedIds } = usePublishedCertifications();

  const meta = CATEGORY_META[category || ''];
  if (!meta) {
    return (
      <div className="container py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Kategorie nicht gefunden</h1>
        <Link to="/pruefungstraining" className="text-primary hover:underline">Zurück zur Übersicht</Link>
      </div>
    );
  }

  const certifications = catalog?.filter(meta.filterFn).sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0)) || [];

  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: meta.h1.replace('Prüfungstraining für ', '') },
  ];

  return (
    <>
      <SEOHead
        title={meta.title}
        description={meta.description}
        canonical={`${SITE_URL}/pruefungstraining/${category}`}
        structuredData={generateBreadcrumbSchema(breadcrumbs)}
      />

      <div className="container py-12 space-y-12">
        <section className="max-w-4xl mx-auto space-y-4">
          <Breadcrumbs items={[
            { label: 'Start', href: '/' },
            { label: 'Prüfungstraining', href: '/pruefungstraining' },
            { label: meta.h1.replace('Prüfungstraining für ', '') },
          ]} />
          <h1 className="text-3xl md:text-4xl font-bold">{meta.h1}</h1>
          <p className="text-lg text-muted-foreground">{meta.description}</p>
        </section>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <section className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
              {certifications.map(cert => {
                const isCertPublished = publishedIds?.has(cert.id);
                const meta = [cert.chamber_type, cert.min_question_target ? `${cert.min_question_target}+ Fragen` : null]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <CoursePremiumCard
                    key={cert.id}
                    title={cert.title}
                    href={`/pruefungstraining/${cert.slug}`}
                    chamber={cert.chamber_type}
                    meta={meta}
                    status={isCertPublished ? 'available' : 'soon'}
                    primaryLabel={isCertPublished ? 'Zum Training' : 'Vormerken'}
                    primaryIcon="arrow"
                  />
                );
              })}
            </div>

            {certifications.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                Noch keine Prüfungstrainings in dieser Kategorie verfügbar.
              </p>
            )}
          </section>
        )}

        {/* CTA */}
        <section className="text-center py-8 space-y-4">
          <h2 className="text-2xl font-bold">Deine Prüfung nicht dabei?</h2>
          <p className="text-muted-foreground">Wir erweitern ständig unser Angebot. Schaue regelmäßig vorbei!</p>
          <Link to="/shop">
            <Button size="lg" className="shadow-glow">
              <Target className="mr-2 h-5 w-5" /> Jetzt Prüfungstraining starten
            </Button>
          </Link>
        </section>
      </div>
    </>
  );
};

export default PruefungstrainingCategoryPage;
