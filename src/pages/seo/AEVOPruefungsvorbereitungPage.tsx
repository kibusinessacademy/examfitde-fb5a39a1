import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Presentation, MessageSquare, CheckCircle2, Target, Clock, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const HANDLUNGSFELDER = [
  { nr: 1, title: 'Ausbildungsvoraussetzungen prüfen & Ausbildung planen', desc: 'Eignung des Betriebs, Ausbildungsplan, Berufsbildungsgesetz (BBiG)' },
  { nr: 2, title: 'Ausbildung vorbereiten & Einstellung durchführen', desc: 'Ausbildungsvertrag, Probezeit, Einführung neuer Azubis' },
  { nr: 3, title: 'Ausbildung durchführen & Lernprozesse fördern', desc: '4-Stufen-Methode, Lehrgespräch, Motivation, Lernzielkontrolle' },
  { nr: 4, title: 'Ausbildung abschließen', desc: 'Prüfungsvorbereitung, Zeugnisse, Übernahme' },
];

const PRUEFUNGSTEILE = [
  { icon: FileText, title: 'Schriftliche Prüfung', desc: '180 Min. · 80 Multiple-Choice-Fragen · Fallaufgaben · 50%-Bestehensgrenze', href: '/aevo-schriftliche-pruefung' },
  { icon: Presentation, title: 'Praktische Prüfung', desc: '15 Min. Präsentation einer Ausbildungssituation + Medieneinsatz', href: '/aevo-praktische-pruefung' },
  { icon: MessageSquare, title: 'Fachgespräch', desc: '15 Min. Prüfergespräch zu Handlungsfeldern & Didaktik', href: '/aevo-fachgespraech' },
];

const FAQS = [
  { question: 'Wie läuft die AEVO-Prüfung ab?', answer: 'Die AEVO-Prüfung besteht aus einem schriftlichen Teil (180 Min., 80 MC-Fragen zu Fallaufgaben) und einem praktischen Teil (15 Min. Präsentation + 15 Min. Fachgespräch). Beide Teile müssen bestanden werden.' },
  { question: 'Was ist die 4-Stufen-Methode?', answer: 'Die 4-Stufen-Methode ist eine klassische Unterweisungsmethode: 1. Vorbereiten, 2. Vormachen/Erklären, 3. Nachmachen, 4. Üben. Sie ist ein häufiges Thema in der praktischen AEVO-Prüfung.' },
  { question: 'Welche Themen kommen im AEVO-Fachgespräch?', answer: 'Im Fachgespräch werden Fragen zu allen 4 Handlungsfeldern gestellt: Ausbildungsplanung, Vorbereitung, Durchführung und Abschluss. Typische Fragen betreffen Lernziele, Methoden und rechtliche Grundlagen.' },
  { question: 'Was kostet die AEVO-Vorbereitung bei ExamFit?', answer: `Die AEVO-Prüfungsvorbereitung kostet ${PRICING.defaultPrice} einmalig (${PRICING.noSubscription.toLowerCase()}) für ${PRICING.defaultAccess} Zugang mit allen Modulen: MC-Training, Fachgespräch-Simulation und KI-Coach.` },
  { question: 'Brauche ich den AdA-Schein?', answer: 'Der Ausbilderschein (AdA-Schein / AEVO-Nachweis) ist Pflicht für alle, die in einem anerkannten Ausbildungsberuf ausbilden wollen. Die Prüfung wird bei der IHK abgelegt.' },
];

export default function AEVOPruefungsvorbereitungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: 'IHK-Prüfungsvorbereitung', url: `${SITE_URL}/ihk-pruefungsvorbereitung` },
    { name: 'AEVO-Prüfungsvorbereitung' },
  ];

  return (
    <>
      <SEOHead
        title="AEVO-Prüfungsvorbereitung – Ausbildereignungsprüfung (AdA-Schein) bestehen | ExamFit"
        description="AEVO-Prüfungsvorbereitung online: Schriftlich (80 MC-Fragen), Präsentation & Fachgespräch. 4-Stufen-Methode, Handlungsfelder, Probeprüfung mit KI-Coach. Jetzt starten!"
        canonical={`${SITE_URL}/aevo-pruefungsvorbereitung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Prüfungstraining', href: '/pruefungstraining' },
              { label: 'IHK-Prüfungsvorbereitung', href: '/ihk-pruefungsvorbereitung' },
              { label: 'AEVO' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">AEVO · AdA-Schein</Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">AEVO-Prüfungsvorbereitung</span>: Ausbildereignungsprüfung bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Komplette Vorbereitung auf die IHK-Ausbilderprüfung: Schriftliche Klausur (80 MC-Fragen), 
                praktische Präsentation und Fachgespräch – mit KI-gestütztem Training.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                  <Link to="/pruefungstraining/aevo">AEVO-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/aevo-schriftliche-pruefung">Schriftliche Prüfung üben</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Prüfungsstruktur */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-4">
              Aufbau der <span className="text-gradient">AEVO-Prüfung</span>
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
              Die Ausbildereignungsprüfung besteht aus zwei Teilen: einer schriftlichen Klausur und einer praktischen Prüfung mit Fachgespräch.
            </p>
            <div className="grid md:grid-cols-3 gap-8">
              {PRUEFUNGSTEILE.map(teil => (
                <Link key={teil.href} to={teil.href}>
                  <Card className="h-full glass-card hover:border-primary/50 transition-colors group">
                    <CardHeader>
                      <teil.icon className="h-10 w-10 text-primary mb-4" />
                      <CardTitle className="group-hover:text-primary transition-colors">{teil.title}</CardTitle>
                      <CardDescription>{teil.desc}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* 4 Handlungsfelder */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">
              Die 4 <span className="text-gradient">Handlungsfelder</span> der AEVO
            </h2>
            <div className="space-y-4">
              {HANDLUNGSFELDER.map(hf => (
                <Card key={hf.nr} className="border-border/50">
                  <CardContent className="py-4 flex gap-4 items-start">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                      {hf.nr}
                    </div>
                    <div>
                      <h3 className="font-semibold">{hf.title}</h3>
                      <p className="text-sm text-muted-foreground">{hf.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Quiz */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <SEOQuizWidget
              title="Teste dein AEVO-Wissen"
              subtitle="5 Fragen aus den 4 Handlungsfeldern"
              certificationSlug="aevo"
              ctaText="Jetzt AEVO-Training starten"
              ctaLink="/pruefungstraining/aevo"
            />
          </div>
        </section>

        {/* Cluster Links */}
        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks
              sourceUrl="/aevo-pruefungsvorbereitung"
              linkTypes={['pillar_to_cluster']}
              title="AEVO-Prüfungsbereiche vertiefen"
            />
          </div>
        </section>

        <section className="py-12 bg-muted/30">
          <div className="container max-w-4xl">
            <SEOInternalLinks
              sourceUrl="/aevo-pruefungsvorbereitung"
              linkTypes={['cluster_to_product']}
              title="AEVO-Training starten"
              maxLinks={4}
            />
          </div>
        </section>

        {/* Steckbrief */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">AEVO-Prüfung auf einen Blick</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { icon: Clock, label: 'Schriftlich', value: '180 Min. · 80 MC-Fragen' },
                { icon: Presentation, label: 'Praktisch', value: '15 Min. Präsentation + 15 Min. Fachgespräch' },
                { icon: Target, label: 'Bestehen', value: '50% pro Prüfungsteil' },
                { icon: FileText, label: 'Grundlage', value: 'AEVO / BBiG / Rahmenplan DIHK' },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card">
                  <s.icon className="h-5 w-5 text-primary flex-shrink-0" />
                  <div>
                    <span className="text-sm text-muted-foreground">{s.label}</span>
                    <p className="font-medium text-sm">{s.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur AEVO-Prüfung</h2>
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

        {/* CTA */}
        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center max-w-3xl space-y-6">
            <h2 className="text-3xl font-display font-bold">Bereit für den Ausbilderschein?</h2>
            <p className="text-xl text-muted-foreground">Starte jetzt mit dem AEVO-Training – nur {PRICING.defaultPrice}.</p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/pruefungstraining/aevo">AEVO-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
