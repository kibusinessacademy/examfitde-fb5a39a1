import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useEffect } from 'react';
import { SEOHead } from '@/components/seo/SEOHead';
import { generateFAQSchema, generateCourseListSchema, SITE_URL, seoTitle } from '@/lib/seo';
import { Testimonials } from '@/components/marketing/Testimonials';
import { StickyCTA } from '@/components/marketing/StickyCTA';
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
  Sparkles,
  Zap,
  ClipboardCheck,
} from 'lucide-react';

const FAQ_ITEMS = [
  { question: 'Wie bestehe ich die IHK Abschlussprüfung?', answer: 'Um die IHK Abschlussprüfung zu bestehen, solltest du mit echten Prüfungsfragen trainieren, Prüfungssimulationen durchführen und gezielt deine Schwächen analysieren. ExamFit bietet dir alle drei Komponenten in einem intelligenten Prüfungstraining – inklusive KI-Prüfungscoach.' },
  { question: 'Wie läuft die IHK Abschlussprüfung ab?', answer: 'Die IHK-Abschlussprüfung besteht aus einem schriftlichen Teil (Multiple Choice + offene Aufgaben) und einem mündlichen Fachgespräch. ExamFit bereitet dich auf beide Teile vor – mit realistischer Prüfungssimulation und KI-gestütztem Fachgespräch-Training.' },
  { question: 'Ist ExamFit ein Abo?', answer: 'Nein. Du zahlst einmalig 39 € und erhältst 12 Monate Zugriff auf das komplette IHK-Prüfungstraining – inklusive Prüfungssimulation, KI-Coach und mündliche Prüfung. Kein Abo, keine versteckten Kosten.' },
  { question: 'Welche typischen Fehler kann ich bei der IHK Prüfung vermeiden?', answer: 'Die häufigsten Fehler bei der IHK Prüfung: zu spät mit der Vorbereitung anfangen, nur Theorie lernen ohne Übung, keine Prüfungssimulation machen und Zeiteinteilung nicht trainieren. ExamFit analysiert deine Schwächen und trainiert gezielt die prüfungsrelevanten Themen.' },
  { question: 'Gibt es IHK Prüfungsfragen mit Lösungen kostenlos?', answer: 'Ja – starte den kostenlosen Prüfungsreife-Check und teste dein Wissen mit echten prüfungsnahen Aufgaben. Für das vollständige Training mit hunderten Fragen und Lösungen gibt es das Prüfungstraining ab 39 €.' },
  { question: 'Kann ich die IHK Prüfung online simulieren?', answer: 'Ja. ExamFit bietet eine realistische IHK-Prüfungssimulation mit Zeitlimit, Gewichtung nach Prüfungsteilen und Bestehensindikator – genau wie in der echten IHK-Abschlussprüfung.' },
];

export default function HomePage() {
  const { user } = useAuth();

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
        title={seoTitle("Prüfung bestehen: Online Prüfungstraining für Ausbildung & Studium")}
        description="Prüfungstraining online: IHK-Abschlussprüfung oder Klausur im Studium – mit Prüfungssimulation, adaptivem Training & KI-Coach sicher bestehen. 39 € einmalig."
        canonical={`${SITE_URL}/`}
        type="website"
        structuredData={[
          generateFAQSchema(FAQ_ITEMS),
          generateCourseListSchema([
            { name: 'Prüfungstraining', url: `${SITE_URL}/shop`, description: 'Komplett-Prüfungstraining für IHK-Ausbildungsberufe und Studiengänge', price: 39 },
          ]),
        ]}
      />
      <div className="min-h-screen">
        {/* ─── 1. Hero ─── */}
        <section className="py-12 sm:py-16 md:py-24 px-3 sm:px-4 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />

          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <ClipboardCheck className="h-4 w-4 text-accent" />
              <span className="text-sm text-muted-foreground">Prüfungsnah trainieren · Schwächen erkennen · sicherer in die Prüfung gehen</span>
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold mb-5 animate-fade-in leading-[1.1]">
              Prüfung bestehen:{' '}
              <span className="text-gradient text-glow">Online Training mit echten Aufgaben</span>
            </h1>

            <p className="text-base sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Ob IHK-Abschlussprüfung oder Klausur im Studium – bereite dich gezielt vor mit Prüfungssimulation, adaptivem Training und KI-Prüfungscoach. Kostenlos testen oder direkt starten.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/pruefungsreife-check">
                <Button
                  size="lg"
                  className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow-lg transition-all rounded-xl h-14 px-8 text-lg group"
                  onClick={() => trackConversion({ event: 'cta_click', source: 'hero', label: 'primary_check' })}
                >
                  Prüfungsreife kostenlos testen
                  <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link to="/shop">
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50 group"
                  onClick={() => trackConversion({ event: 'cta_click', source: 'hero', label: 'secondary_shop' })}
                >
                  Prüfungstraining ansehen
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

        {/* ─── 2. Prüfungsreife-Check Teaser ─── */}
        <section className="py-8 sm:py-10 px-3 sm:px-4">
          <div className="container mx-auto max-w-4xl">
            <Link
              to="/pruefungsreife-check"
              className="block"
              onClick={() => trackConversion({ event: 'cta_click', source: 'check_banner', label: 'clicked' })}
            >
              <div className="glass-card rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-4 sm:gap-6 hover:border-accent/40 transition-colors group">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center">
                  <ClipboardCheck className="h-7 w-7 text-accent" />
                </div>
                <div className="text-center sm:text-left flex-1">
                  <h3 className="text-lg font-display font-bold mb-1">Kostenloser Prüfungsreife-Check</h3>
                  <p className="text-sm text-muted-foreground">
                    Finde in wenigen Minuten heraus, wie gut du aktuell auf deine Prüfung vorbereitet bist — ohne Anmeldung.
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-accent group-hover:translate-x-1 transition-all flex-shrink-0" />
              </div>
            </Link>
          </div>
        </section>

        {/* ─── 3. Produktnutzen ─── */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4 sm:mb-6">
              Prüfungsvorbereitung online:{' '}
              <span className="text-gradient">Gezielt trainieren statt blind lernen</span>
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
              Prüfungstraining für Azubis und Studierende – mit adaptiver Schwächenanalyse, echten Prüfungsaufgaben und einem System, das dich Schritt für Schritt prüfungsreif macht.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              {[
                { icon: '🔍', title: 'Prüfungsnah', text: 'Du trainierst mit Aufgabenformaten, die sich an echten Prüfungsanforderungen orientieren.' },
                { icon: '🎯', title: 'Gezielt', text: 'Du erkennst schneller, welche Themen für dich kritisch sind.' },
                { icon: '📐', title: 'Strukturiert', text: 'Du trainierst nicht blind, sondern mit klarem Fokus auf Bestehen.' },
              ].map(({ icon, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-6 text-center hover:border-primary/30 transition-colors">
                  <div className="text-4xl mb-4">{icon}</div>
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 4. So funktioniert's ─── */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-8 md:mb-16">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4">
                Prüfungstraining für Ausbildung: <span className="text-gradient">So wirst du prüfungsreif</span>
              </h2>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
              {[
                { icon: Brain, color: 'text-primary', title: 'Adaptives Training', text: 'Das System erkennt deine Schwächen und trainiert gezielt.' },
                { icon: Mic, color: 'text-accent', title: 'Mündliche Prüfung', text: 'Übe das Fachgespräch mit KI-Feedback zu deinen Antworten.' },
                { icon: TrendingUp, color: 'text-success', title: 'Fortschritt messen', text: 'Der Prüfungsreife-Indikator zeigt dir in Echtzeit, wo du stehst.' },
                { icon: Target, color: 'text-warning', title: 'Nach Rahmenplan', text: 'Alle Inhalte basieren auf dem offiziellen Ausbildungsrahmenplan.' },
              ].map(({ icon: Icon, color, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-5 sm:p-6 text-center hover:border-primary/30 transition-colors">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 mb-4">
                    <Icon className={`h-6 w-6 ${color}`} />
                  </div>
                  <h3 className="font-semibold mb-2 text-sm sm:text-base">{title}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 5. Product Proof ─── */}
        <Testimonials />

        {/* ─── 6. Pricing ─── */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4">
              Ein Produkt. Ein Ziel:{' '}
              <span className="text-gradient">Deine Prüfung bestehen.</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-12">
              ExamFit bündelt prüfungsnahes Training, Simulationen und gezielte Vorbereitung in einem System.
            </p>

            <div className="glass-card rounded-2xl p-5 sm:p-8 md:p-12 border-2 border-primary/30 max-w-2xl mx-auto relative overflow-hidden">
              <div className="absolute top-4 right-4 flex items-center gap-1 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium">
                <Sparkles className="h-3 w-3" />
                Komplett-Zugang
              </div>

              <div className="flex items-baseline gap-2 justify-center mb-6 mt-4 sm:mt-0">
                <span className="text-4xl sm:text-5xl font-display font-bold text-gradient">39 €</span>
                <span className="text-muted-foreground">einmalig · 12 Monate</span>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 text-left mb-8">
                {[
                  'Prüfungssimulation (schriftlich)',
                  'Mündliche Prüfung trainieren',
                  'KI-Prüfungscoach',
                  'Prüfungswissen kompakt',
                  'Adaptive Schwächenanalyse',
                  'Prüfungsreife-Indikator',
                ].map(feature => (
                  <div key={feature} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-success flex-shrink-0" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>

              <Link to="/shop">
                <Button
                  size="lg"
                  className="w-full gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 text-lg group"
                  onClick={() => trackConversion({ event: 'cta_click', source: 'pricing', label: 'buy_click' })}
                >
                  Prüfungstraining starten
                  <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>

              <p className="text-xs text-muted-foreground mt-3">39 € einmalig · 12 Monate Zugriff · kein Abo</p>
            </div>
          </div>
        </section>

        {/* ─── 7. Zielgruppen ─── */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-5xl">
            <div className="text-center mb-8 md:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4">
                Ein Produkt – <span className="text-gradient">drei Perspektiven</span>
              </h2>
              <p className="text-muted-foreground">Gleiches System, passende Argumente für jede Rolle.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              {[
                { to: '/pruefungstraining-azubis', icon: GraduationCap, color: 'text-primary', title: 'Für Auszubildende', text: 'Prüfung simulieren, Schwächen erkennen, sicher bestehen.' },
                { to: '/pruefungstraining-betriebe', icon: Building2, color: 'text-accent', title: 'Für Ausbildungsbetriebe', text: 'Prüfungsreife der Azubis mess- und steuerbar machen.' },
                { to: '/pruefungstraining-institutionen', icon: BookOpen, color: 'text-success', title: 'Für Berufsschulen & IHK', text: 'Prüfungskonforme Ergänzung, nicht Ersatz des Unterrichts.' },
              ].map(({ to, icon: Icon, color, title, text }) => (
                <Link key={to} to={to} className="glass-card rounded-2xl p-6 sm:p-8 group hover:border-primary/30 transition-all duration-300">
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

        {/* ─── 9. Final CTA ─── */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl">
            <div className="glass-strong rounded-3xl p-6 sm:p-8 md:p-12 text-center relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-10" />
              <div className="relative z-10">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
                  <Zap className="h-8 w-8 text-accent" />
                </div>
                <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
                  Starte jetzt dein Prüfungstraining
                </h2>
                <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                  Einmalig zahlen, 12 Monate trainieren. Kein Abo, keine versteckten Kosten.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link to="/pruefungsreife-check">
                    <Button
                      size="lg"
                      className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 group"
                      onClick={() => trackConversion({ event: 'cta_click', source: 'bottom_cta', label: 'primary_check' })}
                    >
                      Prüfungsreife kostenlos testen
                      <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </Link>
                  <Link to="/shop">
                    <Button
                      size="lg"
                      variant="outline"
                      className="rounded-xl h-14 px-8"
                      onClick={() => trackConversion({ event: 'cta_click', source: 'bottom_cta', label: 'secondary_shop' })}
                    >
                      Prüfungstraining ansehen – 39 €
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
