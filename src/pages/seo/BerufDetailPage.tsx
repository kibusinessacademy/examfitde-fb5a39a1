import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useHomepageCatalog } from '@/hooks/usePublishedCourses';
import { getExamTarget } from '@/lib/examTargets';
import {
  SEO_TEMPLATES,
  SITE_URL,
  PRODUCT_PRICES,
  generateCourseSchema,
  generateFAQSchema,
} from '@/lib/seo';
import { TrackingEvents } from '@/lib/tracking/track';
import { BerufHero } from '@/components/landing/beruf/BerufHero';
import { BerufReadinessBlock } from '@/components/landing/beruf/BerufReadinessBlock';
import { BerufModulesBlock } from '@/components/landing/beruf/BerufModulesBlock';
import { BerufPersonaBranches } from '@/components/landing/beruf/BerufPersonaBranches';
import { BerufComparisonBlock } from '@/components/landing/beruf/BerufComparisonBlock';
import { BerufStickyCta } from '@/components/landing/beruf/BerufStickyCta';
import { ProductFAQSection } from '@/components/product/ProductFAQSection';

export default function BerufDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: catalog, isLoading } = useHomepageCatalog();
  const heroRef = useRef<HTMLDivElement>(null);
  const [stickyVisible, setStickyVisible] = useState(false);

  const course = catalog?.find((c) => c.slug === slug);

  useEffect(() => {
    if (!slug || !course) return;
    TrackingEvents.landingView(slug, 'beruf');
  }, [slug, course]);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setStickyVisible(!entry.isIntersecting),
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-petrol-600 dark:text-mint-400" />
      </div>
    );
  }

  if (!course || !slug) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-bold mb-4 text-text-primary">Beruf nicht gefunden</h1>
          <p className="text-sm text-text-secondary mb-6">
            Diesen Beruf konnten wir nicht finden. Schau in der Übersicht oder gehe zur Startseite zurück.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button asChild>
              <Link to="/berufe">Alle Berufe anzeigen</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/">Zur Startseite</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const title = course.berufDisplayName || course.title;
  const kammerLabel = course.kammer || 'IHK';
  const duration = course.ausbildungsdauerMonate || 36;
  const examConfig = getExamTarget(duration);
  const seo = SEO_TEMPLATES.beruf(title, kammerLabel, examConfig.label);

  const bundleHref = `/bundle/${slug}`;
  const quizHref = `/pruefungsreife-check?source=beruf&slug=${encodeURIComponent(slug)}`;

  const faqs = [
    {
      question: `Wie bereite ich mich auf die ${kammerLabel}-Prüfung ${title} vor?`,
      answer: `Du startest mit dem kostenlosen Prüfungsreife-Check. ExamFit erkennt deine Schwächen, baut deinen Lernplan und führt dich durch Lernkurs, Prüfungsfragen, KI-Tutor und mündliche Simulation.`,
    },
    {
      question: `Was kostet ExamFit für ${title}?`,
      answer: `Das Komplettpaket kostet einmalig ${PRODUCT_PRICES.bundle} € – inklusive Lernkurs, Prüfungstrainer, KI-Tutor und mündlicher Simulation. 12 Monate Zugang. Kein Abo.`,
    },
    {
      question: `Gibt es eine mündliche Prüfungssimulation für ${title}?`,
      answer: `Ja. Du übst das Fachgespräch mit einer realistischen Simulation und bekommst strukturiertes Feedback zu Fachlichkeit, Struktur, Begriffssicherheit und Praxisbezug.`,
    },
    {
      question: 'Ist ExamFit ein Abo?',
      answer: 'Nein. Du zahlst einmalig und bekommst 12 Monate Zugang zu allen Modulen.',
    },
    {
      question: 'Worauf basiert das Prüfungstraining?',
      answer: `Auf dem ${kammerLabel}-Rahmenplan für ${title} und prüfungsnahen Aufgabenformaten. Inhalte sind nach Kompetenzbereichen gegliedert.`,
    },
    {
      question: 'Kann ich zuerst kostenlos testen?',
      answer: 'Ja. Der Prüfungsreife-Check dauert ca. 4 Minuten und liefert dir deinen Score sowie deine schwächsten Themen – ohne Anmeldung.',
    },
  ];

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      generateCourseSchema({
        id: slug || course.packageId,
        name: `${title} ${kammerLabel}-Prüfungsvorbereitung`,
        description: course.description || seo.description,
        url: `${SITE_URL}/berufe/${slug}`,
        price: PRODUCT_PRICES.bundle,
      }),
      generateFAQSchema(faqs),
    ],
  };

  const trackCta = (label: string) => {
    void TrackingEvents.ctaPrimaryClick(slug, label, String(PRODUCT_PRICES.bundle));
  };

  return (
    <>
      <SEOHead
        title={seo.title}
        description={seo.description}
        canonical={`${SITE_URL}/berufe/${slug}`}
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-background pb-16 md:pb-0">
        <div className="container max-w-6xl pt-4">
          <Breadcrumbs items={[{ label: 'Berufe', href: '/berufe' }, { label: title }]} />
        </div>

        <div ref={heroRef}>
          <BerufHero
            beruf={title}
            kammer={kammerLabel}
            description={course.description}
            bundleHref={bundleHref}
            quizHref={quizHref}
            onPrimaryCta={() => trackCta('hero_quiz')}
            onSecondaryCta={() => trackCta('hero_bundle')}
          />
        </div>

        <BerufReadinessBlock beruf={title} />

        <BerufModulesBlock beruf={title} kammer={kammerLabel} />

        <BerufPersonaBranches
          beruf={title}
          quizHref={quizHref}
          onCtaClick={(persona) => trackCta(`persona_${persona}`)}
        />

        <BerufComparisonBlock />

        <ProductFAQSection items={faqs} />

        <section className="border-t border-border-subtle">
          <div className="container max-w-3xl py-12 md:py-16 text-center space-y-5">
            <h2 className="text-2xl md:text-3xl font-display font-bold text-text-primary">
              Bereit für die {title}-Prüfung?
            </h2>
            <p className="text-text-secondary">
              Starte in 4 Minuten mit dem kostenlosen Prüfungsreife-Check oder sichere dir
              direkt das Komplettpaket für {PRODUCT_PRICES.bundle} €.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" onClick={() => trackCta('footer_quiz')}>
                <Link to={quizHref}>Prüfungsreife testen</Link>
              </Button>
              <Button asChild size="lg" variant="outline" onClick={() => trackCta('footer_bundle')}>
                <Link to={bundleHref}>Komplettpaket ansehen</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>

      <BerufStickyCta
        visible={stickyVisible}
        beruf={title}
        quizHref={quizHref}
        onCtaClick={() => trackCta('sticky_quiz')}
      />
    </>
  );
}
