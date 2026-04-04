import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle, generateFAQSchema } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import {
  PRODUCT_CATALOG,
  getProductBySlug,
  getActiveModuleLabels,
  getPricingDisplay,
  type ProductCatalogEntry,
} from '@/config/product-catalog';
import {
  ArrowRight,
  CheckCircle,
  Award,
  Brain,
  Target,
  Clock,
  Shield,
  Mic,
  BookOpen,
  Zap,
  BarChart3,
  FileCheck,
  Sparkles,
  GraduationCap,
} from 'lucide-react';

const MODULE_ICONS: Record<string, typeof Target> = {
  'Prüfungstrainer': Target,
  'Prüfungssimulation': FileCheck,
  'MiniChecks': BarChart3,
  'KI-Tutor': Brain,
  'Mündliche Prüfung': Mic,
  'Handbuch': BookOpen,
};

function getCoreBadge(entry: ProductCatalogEntry): string {
  switch (entry.coreFeature) {
    case 'oral_exam': return '⭐ Mit mündlicher Prüfungssimulation';
    case 'ai_tutor': return '🧠 Mit KI-Prüfungscoach';
    case 'exam_simulation': return '🎯 Prüfungssimulation im Originalformat';
  }
}

function generateProductFAQs(entry: ProductCatalogEntry) {
  return [
    {
      question: `Was kostet das ${entry.shortTitle} Prüfungstraining?`,
      answer: `Das Prüfungstraining kostet ${getPricingDisplay(entry)} einmalig – kein Abo, ${PRICING.defaultAccess} Zugang zu allen Funktionen.`,
    },
    {
      question: `Was ist im ${entry.shortTitle} Training enthalten?`,
      answer: `Enthalten sind: ${getActiveModuleLabels(entry.modules).join(', ')}. Alle Inhalte sind prüfungsnah und speziell auf die ${entry.shortTitle}-Prüfung zugeschnitten.`,
    },
    {
      question: `Wie unterscheidet sich ExamFit von klassischen ${entry.shortTitle}-Kursen?`,
      answer: `Klassische Kurse kosten ${entry.anchorPrice} und bieten feste Termine. ExamFit ist flexibel, adaptiv und kostet nur ${getPricingDisplay(entry)} einmalig – mit KI-gestütztem Feedback.`,
    },
    {
      question: `Kann mein Arbeitgeber die Kosten übernehmen?`,
      answer: `Ja. Viele Arbeitgeber übernehmen Fortbildungskosten. ExamFit bietet ab 10 Lizenzen Team-Rabatte (ab ${PRICING.b2b.tiers[0].unitPriceDisplay}/Lizenz).`,
    },
  ];
}

export default function ProductLandingPage() {
  const { slug } = useParams<{ slug: string }>();
  
  const entry = slug ? getProductBySlug(slug) : undefined;
  
  if (!entry) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Produkt nicht gefunden</h1>
          <Link to="/shop">
            <Button>Zum Shop</Button>
          </Link>
        </div>
      </div>
    );
  }

  const faqs = generateProductFAQs(entry);
  const moduleLabels = getActiveModuleLabels(entry.modules);
  const priceDisplay = getPricingDisplay(entry);

  return (
    <>
      <SEOHead
        title={seoTitle(`${entry.title} 2026 – Prüfung sicher bestehen`)}
        description={`${entry.positioning}. ${moduleLabels.join(', ')}. ${priceDisplay} einmalig, ${PRICING.defaultAccess} Zugang.`}
        canonical={`${SITE_URL}/pruefungstraining/${entry.slug}`}
        structuredData={generateFAQSchema(faqs)}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-20 px-4 relative">
          <div className="container mx-auto text-center max-w-4xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">{getCoreBadge(entry)}</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-display font-bold mb-6 animate-fade-in">
              {entry.shortTitle} Prüfung bestehen:{' '}
              <span className="text-gradient text-glow">sicher und gezielt</span>
            </h1>

            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              {entry.positioning}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg">
                  {entry.ctaText}
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
              <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> {priceDisplay} einmalig</span>
            </div>
          </div>
        </section>

        {/* Price Anchor */}
        <section className="py-12 bg-muted/30">
          <div className="container max-w-3xl text-center">
            <p className="text-muted-foreground mb-2">Klassische {entry.shortTitle}-Vorbereitungskurse</p>
            <p className="text-3xl font-bold line-through text-muted-foreground/60">{entry.anchorPrice}</p>
            <p className="text-muted-foreground mt-4">ExamFit Prüfungstraining</p>
            <p className="text-5xl font-display font-bold text-gradient">{priceDisplay}</p>
            <p className="text-sm text-muted-foreground mt-1">einmalig · {PRICING.defaultAccess} · {PRICING.noSubscription}</p>
          </div>
        </section>

        {/* Modules */}
        <section className="py-16 px-4">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-bold text-center mb-4">Was dein {entry.shortTitle} Training enthält</h2>
            <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
              Alle Module sind speziell auf die {entry.shortTitle}-Prüfung zugeschnitten.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {moduleLabels.map((label) => {
                const Icon = MODULE_ICONS[label] || GraduationCap;
                const isCore = (
                  (label === 'Mündliche Prüfung' && entry.coreFeature === 'oral_exam') ||
                  (label === 'KI-Tutor' && entry.coreFeature === 'ai_tutor') ||
                  (label === 'Prüfungssimulation' && entry.coreFeature === 'exam_simulation')
                );
                return (
                  <Card key={label} className={`p-6 space-y-3 ${isCore ? 'border-primary/50 ring-1 ring-primary/20' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isCore ? 'gradient-primary' : 'bg-muted'}`}>
                        <Icon className={`h-5 w-5 ${isCore ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
                      </div>
                      {isCore && <Badge className="bg-primary/10 text-primary border-0 text-xs">Core Feature</Badge>}
                    </div>
                    <h3 className="font-semibold text-lg">{label}</h3>
                    <p className="text-sm text-muted-foreground">
                      {getModuleDescription(label, entry)}
                    </p>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* USPs */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-bold text-center mb-8">Deine Vorteile mit ExamFit</h2>
            <div className="space-y-4">
              {[
                ...entry.usps,
                `Nur ${priceDisplay} statt ${entry.anchorPrice} für klassische Kurse`,
                'Flexible Vorbereitung – lerne wann und wo du willst',
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
        <section className="py-16">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-bold text-center mb-12">Häufige Fragen zum {entry.shortTitle} Training</h2>
            <div className="space-y-4">
              {faqs.map((faq, i) => (
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
            <h2 className="text-3xl font-bold">Bereit für deine {entry.shortTitle}-Prüfung?</h2>
            <p className="text-muted-foreground">
              Starte jetzt dein Training – {priceDisplay} für {PRICING.defaultAccess}.
            </p>
            <Link to="/shop">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg">
                {entry.ctaText}
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

function getModuleDescription(label: string, entry: ProductCatalogEntry): string {
  const descs: Record<string, Record<string, string>> = {
    'Prüfungstrainer': {
      ausbilder: 'Trainiere mit prüfungsnahen Fragen zu allen AEVO-Handlungsfeldern.',
      ihk_aufstieg: 'Prüfungsnahe Aufgaben auf IHK-Fortbildungsniveau mit sofortigem Feedback.',
      zertifizierung: 'Originalnahe Prüfungsfragen im echten Prüfungsformat.',
    },
    'Prüfungssimulation': {
      ausbilder: 'Simuliere die schriftliche AEVO-Prüfung unter realen Bedingungen.',
      ihk_aufstieg: 'Realistische Prüfungssimulation mit Zeitlimit und Bestehensindikator.',
      zertifizierung: 'Prüfungssimulation im Originalformat – so realistisch wie die echte Prüfung.',
    },
    'MiniChecks': {
      ausbilder: 'Kurze Wissensüberprüfungen nach jeder Lerneinheit.',
      ihk_aufstieg: 'Regelmäßige Kompetenz-Checks zeigen deinen Fortschritt.',
      zertifizierung: 'Schnelle Selbsttests zu jedem Themengebiet.',
    },
    'KI-Tutor': {
      ausbilder: 'KI-Coach erklärt didaktische Fehler und hilft bei der Prüfungsargumentation.',
      ihk_aufstieg: 'KI-gestützte Schwächenanalyse und individuelle Transfertraining-Empfehlungen.',
      zertifizierung: 'KI-Prüfungsdecoder: Versteht Trickfragen und erklärt Framework-Logik.',
    },
    'Mündliche Prüfung': {
      ausbilder: 'Simuliere das Fachgespräch mit KI-Feedback zu Struktur und Argumentation.',
      ihk_aufstieg: 'Übe mündliche Prüfungssituationen mit sofortigem KI-Feedback.',
      zertifizierung: '',
    },
    'Handbuch': {
      ausbilder: 'Kompakte Zusammenfassung aller prüfungsrelevanten Themen.',
      ihk_aufstieg: 'Strukturiertes Prüfungswissen für alle Handlungsfelder.',
      zertifizierung: 'Kompakt-Referenz für prüfungsrelevante Konzepte.',
    },
  };
  return descs[label]?.[entry.targetGroup] || 'Prüfungsrelevante Inhalte, speziell zugeschnitten.';
}
