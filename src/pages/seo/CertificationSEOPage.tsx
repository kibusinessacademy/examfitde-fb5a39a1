import { useParams, useLocation, Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { useCertificationSEOPage } from '@/hooks/useCertificationSEO';
import { Loader2, ArrowRight, BookOpen, Target, Brain, CheckCircle2, Award } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

/** Derive category label from the current URL path */
function getCategoryFromPath(pathname: string): { key: string; label: string } {
  const seg = pathname.split('/').filter(Boolean)[0] ?? 'ausbildung';
  const map: Record<string, string> = {
    ausbildung: 'Ausbildungsprüfungen',
    fachwirt: 'Fachwirt-Prüfungen',
    meister: 'Meisterprüfungen',
    sachkunde: 'Sachkundeprüfungen',
    projektmanagement: 'Projektmanagement',
  };
  return { key: seg, label: map[seg] ?? seg };
}

const GENERIC_FAQS = (title: string) => [
  {
    question: `Wie bereite ich mich auf die ${title} Prüfung vor?`,
    answer: `Die beste Vorbereitung kombiniert strukturiertes Lernen mit aktivem Üben. ExamFit bietet prüfungsnahe Fragen, realistische Simulation und einen KI-Coach – so erkennst du Schwächen frühzeitig.`,
  },
  {
    question: `Was kostet das Prüfungstraining für ${title}?`,
    answer: `ExamFit kostet ${PRICING.defaultPrice} einmalig (${PRICING.noSubscription.toLowerCase()}) für ${PRICING.defaultAccess} Zugang. Alle Module inklusive.`,
  },
  {
    question: `Gibt es eine Probeprüfung für ${title}?`,
    answer: `Ja – ExamFit bietet eine realistische Prüfungssimulation mit echten Zeitvorgaben und prüfungskonformen Aufgabentypen. So weißt du vor der echten Prüfung, wo du stehst.`,
  },
];

const CertificationSEOPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const { pathname } = useLocation();
  const { data: page, isLoading } = useCertificationSEOPage(slug || '');
  const category = getCategoryFromPath(pathname);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">Seite nicht gefunden</h1>
        <p className="text-muted-foreground mb-8">Die angeforderte Prüfungsseite wurde nicht gefunden.</p>
        <Link to="/" className="text-primary hover:underline">Zurück zur Startseite</Link>
      </div>
    );
  }

  const displayTitle = page.title;
  const faqs = GENERIC_FAQS(displayTitle);
  const sourceUrl = `/${category.key}/${slug}`;
  const productUrl = `/pruefungstraining/${slug}`;

  const breadcrumbItems = [
    { name: 'Start', url: SITE_URL },
    { name: category.label, url: `${SITE_URL}/${category.key}` },
    { name: displayTitle },
  ];

  return (
    <>
      <SEOHead
        title={page.meta_title || `${displayTitle} Prüfungsvorbereitung | ExamFit`}
        description={page.meta_description || `${displayTitle} Prüfung vorbereiten: Prüfungsfragen, Simulation und KI-Coach. Jetzt bei ExamFit trainieren.`}
        canonical={`${SITE_URL}${sourceUrl}`}
        structuredData={[generateBreadcrumbSchema(breadcrumbItems), generateFAQSchema(faqs)]}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: category.label, href: `/${category.key}` },
              { label: displayTitle },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">{category.label}</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">{displayTitle}</span>: Prüfung sicher bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Strukturiertes Prüfungstraining mit prüfungsnahen Fragen, realistischer Simulation und persönlichem KI-Prüfungscoach.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" asChild>
                  <Link to={productUrl}>Prüfungstraining starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link to={`/${category.key}`}>Alle {category.label}</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* USPs */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8 text-center">Dein Prüfungstraining im Überblick</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: BookOpen, title: 'Prüfungsfragen', desc: 'Echte Fragetypen aus der IHK-Prüfung – mit Lösungen und Erklärungen' },
                { icon: Target, title: 'Prüfungssimulation', desc: 'Realistische Bedingungen: gleiche Zeitvorgaben, Bestehensindikator' },
                { icon: Brain, title: 'KI-Coach', desc: 'Persönlicher Lernbegleiter erkennt Schwächen und gibt Empfehlungen' },
              ].map((item, i) => (
                <div key={i} className="text-center p-6 rounded-xl bg-background border border-border/50">
                  <item.icon className="h-8 w-8 text-primary mx-auto mb-3" />
                  <h3 className="font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Original content from DB */}
        {page.content_html && (
          <section className="py-16">
            <article className="container max-w-4xl">
              <div
                className="prose prose-lg max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(page.content_html, {
                    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'sub', 'sup', 'hr'],
                    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
                    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'form'],
                    ALLOW_DATA_ATTR: false,
                  }),
                }}
              />
            </article>
          </section>
        )}

        {/* Vorbereitungs-Schritte */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-6">So bereitest du dich optimal vor</h2>
            <div className="space-y-4">
              {[
                'Lernplan erstellen: Themen priorisieren, Zeitrahmen festlegen',
                'Prüfungsfragen bei ExamFit üben – mit Erklärungen und Lösungswegen',
                'Schwächen identifizieren und gezielt nacharbeiten',
                'Prüfungssimulation unter realen Bedingungen durchführen',
                'KI-Coach nutzen für persönliche Lernempfehlungen',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border/50">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SEO Quiz Widget */}
        <section className="py-16">
          <div className="container max-w-3xl">
            <SEOQuizWidget certificationSlug={slug || ''} title={`${displayTitle} – Wissen testen`} maxQuestions={5} />
          </div>
        </section>

        {/* Internal Links from DB */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <SEOInternalLinks sourceUrl={sourceUrl} linkTypes={['cluster_to_product']} title="Jetzt Training starten" />
          </div>
        </section>

        {/* Legacy internal links */}
        {page.internal_links && page.internal_links.length > 0 && (
          <section className="py-16">
            <div className="container max-w-3xl">
              <h2 className="text-xl font-semibold mb-4">Verwandte Prüfungen</h2>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {page.internal_links.map((link) => (
                  <li key={link.slug}>
                    <Link to={`/${link.slug}`} className="text-primary hover:underline">{link.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* SEO Internal Links – Cluster zurück zum Hub */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <SEOInternalLinks sourceUrl={sourceUrl} linkTypes={['cluster_to_pillar']} title="Weitere Prüfungen entdecken" />
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-display font-bold mb-8">Häufige Fragen zur {displayTitle} Prüfung</h2>
            <div className="space-y-6">
              {faqs.map((faq, i) => (
                <div key={i} className="border-b border-border/50 pb-6">
                  <h3 className="font-semibold text-lg mb-2">{faq.question}</h3>
                  <p className="text-muted-foreground">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-16 bg-primary/5">
          <div className="container max-w-3xl text-center">
            <Award className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-3xl font-display font-bold mb-4">Bereit für die Prüfung?</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              {PRICING.defaultPrice} einmalig • {PRICING.defaultAccess} Zugang • {PRICING.noSubscription}
            </p>
            <Button size="lg" asChild>
              <Link to={productUrl}>Jetzt {displayTitle} Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
};

export default CertificationSEOPage;
