import { useParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateFAQSchema, generateBreadcrumbSchema, generateCourseSchema, SITE_URL, seoTitle } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import { useCertificationCatalog, useCertificationSEOPage } from '@/hooks/useCertificationSEO';
import { usePublishedCertifications } from '@/hooks/usePublishedCertifications';
import { trackConversion } from '@/lib/seo-tracking';
import {
  Target, ArrowRight, CheckCircle2, AlertTriangle, BookOpen, Brain, Clock,
  BarChart3, Shield, Mic, MessageSquare, TrendingUp, ClipboardCheck, Zap,
  Loader2, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import PruefungstrainingCategoryPage from './PruefungstrainingCategoryPage';

const KNOWN_CATEGORIES = ['ausbildung', 'fachwirt', 'meister', 'betriebswirt', 'sachkunde', 'aevo'];

/* ── FAQ generator (conversion-oriented) ── */
function generateFAQs(cert: any) {
  const name = cert.title;
  const chamber = cert.chamber_type || 'IHK';
  const questions = cert.min_question_target || 600;
  return [
    { question: `Für welche Prüfung ist dieses Training gedacht?`, answer: `Dieses Prüfungstraining ist exakt auf die ${chamber}-Prüfung ${name} ausgerichtet – mit prüfungsrelevanten Aufgabentypen, realistischen Zeitvorgaben und berufsspezifischem Fokus.` },
    { question: `Was ist im Preis enthalten?`, answer: `Du erhältst für ${PRICING.defaultPrice} einmalig ${PRICING.defaultAccess} Zugriff auf: ${questions}+ Prüfungsaufgaben, realistische Prüfungssimulation, KI-Prüfungscoach, mündliches Prüfungstraining, Schwächenanalyse und Prüfungsreife-Indikator.` },
    { question: `Ist das ein Abo?`, answer: `Nein. ${PRICING.noSubscription} – du zahlst einmalig und hast ${PRICING.defaultAccess} Zugriff. Keine automatische Verlängerung, keine versteckten Kosten.` },
    { question: `Kann ich schriftliche und mündliche Prüfung trainieren?`, answer: `Ja. ExamFit deckt beide Prüfungsteile ab: schriftliche Prüfungssimulation mit Zeitlimit und Auswertung sowie mündliches Fachgespräch-Training mit strukturiertem KI-Feedback.` },
    { question: `Wie schnell kann ich starten?`, answer: `Sofort. Nach der Zahlung erhältst du direkt Zugang zu allen Modulen und kannst mit dem Training beginnen.` },
    { question: `Ist das für Anfänger oder kurz vor der Prüfung?`, answer: `Beides. ExamFit eignet sich zur langfristigen Vorbereitung ebenso wie zum intensiven Training kurz vor der Prüfung. Die adaptive Schwächenanalyse passt sich deinem Stand an.` },
    { question: `Was unterscheidet ExamFit von normalen Vorbereitungskursen?`, answer: `ExamFit ist kein klassischer Kurs mit Videos und PDFs, sondern ein intelligentes Prüfungstrainings-System. Du trainierst aktiv mit prüfungsnahen Aufgaben, Simulationen und KI-Feedback – statt passiv Theorie zu lesen.` },
  ];
}

const PruefungstrainingDetailPage = () => {
  const { slug, category, slugOrCategory } = useParams<{ slug?: string; category?: string; slugOrCategory?: string }>();
  const resolvedSlug = slug || slugOrCategory;
  const isCategory = !slug && slugOrCategory && KNOWN_CATEGORIES.includes(slugOrCategory);

  const { data: catalog, isLoading } = useCertificationCatalog();
  const { data: seoPage } = useCertificationSEOPage(resolvedSlug || '');
  const { data: publishedIds } = usePublishedCertifications();

  const cert = useMemo(() => catalog?.find(c => c.slug === resolvedSlug), [catalog, resolvedSlug]);
  const isPublished = cert ? publishedIds?.has(cert.id) : false;
  const relatedCerts = useMemo(() => {
    if (!cert || !catalog) return [];
    return catalog
      .filter(c => c.id !== cert.id && c.catalog_type === cert.catalog_type)
      .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0))
      .slice(0, 6);
  }, [cert, catalog]);

  useEffect(() => {
    if (cert) {
      trackConversion({ event: 'product_view', source: 'product_page', label: cert.slug });
    }
  }, [cert?.slug]);

  if (isCategory) return <PruefungstrainingCategoryPage />;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!cert) {
    return (
      <div className="container py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Prüfungstraining nicht gefunden</h1>
        <p className="text-muted-foreground mb-6">Das gesuchte Prüfungstraining wurde leider nicht gefunden.</p>
        <Link to="/pruefungstraining" className="text-primary hover:underline">Zurück zur Übersicht</Link>
      </div>
    );
  }

  const faqs = generateFAQs(cert);
  const name = cert.title;
  const chamber = cert.chamber_type || 'IHK';
  const questions = cert.min_question_target || 600;

  const breadcrumbItems = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    ...(category ? [{ name: category.charAt(0).toUpperCase() + category.slice(1), url: `${SITE_URL}/pruefungstraining/${category}` }] : []),
    { name },
  ];

  const breadcrumbsUI = [
    { label: 'Start', href: '/' },
    { label: 'Prüfungstraining', href: '/pruefungstraining' },
    ...(category ? [{ label: category.charAt(0).toUpperCase() + category.slice(1), href: `/pruefungstraining/${category}` }] : []),
    { label: name },
  ];

  const structuredData = [
    generateFAQSchema(faqs),
    generateBreadcrumbSchema(breadcrumbItems),
    generateCourseSchema({
      id: cert.id,
      name: `Prüfungstraining ${name}`,
      description: `Bestehe deine ${chamber}-Prüfung ${name} sicher: ${questions}+ prüfungsnahe Aufgaben, Simulation & KI-Coach.`,
      url: `${SITE_URL}/pruefungstraining/${resolvedSlug}`,
      price: 29.90,
      currency: 'EUR',
      courseMode: 'online',
      educationalLevel: cert.certification_level || 'Berufsausbildung',
      numberOfLessons: questions,
      hasCertificate: true,
    }),
  ];

  const scrollToPrice = () => {
    document.getElementById('pricing-block')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <>
      <SEOHead
        title={seoTitle(`${name} Prüfung bestehen – Prüfungstraining & Simulation`)}
        description={`Bestehe deine ${chamber}-Prüfung ${name} sicher. Trainiere mit ${questions}+ Prüfungsaufgaben, realistischer Simulation und KI-Coach. Jetzt starten.`}
        canonical={`${SITE_URL}/pruefungstraining/${resolvedSlug}`}
        type="course"
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* ─── 1. HERO: Beruf + Outcome + CTA ─── */}
        <section className="py-10 sm:py-14 md:py-20 px-3 sm:px-4 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-accent/5 blur-[100px] pointer-events-none" />
          <div className="container mx-auto max-w-4xl relative z-10">
            <Breadcrumbs items={breadcrumbsUI} />

            {!isPublished && (
              <div className="mt-4 rounded-xl bg-muted/60 border border-border p-4 text-center">
                <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-primary text-sm font-semibold mb-2">
                  <Clock className="h-4 w-4" /> Coming Soon
                </div>
                <p className="text-sm text-muted-foreground">
                  Das Prüfungstraining für <strong>{name}</strong> wird gerade erstellt und ist in Kürze verfügbar.
                </p>
              </div>
            )}

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-display font-bold mt-6 mb-4 leading-[1.1]">
              Bestehe deine {chamber}-Abschlussprüfung als{' '}
              <span className="text-gradient">{name}</span>
            </h1>

            <p className="text-lg sm:text-xl text-muted-foreground mb-6 max-w-3xl">
              Trainiere schriftliche und mündliche Prüfungssituationen mit prüfungsnahen Aufgaben, Simulationen,
              KI-Coach und klarer Schwächenanalyse.
            </p>

            <div className="flex flex-wrap gap-3 mb-6">
              {isPublished ? (
                <Button
                  size="lg"
                  className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg"
                  onClick={() => {
                    scrollToPrice();
                    trackConversion({ event: 'cta_click', source: 'product_hero', label: 'start_training' });
                  }}
                >
                  <Target className="h-5 w-5 mr-2" /> Jetzt Prüfungstraining starten
                </Button>
              ) : (
                <Button size="lg" disabled className="opacity-60 rounded-xl h-14 px-8">
                  <Clock className="mr-2 h-5 w-5" /> Bald verfügbar
                </Button>
              )}
            </div>

            {/* Trust signals */}
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {[
                { icon: Shield, text: 'Einmalzahlung' },
                { icon: Clock, text: '12 Monate Zugriff' },
                { icon: CheckCircle2, text: 'Kein Abo' },
                { icon: Zap, text: 'Sofortiger Zugang' },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-1.5">
                  <Icon className="h-4 w-4 text-accent" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 2. SCHMERZ: Problemklarheit ─── */}
        <section className="py-10 sm:py-14 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-4">
              Viele lernen viel – aber <span className="text-gradient">nicht das Richtige</span>
            </h2>
            <p className="text-muted-foreground mb-6">
              Die häufigsten Gründe, warum Prüflinge unsicher in die {chamber}-Prüfung gehen:
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                'Zu viel allgemeine Theorie statt echte Prüfungssituationen',
                'Keine klare Einschätzung: „Bin ich prüfungsreif?"',
                'Unsicherheit bei mündlichen Prüfungsteilen',
                'Falsches Lernmaterial ohne Prüfungsbezug',
              ].map(pain => (
                <div key={pain} className="flex items-start gap-3 p-4 rounded-xl border border-destructive/20 bg-destructive/5">
                  <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <span className="text-sm">{pain}</span>
                </div>
              ))}
            </div>
            <p className="mt-6 text-base font-medium">
              Genau hier setzt ExamFit an – als intelligentes Prüfungstrainings-System.
            </p>
          </div>
        </section>

        {/* ─── 3. REFRAMING: Kein klassischer Kurs ─── */}
        <section className="py-10 sm:py-14 px-3 sm:px-4">
          <div className="container mx-auto max-w-3xl text-center">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-4">
              ExamFit ist <span className="text-gradient">kein klassischer Vorbereitungskurs</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Kein Video-Marathon. Kein PDF-Dschungel. Sondern ein intelligentes Prüfungstrainings-System
              für deine {chamber}-Abschlussprüfung als {name}.
            </p>
            <p className="mt-4 text-muted-foreground">
              Du trainierst nicht wahllos Inhalte, sondern genau die Aufgabenarten, Themen und
              Prüfungssituationen, die für deinen Beruf relevant sind.
            </p>
          </div>
        </section>

        {/* ─── 4. MODULE: Was enthalten ist ─── */}
        <section className="py-10 sm:py-14 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-3 text-center">
              Was im Prüfungstraining für {name} <span className="text-gradient">enthalten ist</span>
            </h2>
            <p className="text-muted-foreground text-center mb-8 max-w-2xl mx-auto">
              Alle Werkzeuge für deine {chamber}-Prüfung – in einem Zugang.
            </p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { icon: ClipboardCheck, title: 'Schriftliche Prüfungssimulation', text: 'Trainiere unter realistischen Bedingungen mit Zeitdruck, Bewertung und direktem Feedback.' },
                { icon: Mic, title: 'Mündliche Prüfung trainieren', text: 'Übe Fachgespräche und typische Prüfungssituationen mit strukturiertem KI-Feedback.' },
                { icon: MessageSquare, title: 'KI-Prüfungscoach', text: 'Lass dir schwierige Themen verständlich erklären und arbeite gezielt an Unsicherheiten.' },
                { icon: BookOpen, title: 'Prüfungswissen kompakt', text: 'Wiederhole relevante Inhalte strukturiert statt dich durch unnötige Theorie zu kämpfen.' },
                { icon: BarChart3, title: 'Adaptive Schwächenanalyse', text: 'Erkenne automatisch, welche Themen und Aufgabentypen dir noch Probleme machen.' },
                { icon: TrendingUp, title: 'Prüfungsreife-Indikator', text: 'Sieh in Echtzeit, wie bereit du für die Prüfung bist und wo du nachschärfen solltest.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="glass-card rounded-xl p-5 hover:border-primary/30 transition-colors">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-3">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{title}</h3>
                  <p className="text-xs text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>

            {isPublished && (
              <div className="text-center mt-6">
                <Button
                  size="lg"
                  className="gradient-primary text-primary-foreground rounded-xl"
                  onClick={() => {
                    scrollToPrice();
                    trackConversion({ event: 'cta_click', source: 'product_modules', label: 'start_training' });
                  }}
                >
                  Kurs starten <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* ─── 5. SO FUNKTIONIERT'S ─── */}
        <section className="py-10 sm:py-14 px-3 sm:px-4">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-8 text-center">
              So bereitest du dich mit ExamFit <span className="text-gradient">vor</span>
            </h2>
            <div className="space-y-4">
              {[
                'Du startest mit deinem Prüfungstraining für den passenden Beruf.',
                'Du bearbeitest prüfungsnahe Aufgaben und Simulationen.',
                'Du erhältst direkt Feedback und erkennst deine Schwächen.',
                'Du trainierst gezielt schriftliche und mündliche Prüfungssituationen.',
                'Du gehst strukturierter und sicherer in die Prüfung.',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-4 p-4 glass-card rounded-xl">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0">
                    {i + 1}
                  </div>
                  <span className="text-sm">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 6. BERUFSSPEZIFISCHER NUTZEN ─── */}
        <section className="py-10 sm:py-14 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-6">
              Warum ExamFit für <span className="text-gradient">{name}</span> besonders sinnvoll ist
            </h2>
            <ul className="space-y-3">
              {[
                `Du trainierst typische ${chamber}-Aufgabenformate statt allgemeiner Theorie`,
                `Du übst prüfungsnahe Fragestellungen für schriftliche und mündliche Prüfungsteile`,
                `Du erkennst schnell, in welchen Themenfeldern du noch Lücken hast`,
                `Du bereitest dich strukturierter auf die Abschlussprüfung vor`,
              ].map(point => (
                <li key={point} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <span className="text-sm">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ─── SEO Content from DB ─── */}
        {seoPage?.content_html && (
          <section className="py-10 px-3 sm:px-4">
            <div className="container mx-auto max-w-3xl prose prose-lg dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(seoPage.content_html, {
                ALLOWED_TAGS: ['h2','h3','h4','p','br','strong','em','ul','ol','li','blockquote','a','table','thead','tbody','tr','th','td','span','hr'],
                ALLOWED_ATTR: ['href','title','class','id','target','rel'],
                FORBID_TAGS: ['script','iframe','object','embed','style','form','h1'],
                ALLOW_DATA_ATTR: false,
              }) }}
            />
          </section>
        )}

        {/* ─── 7. PREIS / ANGEBOT ─── */}
        <section className="py-10 sm:py-14 px-3 sm:px-4" id="pricing-block">
          <div className="container mx-auto max-w-xl">
            <div className="glass-strong rounded-2xl p-6 sm:p-8 text-center border border-primary/20 relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-5" />
              <div className="relative z-10">
                <h2 className="text-xl sm:text-2xl font-display font-bold mb-2">
                  Komplett-Zugang für deine Prüfungsvorbereitung
                </h2>
                <div className="text-4xl font-bold text-primary mb-1">{PRICING.defaultPrice}</div>
                <p className="text-sm text-muted-foreground mb-6">einmalig · {PRICING.defaultAccess} Zugriff · {PRICING.noSubscription}</p>

                <ul className="text-left space-y-2 mb-6 max-w-xs mx-auto">
                  {[
                    'Schriftliche Prüfungssimulation',
                    'Mündliche Prüfung trainieren',
                    'KI-Prüfungscoach',
                    'Prüfungswissen kompakt',
                    'Adaptive Schwächenanalyse',
                    'Prüfungsreife-Indikator',
                  ].map(item => (
                    <li key={item} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>

                {isPublished ? (
                  <Link to="/shop">
                    <Button
                      size="lg"
                      className="w-full gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 text-lg"
                      onClick={() => trackConversion({ event: 'checkout_start', source: 'product_pricing', label: cert.slug })}
                    >
                      Jetzt Prüfungstraining starten – {PRICING.defaultPrice}
                    </Button>
                  </Link>
                ) : (
                  <Button size="lg" disabled className="w-full opacity-60 rounded-xl h-14">
                    Bald verfügbar
                  </Button>
                )}

                <p className="text-xs text-muted-foreground mt-3">
                  Deutlich günstiger als klassische {chamber}-Vorbereitungskurse ({PRICING.anchor.ihkRange})
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 8. FAQ ─── */}
        <section className="py-10 sm:py-14 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-2xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-6 text-center">
              Häufige Fragen zum Prüfungstraining {name}
            </h2>
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger
                    onClick={() => trackConversion({ event: 'faq_expand', source: 'product_page', label: item.question })}
                  >
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent>{item.answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ─── 9. RELATED / INTERNAL LINKS ─── */}
        {relatedCerts.length > 0 && (
          <section className="py-10 px-3 sm:px-4">
            <div className="container mx-auto max-w-4xl">
              <h2 className="text-xl font-display font-bold mb-4">Verwandte Prüfungstrainings</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {relatedCerts.map(rel => (
                  <Link key={rel.id} to={`/pruefungstraining/${rel.slug}`} className="group">
                    <Card className="hover:border-primary/30 transition-colors">
                      <CardContent className="py-3 flex items-center justify-between">
                        <span className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-1">{rel.title}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ─── 10. ABSCHLUSS-CTA ─── */}
        <section className="py-10 sm:py-14 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-3xl">
            <div className="glass-strong rounded-2xl p-6 sm:p-10 text-center relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-10" />
              <div className="relative z-10">
                <h2 className="text-2xl sm:text-3xl font-display font-bold mb-4">
                  Bereit für die {chamber}-Prüfung {name}?
                </h2>
                {isPublished ? (
                  <>
                    <p className="text-muted-foreground mb-6">
                      Starte jetzt – {PRICING.defaultPrice} für {PRICING.defaultAccess} Prüfungstraining.
                    </p>
                    <Link to="/shop">
                      <Button
                        size="lg"
                        className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg"
                        onClick={() => trackConversion({ event: 'cta_click', source: 'product_bottom', label: 'start_training' })}
                      >
                        Jetzt mit dem passenden Prüfungstraining starten
                      </Button>
                    </Link>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Dieses Prüfungstraining wird gerade erstellt und ist bald verfügbar.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Cross-links ─── */}
        <nav className="py-6 px-3 sm:px-4 border-t">
          <div className="container mx-auto max-w-4xl flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground">Weitere:</span>
            {[
              { label: 'Alle Prüfungstrainings', href: '/pruefungstraining' },
              { label: 'Ausbildung', href: '/pruefungstraining/ausbildung' },
              { label: 'Fachwirt', href: '/pruefungstraining/fachwirt' },
              { label: 'Meister', href: '/pruefungstraining/meister' },
              { label: 'Sachkunde', href: '/pruefungstraining/sachkunde' },
            ].map(link => (
              <Link key={link.href} to={link.href} className="text-sm text-primary hover:underline">{link.label}</Link>
            ))}
          </div>
        </nav>

        {/* Sticky CTA for product page */}
        <ProductStickyCTA name={name} price={PRICING.defaultPrice} isPublished={!!isPublished} certSlug={cert.slug} />
      </div>
    </>
  );
};

/** Product-page sticky CTA with price (only on product pages) */
function ProductStickyCTA({ name, price, isPublished, certSlug }: { name: string; price: string; isPublished: boolean; certSlug: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrollPct = docHeight > 0 ? window.scrollY / docHeight : 0;
      setVisible(scrollPct >= 0.15 && scrollPct <= 0.9);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible || !isPublished) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4 animate-fade-in">
      <div className="container mx-auto max-w-2xl">
        <div className="glass-strong rounded-2xl px-4 py-3 flex items-center justify-between gap-3 shadow-lg border border-primary/20">
          <div className="min-w-0">
            <span className="text-sm font-semibold block truncate">Prüfungstraining {name}</span>
            <span className="text-xs text-muted-foreground">{price} · Kein Abo · 12 Monate</span>
          </div>
          <Link to="/shop">
            <Button
              size="sm"
              className="gradient-primary text-primary-foreground rounded-xl h-9 px-4 text-sm whitespace-nowrap"
              onClick={() => trackConversion({ event: 'cta_click', source: 'product_sticky', label: certSlug })}
            >
              Starten – {price}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default PruefungstrainingDetailPage;
