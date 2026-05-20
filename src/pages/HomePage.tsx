import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';
import { SEOHead } from '@/components/seo/SEOHead';
import { generateFAQSchema, generateCourseListSchema, SITE_URL, seoTitle } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import { StickyCTA } from '@/components/marketing/StickyCTA';
import { CourseFinderSection } from '@/components/marketing/CourseFinderSection';
import { HowExamFitWorksSection } from '@/components/landing/HowExamFitWorksSection';
import { DemoGallery } from '@/components/landing/demos/DemoGallery';
import { HeroAccent } from '@/components/marketing/HeroAccent';

import { trackConversion } from '@/lib/seo-tracking';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  ArrowRight,
  CheckCircle,
  Shield,
  Clock,
  Brain,
  Mic,
  TrendingUp,
  Target,
  GraduationCap,
  Building2,
  BookOpen,
  Zap,
  Search,
  ClipboardCheck,
  BarChart3,
  MessageSquare,
} from 'lucide-react';

/* ── FAQ: conversion-orientiert ── */
const FAQ_ITEMS = [
  { question: 'Für welche Berufe gibt es Prüfungstrainings?', answer: 'ExamFit bietet Prüfungstrainings für zahlreiche IHK-Ausbildungsberufe – von Kaufmann für Büromanagement über Fachinformatiker bis hin zu Industriekaufmann. Nutze die Suche oben, um deinen Beruf zu finden.' },
  { question: 'Wie finde ich den richtigen Kurs?', answer: 'Gib deinen Beruf oder deine Prüfung in die Suche ein oder filtere nach Bereich (z. B. Kaufmännisch, IT, Logistik). Du gelangst direkt zur passenden Kursseite mit allen Details.' },
  { question: 'Ist ExamFit ein Abo?', answer: `Nein. Du zahlst einmalig ab ${PRICING.defaultPrice} und erhältst ${PRICING.defaultAccess} Zugriff auf das komplette Prüfungstraining. ${PRICING.noSubscription}, keine versteckten Kosten.` },
  { question: 'Was ist im Prüfungstraining enthalten?', answer: 'Jedes Training enthält prüfungsnahe Simulationen (schriftlich), mündliches Prüfungstraining mit KI-Feedback, adaptive Schwächenanalyse, kompaktes Prüfungswissen und einen Prüfungsreife-Indikator.' },
  { question: 'Kann ich schriftliche und mündliche Prüfung trainieren?', answer: 'Ja. ExamFit deckt beide Prüfungsteile ab: schriftliche Prüfungssimulationen mit Zeitlimit und Auswertung sowie mündliches Fachgespräch-Training mit KI-Coach.' },
  { question: 'Gibt es einen Prüfungsreife-Test für meinen Beruf?', answer: 'Ja – auf jeder Kursseite findest du einen kostenlosen Prüfungsreife-Check mit 5 Fragen, der dir zeigt, wie gut du aktuell vorbereitet bist.' },
  { question: 'Gibt es Lizenzen für Betriebe?', answer: 'Ja. ExamFit bietet Team-Lizenzen für Betriebe ab 5 Azubis mit Mengenrabatt. So können Ausbilder die Prüfungsreife ihrer Auszubildenden strukturiert begleiten.' },
  { question: 'Kann ExamFit in Berufsschulen eingesetzt werden?', answer: 'Ja. ExamFit eignet sich als prüfungsnahe Ergänzung zum Berufsschulunterricht – ohne den Lehrplan zu ersetzen. Sprechen Sie uns für institutionelle Konditionen an.' },
];

export default function HomePage() {
  useEffect(() => {
    trackConversion({ event: 'page_view', source: 'homepage' });

    const thresholds = [25, 50, 75];
    const fired = new Set<number>();
    const onScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      const pct = Math.round((window.scrollY / docHeight) * 100);
      for (const t of thresholds) {
        if (pct >= t && !fired.has(t)) {
          fired.add(t);
          trackConversion({ event: 'scroll_depth', source: 'homepage', label: `${t}pct`, value: t });
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <SEOHead
        title={seoTitle("Prüfungsreife testen — IHK-Prüfung gezielt vorbereiten")}
        description="Finde in 4 Minuten heraus, wie prüfungsreif du bist. ExamFit analysiert Schwächen, erstellt deinen Lernplan und trainiert schriftlich + mündlich bis zur Prüfung. Komplettpaket 24,90 €, kein Abo."
        canonical={`${SITE_URL}/`}
        type="website"
        structuredData={[
          generateFAQSchema(FAQ_ITEMS),
          generateCourseListSchema([
            { name: 'Prüfungstraining', url: `${SITE_URL}/shop`, description: 'Komplett-Prüfungstraining für IHK-Ausbildungsberufe', price: 29.90 },
          ]),
        ]}
      />
      <div className="min-h-screen">
        {/* ─── 1. Hero: Prüfungsreife-Positionierung ─── */}
        <section className="pt-8 pb-12 sm:py-16 md:py-24 px-3 sm:px-4 relative overflow-hidden">
          <div className="hidden sm:block absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" aria-hidden />

          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6">
              <ClipboardCheck className="h-4 w-4 text-accent" />
              <span className="text-sm text-muted-foreground">
                Adaptives Prüfungssystem · IHK · HWK · Fortbildung
              </span>
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold mb-5 leading-[1.1]">
              Finde in 4 Minuten heraus,{' '}
              <HeroAccent glow={false}>wie prüfungsreif du bist.</HeroAccent>
            </h1>

            <p className="text-base sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-snug">
              ExamFit analysiert deine Schwächen, erstellt deinen Lernplan und trainiert dich
              mit Lernkurs, Prüfungsfragen, KI-Tutor und mündlicher Simulation bis zur
              Abschlussprüfung.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/pruefungscheck" className="contents">
                <Button
                  size="lg"
                  className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow-lg transition-all rounded-xl h-14 px-8 text-base sm:text-lg group"
                  data-cta-location="hero_primary"
                  onClick={() => trackConversion({ event: 'cta_click', source: 'hero', label: 'pruefungsreife_test' })}
                >
                  <ClipboardCheck className="h-5 w-5 mr-2" />
                  Kostenlos Prüfungsreife testen
                </Button>
              </Link>
              <Link to="/shop">
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-xl h-14 px-8 text-base sm:text-lg border-border hover:bg-muted/50 group w-full sm:w-auto"
                  data-cta-location="hero_secondary"
                  onClick={() => trackConversion({ event: 'cta_click', source: 'hero', label: 'bundle_view' })}
                >
                  Komplettpaket ansehen
                </Button>
              </Link>
            </div>

            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-8 text-xs sm:text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-accent" />
                <span>Kein Abo</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-accent" />
                <span>12 Monate Zugang</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-accent" />
                <span>Prüfungstraining nach Rahmenplan</span>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 2. So funktioniert ExamFit (4 Schritte) ─── */}
        <HowExamFitWorksSection />

        {/* ─── 3. Produkt-Mockups: Score, Mastery, Aufgabe, KI, Mündlich ─── */}
        <DemoGallery />

        {/* ─── 4. Kursfinder ─── */}
        <CourseFinderSection />

        {/* ─── 5. Konkrete Ergebnisversprechen (Outcomes statt Marketing) ─── */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-3 leading-tight">
              Was du nach 4 Wochen{' '}
              <span className="text-gradient">konkret kannst</span>
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto mb-8 leading-snug">
              Keine generischen Versprechen — sondern messbare Prüfungsfähigkeit.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {[
                { icon: Target, title: 'Du weißt, welche Themen dich Punkte kosten.', text: 'Die Schwächenanalyse priorisiert deinen Lernplan automatisch.' },
                { icon: ClipboardCheck, title: 'Du übst Aufgaben im Prüfungsformat.', text: 'Originale IHK-Logik mit Zeitlimit, Punkten und Erklärung.' },
                { icon: Mic, title: 'Du bekommst Feedback wie in der Prüfung.', text: 'Mündliche Simulation bewertet Fachlichkeit, Struktur und Praxis.' },
                { icon: Brain, title: 'Du erkennst typische Fallen vorher.', text: 'KI-Tutor zeigt dir die häufigsten Fehler — bevor du sie machst.' },
              ].map(({ icon: Icon, title, text }) => (
                <div
                  key={title}
                  className="rounded-2xl glass-card p-5 sm:p-6 text-left hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/15 shrink-0">
                      <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm sm:text-base text-foreground leading-snug mb-1">
                        {title}
                      </h3>
                      <p className="text-xs sm:text-sm text-muted-foreground leading-snug">
                        {text}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 6. Für wen ist ExamFit? ─── */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4">
          <div className="container mx-auto max-w-5xl">
            <div className="text-center mb-8 md:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4">
                Passend für <span className="text-gradient">deine Rolle</span>
              </h2>
              <p className="text-muted-foreground">Ein System – drei Perspektiven.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              {[
                { to: '/pruefungstraining-azubis', icon: GraduationCap, color: 'text-primary', title: 'Für Auszubildende', text: 'Trainiere gezielt für deine Abschlussprüfung – prüfungsnah, strukturiert, messbar.' },
                { to: '/pruefungstraining-betriebe', icon: Building2, color: 'text-accent', title: 'Für Betriebe', text: 'Mache Prüfungsreife sichtbar und unterstütze Azubis strukturiert bei der Vorbereitung.' },
                { to: '/pruefungstraining-berufsschulen', icon: BookOpen, color: 'text-success', title: 'Für Berufsschulen', text: 'Ergänze bestehende Lernangebote mit prüfungsnahem Training – ohne den Unterricht zu ersetzen.' },
              ].map(({ to, icon: Icon, color, title, text }) => (
                <Link key={to} to={to} className="glass-card rounded-2xl p-6 sm:p-8 group hover:border-primary/30 transition-all duration-300" onClick={() => trackConversion({ event: 'role_card_click', source: 'homepage', label: title })}>
                  <Icon className={`h-10 w-10 ${color} mb-4`} />
                  <h3 className="text-lg font-display font-bold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{text}</p>
                  <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                    Mehr erfahren <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 7. Vertrauenssignale ─── */}
        <section className="py-10 sm:py-12 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl">
            <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
              {[
                { icon: Shield, text: 'Kein Abo' },
                { icon: Clock, text: '12 Monate Zugriff' },
                { icon: Target, text: 'Prüfungsnah' },
                { icon: BookOpen, text: 'Basierend auf Rahmenplan' },
                { icon: CheckCircle, text: 'Sichere Zahlung' },
                { icon: Zap, text: 'Sofortiger Zugang' },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 px-4 py-2 rounded-xl glass-subtle">
                  <Icon className="h-4 w-4 text-accent" />
                  <span className="text-sm font-medium">{text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 8. FAQ ─── */}
        <section id="faq" className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 scroll-mt-20">
          <div className="container mx-auto max-w-2xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-8 text-center">
              Häufige Fragen
            </h2>
            <Accordion type="single" collapsible className="w-full">
              {FAQ_ITEMS.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger
                    onClick={() => trackConversion({ event: 'faq_expand', source: 'homepage', label: item.question })}
                  >
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent>{item.answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ─── 9. Abschluss-CTA ─── */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl">
            <div className="glass-strong rounded-3xl p-6 sm:p-8 md:p-12 text-center relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-10" />
              <div className="relative z-10">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
                  <Search className="h-8 w-8 text-accent" />
                </div>
                <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
                  Starte mit dem passenden Kurs für deinen Beruf
                </h2>
                <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                  Finde dein Prüfungstraining und bereite dich gezielt auf deine Abschlussprüfung vor.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    size="lg"
                    className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 group"
                    onClick={() => {
                      document.getElementById('kursfinder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      trackConversion({ event: 'bottom_cta_click', source: 'bottom_cta', label: 'find_course' });
                    }}
                  >
                    <Search className="h-5 w-5 mr-2" />
                    Beruf suchen
                  </Button>
                  <Link to="/berufe">
                    <Button
                      size="lg"
                      variant="outline"
                      className="rounded-xl h-14 px-8"
                      onClick={() => trackConversion({ event: 'cta_click', source: 'bottom_cta', label: 'all_courses' })}
                    >
                      Alle Kurse ansehen
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <StickyCTA />
      </div>
    </>
  );
}
