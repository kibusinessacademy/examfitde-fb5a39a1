import { Link } from 'react-router-dom';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateFAQSchema, generateBreadcrumbSchema, SITE_URL } from '@/lib/seo';
import { useCertificationCatalog } from '@/hooks/useCertificationSEO';
import { usePublishedCertifications } from '@/hooks/usePublishedCertifications';
import { Target, GraduationCap, Award, BookOpen, Shield, Briefcase, ArrowRight, CheckCircle2, Zap, Brain, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const CATEGORIES = [
  {
    slug: 'ausbildung',
    title: 'Ausbildungsberufe',
    description: 'IHK-Abschlussprüfungen für alle Ausbildungsberufe',
    icon: GraduationCap,
    catalogTypes: ['Ausbildung'],
  },
  {
    slug: 'fachwirt',
    title: 'Fachwirt-Prüfungen',
    description: 'IHK-Fortbildungsprüfungen für Fachwirte',
    icon: Award,
    catalogTypes: ['Fortbildung_IHK'],
    filter: (t: string) => t.toLowerCase().includes('fachwirt'),
  },
  {
    slug: 'meister',
    title: 'Meisterprüfungen',
    description: 'Industriemeister & Handwerksmeister Prüfungen',
    icon: Shield,
    catalogTypes: ['Meister'],
  },
  {
    slug: 'betriebswirt',
    title: 'Betriebswirt-Prüfungen',
    description: 'IHK-Fortbildung zum Geprüften Betriebswirt',
    icon: Briefcase,
    catalogTypes: ['Fortbildung_IHK'],
    filter: (t: string) => t.toLowerCase().includes('betriebswirt'),
  },
  {
    slug: 'sachkunde',
    title: 'Sachkundeprüfungen',
    description: 'Sachkunde nach §34a, §34d, §34f GewO',
    icon: BookOpen,
    catalogTypes: ['Sachkunde'],
  },
  {
    slug: 'aevo',
    title: 'AEVO Prüfungstraining',
    description: 'Ausbildereignungsprüfung (AdA-Schein)',
    icon: Target,
    catalogTypes: ['Sonstiges'],
    filter: (t: string) => t.toLowerCase().includes('aevo') || t.toLowerCase().includes('ausbilder'),
    directLink: '/pruefungstraining/aevo',
  },
];

const FAQS = [
  {
    question: 'Was ist IHK Prüfungstraining bei ExamFit?',
    answer: 'ExamFit bietet intelligentes Prüfungstraining online mit KI-Unterstützung: Prüfungssimulation, Prüfungsfragen üben, adaptiver Prüfungstrainer und KI-Prüfungscoach – alles darauf ausgerichtet, deine IHK Abschlussprüfung sicher zu bestehen.',
  },
  {
    question: 'Für welche IHK Prüfungen bietet ExamFit Prüfungsvorbereitung an?',
    answer: 'ExamFit deckt IHK-Ausbildungsprüfungen (Kaufleute, IT-Berufe, gewerblich-technische Berufe), Fachwirt- und Betriebswirtprüfungen, Meisterprüfungen, Sachkundeprüfungen (§34a/d/f) und AEVO ab.',
  },
  {
    question: 'Wie realistisch ist die IHK Prüfungssimulation online?',
    answer: 'Die Prüfungssimulation bildet die echte IHK-Prüfung so genau wie möglich nach: gleiche Zeitvorgaben, prüfungskonforme Aufgabentypen, realistische Schwierigkeit und ein Bestehensindikator. So erkennst du typische Fehler vor der echten Prüfung.',
  },
  {
    question: 'Was kostet das IHK Prüfungstraining?',
    answer: 'Das komplette Prüfungstraining kostet 39 € einmalig (kein Abo) und beinhaltet alle Module: Prüfungsfragen üben, Prüfungssimulation, mündliche Prüfung trainieren und KI-Prüfungscoach. 12 Monate Zugang.',
  },
  {
    question: 'Wie bestehe ich die IHK Abschlussprüfung mit ExamFit?',
    answer: 'ExamFit kombiniert gezieltes Prüfungswissen mit aktivem Training. Das adaptive System erkennt deine Schwächen, trainiert prüfungsrelevante Inhalte und simuliert die echte Prüfungssituation – damit du mit Sicherheit in die Prüfung gehst.',
  },
];

const PruefungstrainingHub = () => {
  const { data: catalog } = useCertificationCatalog();
  const { data: publishedIds } = usePublishedCertifications();

  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining' },
  ];

  const structuredData = [
    generateFAQSchema(FAQS),
    generateBreadcrumbSchema(breadcrumbs),
  ];

  // Count certifications per category
  const getCategoryCount = (cat: typeof CATEGORIES[0]) => {
    if (!catalog) return 0;
    return catalog.filter(c => {
      if (cat.filter) return cat.filter(c.title);
      return cat.catalogTypes.includes(c.catalog_type);
    }).length;
  };

  return (
    <>
      <SEOHead
        title="IHK Prüfungstraining online – Prüfungssimulation & Prüfungsfragen | ExamFit"
        description="IHK Prüfungstraining online mit echten Prüfungsfragen: Ausbildung, Fachwirt, Meister, AEVO & Sachkunde. Prüfungssimulation, KI-Prüfungscoach & adaptive Prüfungsvorbereitung. Jetzt starten!"
        canonical={`${SITE_URL}/pruefungstraining`}
        structuredData={structuredData}
      />

      <div className="container py-12 space-y-16">
        {/* Hero */}
        <section className="text-center max-w-4xl mx-auto space-y-6">
          <Breadcrumbs items={[{ label: 'Start', href: '/' }, { label: 'Prüfungstraining' }]} />
          <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight">
            IHK Prüfungstraining online: <span className="text-primary">Abschlussprüfung bestehen</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            KI-gestütztes Prüfungstraining mit realistischer Simulation, prüfungsrelevanten Aufgaben und persönlichem KI-Prüfungscoach. Für Azubis, Fachwirte & Meister.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/shop">
              <Button size="lg" className="shadow-glow">
                <Target className="mr-2 h-5 w-5" /> Prüfung starten
              </Button>
            </Link>
            <Link to="/pruefungstraining/ausbildung">
              <Button size="lg" variant="outline">
                Ausbildungsberufe ansehen <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>

        {/* USPs */}
        <section className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {[
            { icon: Zap, title: 'Realistische Simulation', desc: 'Gleiche Fragentypen, Zeitvorgaben und Schwierigkeit wie in der echten Prüfung.' },
            { icon: Brain, title: 'KI-Prüfungscoach', desc: 'Erkennt deine Schwächen und erstellt einen individuellen Trainingsplan.' },
            { icon: CheckCircle2, title: 'Prüfungsreife garantiert', desc: 'Hunderte prüfungsrelevante Aufgaben – gezielt aufbereitet für dein Bestehen.' },
          ].map(usp => (
            <Card key={usp.title} className="border-border/50">
              <CardContent className="pt-6 text-center space-y-3">
                <usp.icon className="h-10 w-10 mx-auto text-primary" />
                <h3 className="font-semibold text-lg">{usp.title}</h3>
                <p className="text-sm text-muted-foreground">{usp.desc}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        {/* Categories */}
        <section className="space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold mb-2">Prüfungstraining nach Kategorie</h2>
            <p className="text-muted-foreground">Wähle deine Prüfungsart und starte mit dem Training.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {CATEGORIES.map(cat => {
              const count = getCategoryCount(cat);
              const Icon = cat.icon;
              const href = cat.directLink || `/pruefungstraining/${cat.slug}`;
              return (
                <Link key={cat.slug} to={href}>
                  <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer group">
                    <CardContent className="pt-6 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                          <Icon className="h-6 w-6" />
                        </div>
                        <div>
                          <h3 className="font-semibold group-hover:text-primary transition-colors">{cat.title}</h3>
                          {count > 0 && <span className="text-xs text-muted-foreground">{count} Prüfungen</span>}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">{cat.description}</p>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Top Certifications */}
        {catalog && catalog.length > 0 && (
          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-center">Beliebtestes Prüfungstraining</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
              {catalog.slice(0, 9).map(cert => {
                const isCertPublished = publishedIds?.has(cert.id);
                return (
                <Link key={cert.id} to={`/pruefungstraining/${cert.slug}`}>
                  <Card className="hover:border-primary/30 transition-colors">
                    <CardContent className="py-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{cert.title}</p>
                        <p className="text-xs text-muted-foreground">{cert.chamber_type} · {cert.catalog_type.replace(/_/g, ' ')}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!isCertPublished && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Soon
                          </span>
                        )}
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* FAQ */}
        <section className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-center">Häufige Fragen zum Prüfungstraining</h2>
          <div className="space-y-4">
            {FAQS.map(faq => (
              <details key={faq.question} className="group border border-border rounded-lg">
                <summary className="px-6 py-4 cursor-pointer font-medium hover:text-primary transition-colors">
                  {faq.question}
                </summary>
                <p className="px-6 pb-4 text-muted-foreground">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-8 space-y-4 bg-card rounded-2xl border border-border">
          <h2 className="text-2xl font-bold">Bereit für deine Prüfung?</h2>
          <p className="text-muted-foreground">Starte jetzt mit dem Prüfungstraining – nur 39 € für 12 Monate.</p>
          <Link to="/shop">
            <Button size="lg" className="shadow-glow">
              <Target className="mr-2 h-5 w-5" /> Jetzt Prüfungstraining starten
            </Button>
          </Link>
        </section>
      </div>
    </>
  );
};

export default PruefungstrainingHub;
