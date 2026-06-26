import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Brain, GraduationCap, Loader2, Mic, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useHomepageCatalog } from '@/hooks/usePublishedCourses';
import { getExamTarget } from '@/lib/examTargets';
import {
  SEO_TEMPLATES,
  SITE_URL,
  PRODUCT_PRICES,
  PRODUCT_PRICE_DISPLAY,
  generateCourseSchema,
  generateFAQSchema,
} from '@/lib/seo';
import { TrackingEvents } from '@/lib/tracking/track';
import { startProductCheckout } from '@/lib/checkout/startProductCheckout';
import { BerufHero } from '@/components/landing/beruf/BerufHero';
import { BerufReadinessBlock } from '@/components/landing/beruf/BerufReadinessBlock';
import { BerufModulesBlock } from '@/components/landing/beruf/BerufModulesBlock';
import { BerufPersonaBranches } from '@/components/landing/beruf/BerufPersonaBranches';
import { BerufComparisonBlock } from '@/components/landing/beruf/BerufComparisonBlock';
import { BerufStickyCta } from '@/components/landing/beruf/BerufStickyCta';
import { ProductFAQSection } from '@/components/product/ProductFAQSection';
import publishedBerufeFallback from '@/data/publishedBerufeFallback.json';

const FALLBACK_BERUFE = publishedBerufeFallback as Array<{
  id: string;
  title: string;
  slug: string;
  kammer: string | null;
}>;

export default function BerufDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: catalog, isLoading } = useHomepageCatalog();
  const heroRef = useRef<HTMLDivElement>(null);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [buying, setBuying] = useState(false);

  const course = catalog?.find((c) => c.slug === slug);
  const fallbackEntry = !course && slug
    ? FALLBACK_BERUFE.find((b) => b.slug === slug)
    : undefined;

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

  // Static SSOT-Fallback render — slug is in the published-berufe SSOT fallback
  // but DB catalog hasn't hydrated yet (or row missing). Reality-QA: jede
  // /berufe/:slug-Route, die /berufe verlinkt, MUSS sichtbaren Body (>200 chars)
  // mit Titel, Preis 24,90 €, CTA, Trust und Cross-Sell rendern.
  if (!course && fallbackEntry && slug) {
    const title = fallbackEntry.title;
    const kammerLabel = fallbackEntry.kammer || 'IHK';
    return (
      <>
        <SEOHead
          title={`${title} – ${kammerLabel}-Prüfungsvorbereitung | ExamFit`}
          description={`Bereite dich auf die ${kammerLabel}-Prüfung ${title} vor: Lernkurs, Prüfungstrainer, KI-Tutor und mündliche Simulation – 24,90 € für 12 Monate Zugriff.`}
          canonical={`${SITE_URL}/berufe/${slug}`}
        />
        <main className="min-h-screen bg-background">
          <div className="container max-w-3xl pt-4">
            <Breadcrumbs items={[{ label: 'Berufe', href: '/berufe' }, { label: title }]} />
          </div>
          <section className="container max-w-3xl py-10 space-y-8" data-testid="beruf-detail-fallback">
            <header className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-primary">
                {kammerLabel}-Prüfungsvorbereitung
              </p>
              <h1 className="text-3xl sm:text-4xl font-display font-bold text-text-primary">
                {title} – Prüfungstraining
              </h1>
              <p className="text-base text-text-secondary max-w-2xl">
                Lernkurs, Prüfungstrainer, KI-Tutor und mündliche Simulation in einem Paket.
                Adaptive Schwächenanalyse, prüfungsnahe Aufgaben und sofort startklar — alles
                speziell für angehende {title}.
              </p>
            </header>

            <div className="rounded-2xl border border-border bg-card/60 p-6 sm:p-8 flex flex-col sm:flex-row gap-5 items-start sm:items-center justify-between">
              <div>
                <p className="text-4xl sm:text-5xl font-bold text-foreground">24,90 €</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  einmalig · 12 Monate Zugriff · kein Abo
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Button asChild size="lg" data-cta-location="beruf_fallback_primary">
                  <Link to="/auth?intent=checkout&product=bundle">
                    Prüfungstraining starten <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to={`/pruefungscheck?source=beruf&slug=${encodeURIComponent(slug)}`}>
                    Kostenlosen Check
                  </Link>
                </Button>
              </div>
            </div>

            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs sm:text-sm">
              <li className="flex items-center gap-2 rounded-lg border border-border bg-card/40 p-3">
                <ShieldCheck className="h-4 w-4 text-primary" /> DSGVO-konform
              </li>
              <li className="flex items-center gap-2 rounded-lg border border-border bg-card/40 p-3">
                <BadgeCheck className="h-4 w-4 text-primary" /> Prüfungskonform
              </li>
              <li className="flex items-center gap-2 rounded-lg border border-border bg-card/40 p-3">
                <GraduationCap className="h-4 w-4 text-primary" /> Für Azubis entwickelt
              </li>
              <li className="flex items-center gap-2 rounded-lg border border-border bg-card/40 p-3">
                <ShieldCheck className="h-4 w-4 text-primary" /> 12 Monate Zugriff
              </li>
            </ul>

            <section aria-label="Im Paket enthalten" className="space-y-3">
              <h2 className="text-xl font-display font-semibold">Im Komplettpaket enthalten</h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <li className="rounded-lg border border-border bg-card/40 p-4">
                  <p className="font-semibold flex items-center gap-2">
                    <GraduationCap className="h-4 w-4 text-primary" /> Lernkurs
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Strukturierte Inhalte nach {kammerLabel}-Rahmenplan.
                  </p>
                </li>
                <li className="rounded-lg border border-border bg-card/40 p-4">
                  <Link to="/exam-trainer" className="font-semibold flex items-center gap-2 hover:text-primary">
                    <BadgeCheck className="h-4 w-4 text-primary" /> Prüfungssimulation
                  </Link>
                  <p className="text-sm text-muted-foreground mt-1">
                    Original-Aufgabenformate mit Bewertung.
                  </p>
                </li>
                <li className="rounded-lg border border-border bg-card/40 p-4">
                  <Link to="/tutor" className="font-semibold flex items-center gap-2 hover:text-primary">
                    <Brain className="h-4 w-4 text-primary" /> KI-Tutor
                  </Link>
                  <p className="text-sm text-muted-foreground mt-1">
                    Erklärungen mit Quellen – Strict-RAG, keine Halluzinationen.
                  </p>
                </li>
                <li className="rounded-lg border border-border bg-card/40 p-4">
                  <Link to="/muendliche-pruefung" className="font-semibold flex items-center gap-2 hover:text-primary">
                    <Mic className="h-4 w-4 text-primary" /> Mündliche Prüfung
                  </Link>
                  <p className="text-sm text-muted-foreground mt-1">
                    Realistisches Fachgespräch mit Feedback.
                  </p>
                </li>
              </ul>
            </section>

            <div className="text-center pt-4">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link to="/auth?intent=checkout&product=bundle">
                  Komplettpaket sichern – 24,90 €
                </Link>
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                Brauchst du einen anderen Beruf? <Link to="/berufe" className="underline">Alle Berufe ansehen</Link>
              </p>
            </div>
          </section>
        </main>
      </>
    );
  }

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

  // /paket/[slug] ist redundant geworden: Beruf-Seite ist jetzt direkter
  // Checkout-Einstieg. Wir nutzen den Beruf-Slug — create-guest-checkout
  // löst Aliase via suggested_slug auf, falls product- und beruf-Slug abweichen.
  const checkoutSlug = slug;
  const quizHref = `/pruefungscheck?source=beruf&slug=${encodeURIComponent(slug)}`;

  const handleBuy = async (location: string) => {
    if (buying) return;
    trackCta(location);
    setBuying(true);
    try {
      const res = await startProductCheckout(checkoutSlug, { source: `beruf_${location}` });
      if (!res.ok) {
        if (res.error_code === 'already_entitled') {
          toast.success('Du hast dieses Komplettpaket bereits – wir leiten dich in dein Lernportal.');
          window.location.href = '/learner';
          return;
        }
        if (res.error_code === 'product_not_found' && (res.suggested_url || res.fallback_url)) {
          window.location.href = res.suggested_url || res.fallback_url!;
          return;
        }
        toast.error(res.error || 'Checkout konnte nicht gestartet werden.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Checkout-Fehler');
    } finally {
      setBuying(false);
    }
  };

  const faqs = [
    {
      question: `Wie bereite ich mich auf die ${kammerLabel}-Prüfung ${title} vor?`,
      answer: `Du startest mit dem kostenlosen Prüfungsreife-Check. ExamFit erkennt deine Schwächen, baut deinen Lernplan und führt dich durch Lernkurs, Prüfungsfragen, KI-Tutor und mündliche Simulation.`,
    },
    {
      question: `Was kostet ExamFit für ${title}?`,
      answer: `Das Komplettpaket kostet einmalig ${PRODUCT_PRICE_DISPLAY} – inklusive Lernkurs, Prüfungstrainer, KI-Tutor und mündlicher Simulation. 12 Monate Zugang. Kein Abo.`,
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
      question: 'Wie kann ich vor dem Kauf einschätzen, ob es passt?',
      answer: 'Der Prüfungsreife-Check dauert ca. 4 Minuten und liefert dir deinen Score sowie deine schwächsten Themen – ohne Anmeldung. Anschließend kannst du das Komplettpaket für 24,90 € sichern.',
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
            quizHref={quizHref}
            onPrimaryCta={() => trackCta('hero_quiz')}
            onBuyCta={() => handleBuy('hero_buy')}
            buying={buying}
            priceLabel={`${PRODUCT_PRICES.bundle} €`}
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
              Sichere dir direkt das Komplettpaket für {PRODUCT_PRICES.bundle} € oder starte
              vorher in 4 Minuten mit dem kostenlosen Prüfungsreife-Check.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                size="lg"
                onClick={() => handleBuy('footer_buy')}
                disabled={buying}
                data-cta-location="beruf_footer_buy"
              >
                {buying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Weiterleitung …
                  </>
                ) : (
                  <>Komplettpaket sichern – {PRODUCT_PRICES.bundle} €</>
                )}
              </Button>
              <Button asChild size="lg" variant="outline" onClick={() => trackCta('footer_quiz')}>
                <Link to={quizHref}>Prüfungsreife-Check (4 Min.)</Link>
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
