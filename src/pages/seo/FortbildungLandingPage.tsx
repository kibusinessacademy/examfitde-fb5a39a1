import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle, generateFAQSchema } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import {
  ArrowRight,
  CheckCircle,
  Award,
  Brain,
  Target,
  Clock,
  Shield,
  TrendingUp,
  Briefcase,
  BookOpen,
  Mic,
  Star,
  Zap,
} from 'lucide-react';

const QUALIFICATIONS = [
  { title: 'Wirtschaftsfachwirt/in', dqr: 'DQR 6', popular: true },
  { title: 'Industriefachwirt/in', dqr: 'DQR 6', popular: true },
  { title: 'Handelsfachwirt/in', dqr: 'DQR 6', popular: true },
  { title: 'Geprüfter Betriebswirt/in', dqr: 'DQR 7', popular: false },
  { title: 'Bilanzbuchhalter/in', dqr: 'DQR 6', popular: false },
  { title: 'Industriemeister/in', dqr: 'DQR 6', popular: false },
];

const FEATURES = [
  { icon: Target, title: 'Prüfungssimulation', desc: 'Realistische IHK-Fortbildungsprüfung mit Zeitlimit und Bestehensindikator.' },
  { icon: Brain, title: 'KI-Prüfungscoach', desc: 'Gezielte Schwächenanalyse und individuelle Lernempfehlungen.' },
  { icon: Mic, title: 'Mündliche Prüfung üben', desc: 'Fachgespräch-Simulation mit KI-gestütztem Feedback.' },
  { icon: BookOpen, title: 'Prüfungswissen kompakt', desc: 'Strukturierte Zusammenfassungen aller prüfungsrelevanten Themen.' },
  { icon: TrendingUp, title: 'Adaptive Schwächenanalyse', desc: 'Dein Lernfortschritt im Blick – gezielte Wiederholung schwacher Themen.' },
  { icon: Shield, title: 'Prüfungsreife-Indikator', desc: 'Objektive Einschätzung: Bist du bereit für die Prüfung?' },
];

const FAQS = [
  {
    question: 'Welche Fortbildungsprüfungen werden unterstützt?',
    answer: 'ExamFit deckt IHK-Fortbildungsprüfungen ab: Fachwirt, Betriebswirt, Bilanzbuchhalter, Meister und weitere. Die Inhalte passen sich automatisch an deine gewählte Prüfung an.',
  },
  {
    question: 'Was kostet das Fortbildungs-Prüfungstraining?',
    answer: `Das komplette Prüfungstraining kostet ${PRICING.defaultPrice} einmalig – kein Abo, ${PRICING.defaultAccess} Zugang zu allen Funktionen.`,
  },
  {
    question: 'Kann ich neben dem Beruf trainieren?',
    answer: 'Ja. ExamFit ist für berufsbegleitende Vorbereitung konzipiert: flexible Lerneinheiten, mobile-optimiert, jederzeit pausierbar.',
  },
  {
    question: 'Wie unterscheidet sich ExamFit von klassischen Vorbereitungskursen?',
    answer: `Klassische Kurse kosten ${PRICING.anchor.ihkRange} und bieten feste Termine. ExamFit ist flexibel, adaptiv und kostet nur ${PRICING.defaultPrice} einmalig.`,
  },
  {
    question: 'Gibt es Team-Lizenzen für Unternehmen?',
    answer: 'Ja. Ab 10 Lizenzen gibt es Mengenrabatte. Betriebe können ihre Mitarbeitenden zentral über eine B2B-Lizenz schulen.',
  },
];

export default function FortbildungLandingPage() {
  return (
    <>
      <SEOHead
        title={seoTitle('Fortbildungsprüfung bestehen: Prüfungstraining für Fachwirt, Betriebswirt & Meister')}
        description={`IHK-Fortbildungsprüfung bestehen: Prüfungssimulation, KI-Prüfungscoach & Schwächenanalyse für Fachwirt, Betriebswirt, Meister. ${PRICING.defaultPrice} einmalig, ${PRICING.defaultAccess} Zugang.`}
        canonical={`${SITE_URL}/fortbildung`}
        structuredData={generateFAQSchema(FAQS)}
      />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-20 px-4 relative">
          <div className="container mx-auto text-center max-w-4xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <Award className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Beruflich aufsteigen – Prüfung sicher bestehen</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-display font-bold mb-6 animate-fade-in">
              Fortbildungsprüfung bestehen:{' '}
              <span className="text-gradient text-glow">Dein Karriere-Boost</span>
            </h1>

            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Gezielte Prüfungsvorbereitung für IHK-Fortbildungen – neben dem Beruf machbar, 
              flexibel und mit KI-gestütztem Prüfungscoach.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg">
                  Weiterbildung starten
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
              <Link to="/exam-simulation">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  Prüfung simulieren
                </Button>
              </Link>
            </div>

            {/* Trust bar */}
            <div className="flex flex-wrap justify-center gap-6 mt-10 text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> {PRICING.defaultAccess} Zugang</span>
              <span className="flex items-center gap-2"><Shield className="h-4 w-4" /> {PRICING.noSubscription}</span>
              <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> {PRICING.defaultPrice} einmalig</span>
            </div>
          </div>
        </section>

        {/* Price Anchor */}
        <section className="py-12 bg-muted/30">
          <div className="container max-w-3xl text-center">
            <p className="text-muted-foreground mb-2">Klassische IHK-Vorbereitungskurse</p>
            <p className="text-3xl font-bold line-through text-muted-foreground/60">{PRICING.anchor.ihkRange}</p>
            <p className="text-muted-foreground mt-4">ExamFit Prüfungstraining</p>
            <p className="text-5xl font-display font-bold text-gradient">{PRICING.defaultPrice}</p>
            <p className="text-sm text-muted-foreground mt-1">einmalig · {PRICING.defaultAccess} · {PRICING.noSubscription}</p>
          </div>
        </section>

        {/* Qualifications */}
        <section className="py-16 px-4">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-bold text-center mb-4">Unterstützte Fortbildungsprüfungen</h2>
            <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
              Wähle deine Prüfung – die Inhalte passen sich automatisch an.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {QUALIFICATIONS.map((q) => (
                <Card key={q.title} className="p-5 flex items-center gap-3 hover:border-primary/50 transition-colors">
                  <Briefcase className="h-5 w-5 text-primary flex-shrink-0" />
                  <div>
                    <p className="font-semibold">{q.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">{q.dqr}</Badge>
                      {q.popular && <Badge className="text-xs bg-primary/10 text-primary border-0">Beliebt</Badge>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-bold text-center mb-12">Was dein Prüfungstraining enthält</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <Card key={title} className="p-6 space-y-3">
                  <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <h3 className="font-semibold text-lg">{title}</h3>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Why ExamFit for Fortbildung */}
        <section className="py-16 px-4">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-bold text-center mb-8">Warum ExamFit für die Fortbildung?</h2>
            <div className="space-y-4">
              {[
                'Flexible Vorbereitung neben dem Beruf – lerne wann und wo du willst',
                'Adaptive Lernpfade, die sich deinen Schwächen anpassen',
                'Prüfungssimulation auf dem Niveau echter IHK-Fortbildungsprüfungen',
                'KI-Coach für sofortiges Feedback und Erklärungen',
                `Einmalig ${PRICING.defaultPrice} statt ${PRICING.anchor.ihkRange} für klassische Kurse`,
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 p-4 glass-card rounded-xl">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-bold text-center mb-12">Häufige Fragen zur Fortbildungsvorbereitung</h2>
            <div className="space-y-4">
              {FAQS.map((faq, i) => (
                <details key={i} className="glass-card rounded-2xl p-6 group cursor-pointer">
                  <summary className="font-semibold list-none flex items-center justify-between">
                    {faq.question}
                    <svg className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </summary>
                  <p className="mt-3 text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 px-4">
          <div className="container max-w-2xl text-center space-y-6">
            <h2 className="text-3xl font-bold">Bereit für den nächsten Karriereschritt?</h2>
            <p className="text-muted-foreground">
              Starte jetzt dein Prüfungstraining – {PRICING.defaultPrice} für {PRICING.defaultAccess}.
            </p>
            <Link to="/shop">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg">
                Prüfungstraining starten
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
