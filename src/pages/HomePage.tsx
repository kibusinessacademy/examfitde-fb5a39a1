import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';
import { SEOHead } from '@/components/seo/SEOHead';
import { generateFAQSchema, generateCourseListSchema, SITE_URL, seoTitle } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import { StickyCTA } from '@/components/marketing/StickyCTA';
import { CourseFinderSection } from '@/components/marketing/CourseFinderSection';
import { PopularCoursesSection } from '@/components/marketing/PopularCoursesSection';
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
        title={seoTitle("IHK-Prüfung bestehen: Prüfungstraining für Ausbildung & Beruf")}
        description="Finde dein Prüfungstraining für die IHK-Abschlussprüfung. Suche nach Beruf, trainiere schriftliche und mündliche Prüfungssituationen mit KI-Coach. Ab 29,90 € einmalig."
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
        {/* ─── 1. Hero: Discovery + Suche ─── */}
        <section className="py-12 sm:py-16 md:py-24 px-3 sm:px-4 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />

          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <ClipboardCheck className="h-4 w-4 text-accent" />
              <span className="text-sm text-muted-foreground">Beruf finden · Prüfungsnah trainieren · Sicher bestehen</span>
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold mb-5 animate-fade-in leading-[1.1]">
              Bestehe deine IHK-Prüfung mit dem{' '}
              <span className="text-gradient text-glow">passenden Prüfungstraining</span>
            </h1>

            <p className="text-base sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Finde deinen Beruf, vergleiche passende Kurse und trainiere schriftliche und mündliche Prüfungssituationen gezielt.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Button
                size="lg"
                className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow-lg transition-all rounded-xl h-14 px-8 text-lg group"
                onClick={() => {
                  document.getElementById('kursfinder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  trackConversion({ event: 'hero_scroll_to_finder', source: 'hero', label: 'find_course' });
                }}
              >
                <Search className="h-5 w-5 mr-2" />
                Kurs finden
              </Button>
              <Link to="/berufe">
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50 group"
                  onClick={() => trackConversion({ event: 'cta_click', source: 'hero', label: 'all_courses' })}
                >
                  Alle Berufe ansehen
                </Button>
              </Link>
            </div>

            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-8 text-xs sm:text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-accent" />
                <span>Einmalzahlung</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-accent" />
                <span>12 Monate Zugriff</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-accent" />
                <span>Kein Abo</span>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 2. Kursfinder mit Suche + Filter ─── */}
        <CourseFinderSection />

        {/* ─── 3. Beliebte Berufe / Top-Kurse ─── */}
        <PopularCoursesSection />

        {/* ─── 4. So funktioniert ExamFit ─── */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4 sm:mb-6">
              So bringt dich ExamFit sicherer{' '}
              <span className="text-gradient">durch die Prüfung</span>
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
              Drei Schritte von der ersten Standortbestimmung bis zur prüfungssicheren Vorbereitung.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              {[
                { icon: Target, title: 'Schwächen erkennen', text: 'Sieh, welche Themen und Aufgabentypen dir noch schwerfallen – und wo dein Training ansetzen muss.' },
                { icon: Brain, title: 'Prüfungsnah trainieren', text: 'Übe mit Aufgaben und Simulationen, die auf deine Abschlussprüfung ausgerichtet sind – schriftlich und mündlich.' },
                { icon: TrendingUp, title: 'Sicherer bestehen', text: 'Gehe strukturierter, klarer und mit mehr Prüfungsroutine in die Prüfung.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-6 text-center hover:border-primary/30 transition-colors">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-muted/50 mb-4">
                    <Icon className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="font-display font-semibold text-lg mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 5. Was im System enthalten ist ─── */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4">
              Alles, was du für deine Prüfung brauchst –{' '}
              <span className="text-gradient">in einem System</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-10">
              Kein Zusammensuchen, kein Abo-Chaos. Ein Zugang, alle Werkzeuge.
            </p>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {[
                { icon: ClipboardCheck, title: 'Prüfungssimulation schriftlich', text: 'Realistische Simulation mit Zeitlimit und Auswertung.' },
                { icon: Mic, title: 'Mündliche Prüfung trainieren', text: 'Fachgespräch üben mit KI-Feedback zu deinen Antworten.' },
                { icon: MessageSquare, title: 'KI-Prüfungscoach', text: 'Gezielte Erklärungen und Hilfe bei schwierigen Themen.' },
                { icon: BookOpen, title: 'Prüfungswissen kompakt', text: 'Strukturiertes Wissen orientiert am Rahmenplan.' },
                { icon: BarChart3, title: 'Adaptive Schwächenanalyse', text: 'Automatische Erkennung deiner Wissenslücken.' },
                { icon: TrendingUp, title: 'Prüfungsreife-Indikator', text: 'Sieh in Echtzeit, wie bereit du für die Prüfung bist.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="glass-card rounded-xl p-4 sm:p-5 text-left hover:border-primary/30 transition-colors">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-3">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{title}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground">{text}</p>
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
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4">
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
