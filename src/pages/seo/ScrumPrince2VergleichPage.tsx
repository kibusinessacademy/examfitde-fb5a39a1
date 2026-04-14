import { Link } from 'react-router-dom';
import { ArrowRight, Brain, Shield, Zap, GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Kann man Scrum und PRINCE2 kombinieren?', answer: 'Ja – PRINCE2 Agile kombiniert die Governance von PRINCE2 mit agilen Methoden wie Scrum und Kanban. Ideal für Organisationen, die Flexibilität und Struktur verbinden wollen.' },
  { question: 'Welches Zertifikat ist wertvoller: Scrum oder PRINCE2?', answer: 'Abhängig von Branche und Rolle: Scrum dominiert in IT/Software, PRINCE2 in Beratung, Bau und öffentlichem Sektor. Beide zusammen bieten maximale Flexibilität auf dem Arbeitsmarkt.' },
  { question: 'Was ist PRINCE2 Agile?', answer: 'PRINCE2 Agile ist eine Erweiterung, die PRINCE2 Governance mit agilen Arbeitsmethoden kombiniert. Die Zertifizierung (Foundation/Practitioner) zeigt, dass du beide Ansätze integrieren kannst.' },
];

const COMPARISON = [
  { aspect: 'Ansatz', scrum: 'Agil, iterativ', prince2: 'Strukturiert, phasenbasiert' },
  { aspect: 'Fokus', scrum: 'Produktentwicklung', prince2: 'Projektsteuerung' },
  { aspect: 'Teams', scrum: 'Selbstorganisiert', prince2: 'Definierte Rollen' },
  { aspect: 'Planung', scrum: 'Sprint-weise (1–4 Wochen)', prince2: 'Phasen mit Meilensteinen' },
  { aspect: 'Änderungen', scrum: 'Willkommen (jeder Sprint)', prince2: 'Kontrolliert (Change Control)' },
  { aspect: 'Zertifizierung', scrum: 'PSM I (~200 USD)', prince2: 'Foundation (~400€)' },
  { aspect: 'Schwierigkeit', scrum: '85% zum Bestehen', prince2: '55% zum Bestehen' },
  { aspect: 'Branchen', scrum: 'IT, Software, Startups', prince2: 'Beratung, Bau, Behörden' },
];

export default function ScrumPrince2VergleichPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Scrum & PRINCE2', url: `${SITE_URL}/scrum-prince2-zertifizierung` },
    { name: 'Scrum vs. PRINCE2' },
  ];

  return (
    <>
      <SEOHead
        title="Scrum vs. PRINCE2 Vergleich – Agile oder strukturiert? | ExamFit"
        description="Scrum vs. PRINCE2: Detaillierter Vergleich von Ansatz, Zertifizierung, Kosten und Einsatz. Plus: Hybrid-Modelle mit PRINCE2 Agile. Welches passt zu dir?"
        canonical={`${SITE_URL}/scrum-prince2-vergleich`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Scrum & PRINCE2', href: '/scrum-prince2-zertifizierung' },
              { label: 'Scrum vs. PRINCE2' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">Vergleich</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">Scrum vs. PRINCE2</span>: Welches Zertifikat passt zu dir?
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Agil oder strukturiert? Vergleiche Ansatz, Kosten, Schwierigkeit und Einsatzgebiete – plus Hybrid-Optionen mit PRINCE2 Agile.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" asChild><Link to="/scrum-psm-vorbereitung">PSM I starten <ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
                <Button size="lg" variant="outline" asChild><Link to="/prince2-foundation">PRINCE2 Foundation starten</Link></Button>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8 text-center">Direkter Vergleich</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-4 font-semibold">Aspekt</th>
                    <th className="text-left p-4 font-semibold"><Brain className="inline h-4 w-4 mr-1" />Scrum</th>
                    <th className="text-left p-4 font-semibold"><Shield className="inline h-4 w-4 mr-1" />PRINCE2</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="p-4 font-medium">{row.aspect}</td>
                      <td className="p-4 text-muted-foreground">{row.scrum}</td>
                      <td className="p-4 text-muted-foreground">{row.prince2}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8 text-center">Hybrid: PRINCE2 Agile</h2>
            <Card className="border-primary/20">
              <CardContent className="p-8">
                <div className="flex items-start gap-4">
                  <GitMerge className="h-10 w-10 text-primary shrink-0" />
                  <div>
                    <h3 className="text-xl font-semibold mb-3">Das Beste aus beiden Welten</h3>
                    <p className="text-muted-foreground mb-4">
                      PRINCE2 Agile kombiniert die Governance und Kontrollstrukturen von PRINCE2 mit agilen Methoden wie Scrum, Kanban und Lean. Ideal für Unternehmen, die Flexibilität innerhalb klarer Projektstrukturen benötigen.
                    </p>
                    <ul className="space-y-2 text-muted-foreground">
                      <li className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Agilometer zur Bewertung der Agilität</li>
                      <li className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Hexagon-Modell für Flexibilitäts-Trade-offs</li>
                      <li className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Kombination mit Scrum-Events und PRINCE2-Phasen</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl">
            <SEOInternalLinks sourceUrl="/scrum-prince2-vergleich" title="Zertifizierung starten" />
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-display font-bold mb-8">Häufige Fragen: Scrum vs. PRINCE2</h2>
            <div className="space-y-6">
              {FAQS.map((faq, i) => (
                <div key={i} className="border-b border-border/50 pb-6">
                  <h3 className="font-semibold text-lg mb-2">{faq.question}</h3>
                  <p className="text-muted-foreground">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
