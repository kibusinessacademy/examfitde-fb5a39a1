import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL, seoTitle } from '@/lib/seo';
import {
  ArrowRight, CheckCircle2, Scale, Shield, Users, Eye,
  BarChart3, Building2, MapPin, TrendingUp, AlertTriangle,
  BookOpen, Award, Landmark,
} from 'lucide-react';

const FAQS = [
  { question: 'Was bietet ExamFit für Kammern (IHK/HWK)?', answer: 'ExamFit liefert regionale Einblicke in Prüfungsreife-Trends, aggregierte Kompetenzstände und Risiko-Verteilungen – ohne Zugriff auf individuelle Lernerdaten.' },
  { question: 'Bekommen IHK/HWK Zugriff auf Einzeldaten von Prüflingen?', answer: 'Nein. Die Governance-Ebene zeigt ausschließlich anonymisierte, regionale Aggregate. Individuelle Daten bleiben beim Lernenden und ggf. beim Ausbildungsbetrieb.' },
  { question: 'Wie unterscheidet sich ExamFit von klassischen Prüfungsvorbereitungskursen?', answer: 'ExamFit ist kein Kurs, sondern ein digitales Trainingssystem. Es ergänzt bestehende Angebote durch adaptive Prüfungssimulation, KI-Fehleranalyse und messbare Prüfungsreife.' },
  { question: 'Können Kammern ExamFit ihren Mitgliedsbetrieben empfehlen?', answer: 'Ja. Viele Kammern integrieren ExamFit als empfohlenes Tool in ihre Prüfungsvorbereitungs-Beratung. Wir unterstützen bei der Kommunikation.' },
  { question: 'Orientieren sich die Inhalte am Ausbildungsrahmenplan?', answer: 'Ja. Alle Inhalte basieren auf dem Ausbildungsrahmenplan und den prüfungsrelevanten Anforderungen der jeweiligen Kammer (IHK oder HWK).' },
  { question: 'Ist ExamFit DSGVO-konform und datenschutzsicher?', answer: 'Ja. Alle Daten werden auf EU-Servern verarbeitet. Kammern erhalten ausschließlich anonymisierte Aggregate – niemals personenbezogene Lernerdaten. ExamFit erfüllt Art. 25 (Privacy by Design) und Art. 32 DSGVO (technisch-organisatorische Maßnahmen).' },
  { question: 'Wie erfüllt ExamFit die Anforderungen des EU AI Act?', answer: 'ExamFit ist als KI-System im Bildungsbereich klassifiziert. Wir dokumentieren alle eingesetzten KI-Modelle, deren Datengrundlagen und Entscheidungslogik lückenlos. Alle KI-generierten Prüfungsinhalte durchlaufen ein mehrstufiges Quality-Gate mit menschlicher Aufsicht, bevor sie Lernenden zugänglich werden.' },
  { question: 'Welche Daten sehen Kammern – und welche nicht?', answer: 'Kammern sehen regionale Trends: aggregierte Bestehenswahrscheinlichkeiten, Risiko-Verteilungen nach Beruf und Schwächen-Cluster. Sie sehen NICHT: Namen, individuelle Ergebnisse oder betriebsbezogene Daten.' },
  { question: 'Gibt es spezielle Konditionen für Kammer-Programme?', answer: 'Für regionale Förderprogramme oder größere Rollouts bieten wir individuelle Konditionen. Kontaktieren Sie uns unter info@examfit.de.' },
];

const CONTACT = {
  company: 'ExamFit',
  owner: 'Diana Keil',
  type: 'Einzelunternehmen',
  street: 'Elsa-Brandström-Str. 4',
  city: '76676 Graben-Neudorf',
  email: 'info@examfit.de',
};

export default function PruefungstrainingInstitutionenPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Für IHK & HWK' },
  ];

  return (
    <>
      <SEOHead
        title={seoTitle('Prüfungstraining für IHK & HWK – Regionale Prüfungsreife sichtbar machen')}
        description="Regionale Prüfungsreife-Trends erkennen, Durchfallrisiken früh identifizieren und Ausbildungsqualität in Ihrem Bezirk messbar verbessern – mit ExamFit."
        canonical={`${SITE_URL}/pruefungstraining-institutionen`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />
      <div className="min-h-screen">
        {/* ═══════════════ HERO ═══════════════ */}
        <section className="py-16 md:py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10 max-w-4xl text-center space-y-6">
            <Breadcrumbs items={[{ label: 'Start', href: '/' }, { label: 'Für IHK & HWK' }]} />
            <Badge variant="outline" className="text-sm px-4 py-1.5">
              <Landmark className="h-3.5 w-3.5 mr-1.5" /> Für Industrie- &amp; Handelskammern und Handwerkskammern
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold tracking-tight leading-tight">
              Prüfungsreife im Bezirk{' '}
              <span className="text-gradient">sichtbar machen.</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              ExamFit gibt Kammern regionale Einblicke in die Prüfungsvorbereitung –
              ohne Zugriff auf individuelle Lernerdaten. Datenschutzkonform und aggregiert.
            </p>

            <div className="flex flex-wrap justify-center gap-4 text-sm font-medium">
              <span className="flex items-center gap-1.5 bg-card border border-border rounded-full px-4 py-2">
                <MapPin className="h-4 w-4 text-primary" /> Regionale Trends erkennen
              </span>
              <span className="flex items-center gap-1.5 bg-card border border-border rounded-full px-4 py-2">
                <Shield className="h-4 w-4 text-primary" /> Datenschutz-konform aggregiert
              </span>
              <span className="flex items-center gap-1.5 bg-card border border-border rounded-full px-4 py-2">
                <Scale className="h-4 w-4 text-primary" /> Neutral &amp; rahmenplankonform
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                <Link to="/enterprise-demo">
                  Informationen anfordern <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-14 px-8 text-lg" asChild>
                <Link to="/berufe">Verfügbare Berufe ansehen</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* ═══════════════ GOVERNANCE VALUE ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              Was ExamFit für <span className="text-gradient">Kammern leistet</span>
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: MapPin, title: 'Regionale Trends', text: 'Aggregierte Prüfungsreife-Daten nach Bezirk und Berufsfeld – für fundierte Steuerungsentscheidungen.' },
                { icon: Eye, title: 'Frühwarnsystem', text: 'Erkennen Sie frühzeitig, in welchen Berufsfeldern oder Regionen Durchfallrisiken steigen.' },
                { icon: Shield, title: 'Datenschutz-First', text: 'Kein Zugriff auf individuelle Lernerdaten. Nur anonymisierte, regionale Aggregate.' },
                { icon: Scale, title: 'Neutralität', text: 'Alle Inhalte orientieren sich am Ausbildungsrahmenplan – keine eigenen didaktischen Positionen.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-6 text-center hover:border-primary/30 transition-colors">
                  <Icon className="h-10 w-10 text-primary mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ REGIONALES DASHBOARD ═══════════════ */}
        <section className="py-16 md:py-20">
          <div className="container max-w-4xl text-center space-y-8">
            <h2 className="text-3xl font-display font-bold">
              Regionale <span className="text-gradient">Einblicke</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              ExamFit zeigt Ihnen, wie die Prüfungsvorbereitung in Ihrem Bezirk steht – ohne einzelne Prüflinge zu identifizieren.
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <BarChart3 className="h-8 w-8 text-primary mx-auto mb-2" />
                  <div className="text-3xl font-bold text-gradient mb-1">78%</div>
                  <p className="text-xs text-muted-foreground">Ø Prüfungsreife Bezirk</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
                  <div className="text-3xl font-bold text-warning mb-1">3</div>
                  <p className="text-xs text-muted-foreground">Berufsfelder mit erhöhtem Risiko</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <TrendingUp className="h-8 w-8 text-success mx-auto mb-2" />
                  <div className="text-3xl font-bold text-success mb-1">+12%</div>
                  <p className="text-xs text-muted-foreground">Verbesserung ggü. Vorjahr</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* ═══════════════ KOOPERATIONSMODELLE ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold text-center mb-10">
              Mögliche <span className="text-gradient">Kooperationsformen</span>
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: Award, title: 'Empfehlung', desc: 'ExamFit als empfohlenes Tool in der Prüfungsvorbereitungs-Beratung für Betriebe.' },
                { icon: Building2, title: 'Regionale Förderung', desc: 'Integration in regionale Förderprogramme für Ausbildungsbetriebe.' },
                { icon: Users, title: 'Qualitätsmonitoring', desc: 'Anonymisierte Trends zur Steuerung der regionalen Ausbildungsqualität.' },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="glass-card rounded-2xl p-6 text-center hover:border-primary/30 transition-colors">
                  <Icon className="h-10 w-10 text-primary mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ ABGRENZUNG ═══════════════ */}
        <section className="py-16 md:py-20">
          <div className="container max-w-4xl">
            <div className="glass-card rounded-2xl p-8 md:p-12">
              <h2 className="text-2xl md:text-3xl font-display font-bold mb-6 text-center">
                Klare <span className="text-gradient">Datenschutz-Governance</span>
              </h2>
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <h3 className="font-semibold text-destructive mb-3">Kammern sehen NICHT:</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {['Individuelle Prüfungsergebnisse einzelner Lernender', 'Persönliche Trainingsdaten oder Schwächenprofile', 'Detaillierte Ergebnisse einzelner Betriebe'].map(t => (
                      <li key={t} className="flex items-start gap-2">
                        <span className="text-destructive mt-0.5">✗</span>{t}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold text-primary mb-3">Kammern sehen:</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {['Aggregierte Prüfungsreife-Verteilungen pro Region', 'Risiko-Trends nach Berufsfeld', 'Anzahl angebundener Organisationen und deren Aktivität'].map(t => (
                      <li key={t} className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />{t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ SOCIAL PROOF ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-3xl text-center space-y-8">
            <h2 className="text-3xl font-display font-bold">
              Fakten zu <span className="text-gradient">ExamFit</span>
            </h2>
            <div className="flex flex-wrap justify-center gap-12">
              <div>
                <p className="text-4xl font-display font-bold text-gradient">200+</p>
                <p className="text-sm text-muted-foreground">Ausbildungsberufe (IHK &amp; HWK)</p>
              </div>
              <div>
                <p className="text-4xl font-display font-bold text-gradient">DSGVO</p>
                <p className="text-sm text-muted-foreground">EU-Hosting &amp; datenschutzkonform</p>
              </div>
              <div>
                <p className="text-4xl font-display font-bold text-gradient">§-konform</p>
                <p className="text-sm text-muted-foreground">Rahmenplan-orientierte Inhalte</p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ FAQ ═══════════════ */}
        <section className="py-16 md:py-20">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen</h2>
            <div className="space-y-3">
              {FAQS.map(faq => (
                <details key={faq.question} className="group border border-border rounded-lg bg-card">
                  <summary className="px-6 py-4 cursor-pointer font-medium hover:text-primary transition-colors">{faq.question}</summary>
                  <p className="px-6 pb-4 text-sm text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ KONTAKT ═══════════════ */}
        <section className="py-12 border-t border-border">
          <div className="container max-w-4xl text-center space-y-2">
            <p className="font-semibold">{CONTACT.company}</p>
            <p className="text-sm text-muted-foreground">Inhaberin: {CONTACT.owner} · {CONTACT.type}</p>
            <p className="text-sm text-muted-foreground">{CONTACT.street} · {CONTACT.city}</p>
            <p className="text-sm text-muted-foreground">{CONTACT.email}</p>
          </div>
        </section>


        <section className="py-20">
          <div className="container max-w-4xl">
            <div className="glass-strong rounded-3xl p-10 md:p-14 text-center relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-10" />
              <div className="relative z-10 space-y-6">
                <Landmark className="h-14 w-14 text-primary mx-auto" />
                <h2 className="text-3xl md:text-4xl font-display font-bold">
                  Ausbildungsqualität in Ihrem Bezirk stärken
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto text-lg">
                  Erfahren Sie, wie ExamFit Kammern bei der regionalen Qualitätsentwicklung unterstützt.
                </p>
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                  <Link to="/enterprise-demo">
                    Informationen anfordern <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
