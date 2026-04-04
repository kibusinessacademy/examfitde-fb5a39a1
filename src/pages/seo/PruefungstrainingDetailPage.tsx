import { useParams, Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateFAQSchema, generateBreadcrumbSchema, generateCourseSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import { useCertificationCatalog } from '@/hooks/useCertificationSEO';
import { useCertificationSEOPage } from '@/hooks/useCertificationSEO';
import { usePublishedCertifications } from '@/hooks/usePublishedCertifications';
import { Target, ArrowRight, CheckCircle2, AlertTriangle, BookOpen, Brain, Clock, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import PruefungstrainingCategoryPage from './PruefungstrainingCategoryPage';

const KNOWN_CATEGORIES = ['ausbildung', 'fachwirt', 'meister', 'betriebswirt', 'sachkunde', 'aevo'];
function generateFAQs(cert: any) {
  const name = cert.title;
  const chamber = cert.chamber_type || 'IHK';
  const questions = cert.min_question_target || 600;

  return [
    {
      question: `Wie läuft die ${chamber}-Prüfung ${name} ab?`,
      answer: `Die Prüfung ${name} besteht ${cert.oral_component ? 'aus einem schriftlichen und einem mündlichen Teil' : 'aus schriftlichen Prüfungsaufgaben'}. Die schriftliche Prüfung umfasst ${cert.learning_field_count || 'mehrere'} Prüfungsbereiche mit Multiple-Choice und offenen Aufgaben. Die Bearbeitungszeit variiert je nach Prüfungsteil.`,
    },
    {
      question: `Wie viele Fragen hat die ${chamber}-Prüfung ${name}?`,
      answer: `Die Prüfung umfasst je nach Prüfungsteil zwischen 20 und 80 Aufgaben. ExamFit bietet dir über ${questions} prüfungsrelevante Übungsaufgaben zur Vorbereitung – damit du bestens trainiert in die Prüfung gehst.`,
    },
    {
      question: `Wie bereite ich mich optimal auf die Prüfung ${name} vor?`,
      answer: `Die beste Vorbereitung kombiniert Prüfungswissen mit aktivem Training. Mit ExamFit lernst du die prüfungsrelevanten Inhalte, übst mit realistischen Aufgaben und simulierst die Prüfungssituation. Der KI-Prüfungscoach erkennt deine Schwächen und erstellt einen individuellen Trainingsplan.`,
    },
    {
      question: `Was kostet das Prüfungstraining für ${name}?`,
      answer: `Das komplette Prüfungstraining für ${name} kostet ${PRICING.defaultPrice} einmalig und beinhaltet ${PRICING.defaultAccess} Zugang zu allen Lernmodulen, dem Prüfungstrainer mit ${questions}+ Aufgaben, der Prüfungssimulation und dem KI-Prüfungscoach.`,
    },
    {
      question: `Wie hoch ist die Durchfallquote bei der Prüfung ${name}?`,
      answer: `Die Durchfallquote variiert je nach ${chamber}-Bezirk und Prüfungstermin. Mit gezieltem Prüfungstraining bei ExamFit kannst du dein Risiko deutlich senken – unsere Simulation zeigt dir genau, wo du noch nachbessern musst.`,
    },
    {
      question: `Reicht Prüfungstraining statt klassischem Lernen für ${name}?`,
      answer: `ExamFit kombiniert beides: Du lernst die prüfungsrelevanten Inhalte in kompakten Modulen und trainierst dann aktiv mit Prüfungsaufgaben. Studien zeigen, dass aktives Üben deutlich effektiver ist als passives Lesen.`,
    },
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

  if (isCategory) {
    return <PruefungstrainingCategoryPage />;
  }

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

  const structuredData = [
    generateFAQSchema(faqs),
    generateBreadcrumbSchema(breadcrumbItems),
    generateCourseSchema({
      id: cert.id,
      name: `Prüfungstraining ${name}`,
      description: `KI-gestütztes Prüfungstraining für ${name}: ${questions}+ Prüfungsaufgaben, realistische Simulation & KI-Prüfungscoach.`,
      url: `${SITE_URL}/pruefungstraining/${slug}`,
      price: 39,
      currency: 'EUR',
      courseMode: 'online',
      educationalLevel: cert.certification_level || 'Berufsausbildung',
      numberOfLessons: questions,
      hasCertificate: true,
    }),
  ];

  const breadcrumbsUI = [
    { label: 'Start', href: '/' },
    { label: 'Prüfungstraining', href: '/pruefungstraining' },
    ...(category ? [{ label: category.charAt(0).toUpperCase() + category.slice(1), href: `/pruefungstraining/${category}` }] : []),
    { label: name },
  ];

  return (
    <>
      <SEOHead
        title={`Prüfungstraining ${name} – Prüfung sicher bestehen`}
        description={`Prüfungstraining für ${name}: ${questions}+ Prüfungsaufgaben, realistische ${chamber}-Prüfungssimulation & KI-Prüfungscoach. Jetzt starten und Prüfung bestehen!`}
        canonical={`${SITE_URL}/pruefungstraining/${slug}`}
        type="course"
        structuredData={structuredData}
      />

      <div className="container py-12 space-y-12 max-w-5xl mx-auto">
        {/* Breadcrumbs + Hero */}
        <section className="space-y-4">
          <Breadcrumbs items={breadcrumbsUI} />

          {/* Coming Soon Banner */}
          {!isPublished && (
            <div className="relative rounded-2xl overflow-hidden bg-muted/60 border border-border p-8 text-center space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-primary text-sm font-semibold">
                <Clock className="h-4 w-4" />
                Coming Soon
              </div>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Das Prüfungstraining für <strong>{name}</strong> wird gerade erstellt und ist in Kürze verfügbar. Schau bald wieder vorbei!
              </p>
            </div>
          )}

          <h1 className="text-3xl md:text-4xl font-bold">
            Prüfungstraining für {name} – <span className="text-primary">Prüfung sicher bestehen</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Bereite dich mit ExamFit optimal auf die {chamber}-Prüfung {name} vor.
            {questions > 0 && ` ${questions}+ prüfungsrelevante Aufgaben,`} realistische Simulation und KI-Prüfungscoach – alles in einem Paket.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            {isPublished ? (
              <Link to="/shop">
                <Button size="lg" className="shadow-glow">
                  <Target className="mr-2 h-5 w-5" /> Prüfung starten
                </Button>
              </Link>
            ) : (
              <Button size="lg" disabled className="opacity-60">
                <Clock className="mr-2 h-5 w-5" /> Bald verfügbar
              </Button>
            )}
          </div>
        </section>

        {/* Key stats */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: BookOpen, label: 'Prüfungsaufgaben', value: `${questions}+` },
            { icon: Brain, label: 'KI-Coach', value: 'Inklusive' },
            { icon: Clock, label: 'Zugang', value: '12 Monate' },
            { icon: BarChart3, label: 'Preis', value: PRICING.defaultPrice },
          ].map(stat => (
            <Card key={stat.label} className="text-center">
              <CardContent className="py-4 space-y-1">
                <stat.icon className="h-6 w-6 mx-auto text-primary" />
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        {/* Section: Prüfungsaufbau */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">So läuft die {chamber}-Prüfung {name} ab</h2>
          <div className="prose prose-lg dark:prose-invert max-w-none">
            <p>
              Die {chamber}-Prüfung für {name} prüft dein Fachwissen in {cert.learning_field_count || 'mehreren'} Prüfungsbereichen.
              {cert.written_exam_weight && ` Die schriftliche Prüfung macht ${Math.round(cert.written_exam_weight * 100)}% der Gesamtnote aus.`}
              {cert.oral_component && ' Zusätzlich gibt es eine mündliche Prüfung bzw. ein Fachgespräch.'}
            </p>
            <p>
              ExamFit bildet diese Prüfungsstruktur exakt nach – mit den gleichen Fragentypen, realistischen Zeitvorgaben und einer
              Schwierigkeitsverteilung, die der echten Prüfung entspricht.
            </p>
          </div>
        </section>

        {/* SEO Content from DB (if available) */}
        {seoPage?.content_html && (
          <section className="prose prose-lg dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(seoPage.content_html, {
              ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','strong','em','u','ul','ol','li','blockquote','code','pre','a','img','table','thead','tbody','tr','th','td','span','div','sub','sup','hr'],
              ALLOWED_ATTR: ['href','src','alt','title','class','id','target','rel'],
              FORBID_TAGS: ['script','iframe','object','embed','style','form'],
              ALLOW_DATA_ATTR: false,
            }) }}
          />
        )}

        {/* Section: Typische Prüfungsfragen */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Typische Prüfungsfragen & Musterfragen {name}</h2>
          <p className="text-muted-foreground">
            Die {chamber}-Prüfung {name} enthält verschiedene Aufgabentypen: Multiple-Choice-Fragen, offene Aufgaben,
            {cert.math_ratio && cert.math_ratio > 0 ? ' Rechenaufgaben,' : ''} situative Fallbeispiele und Zuordnungsaufgaben.
          </p>
          <Card className="bg-muted/30 border-primary/20">
            <CardContent className="py-6 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                So trainierst du mit ExamFit
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✓ {questions}+ prüfungsrelevante Aufgaben in allen Fragetypen</li>
                <li>✓ Realistische Schwierigkeitsgrade wie in der echten Prüfung</li>
                <li>✓ Detaillierte Erklärungen zu jeder Aufgabe</li>
                <li>✓ Schwächenanalyse zeigt deine Wissenslücken</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        {/* Section: Prüfungssimulation */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Prüfungssimulation {name} – realitätsnah trainieren</h2>
          <p className="text-muted-foreground">
            Die ExamFit-Prüfungssimulation bildet die echte {chamber}-Prüfung so genau wie möglich nach:
            gleiche Zeitvorgaben, gleiche Fragentypen, realistische Schwierigkeit. So erkennst du frühzeitig,
            ob du prüfungsreif bist – und wo du noch nachbessern musst.
          </p>
          <Link to="/shop">
            <Button variant="outline" className="gap-2">
              <Target className="h-4 w-4" /> Prüfung simulieren
            </Button>
          </Link>
        </section>

        {/* Section: Häufige Fehler */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            Häufige Fehler in der Prüfung {name}
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { title: 'Zeitmangel', desc: 'Viele Prüflinge teilen ihre Zeit schlecht ein. Übe mit Zeitbegrenzung!' },
              { title: 'Aufgabenstellung nicht gelesen', desc: 'Achte auf Signalwörter wie „begründen", „berechnen" oder „erläutern".' },
              { title: 'Falsches Lernmaterial', desc: 'Nutze prüfungsrelevante Aufgaben statt allgemeiner Lehrbücher.' },
              { title: 'Keine Simulation', desc: 'Wer die Prüfungssituation nicht übt, ist unter Stress schlechter.' },
            ].map(err => (
              <Card key={err.title}>
                <CardContent className="py-4">
                  <h3 className="font-semibold text-sm mb-1">{err.title}</h3>
                  <p className="text-xs text-muted-foreground">{err.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Häufige Fragen zum Prüfungstraining {name}</h2>
          <div className="space-y-3">
            {faqs.map(faq => (
              <details key={faq.question} className="group border border-border rounded-lg">
                <summary className="px-5 py-3 cursor-pointer font-medium text-sm hover:text-primary transition-colors">
                  {faq.question}
                </summary>
                <p className="px-5 pb-3 text-sm text-muted-foreground">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Internal Links: Related certifications */}
        {relatedCerts.length > 0 && (
          <nav className="space-y-4">
            <h2 className="text-xl font-bold">Verwandtes Prüfungstraining</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {relatedCerts.map(rel => (
                <Link key={rel.id} to={`/pruefungstraining/${rel.slug}`} className="group">
                  <Card className="hover:border-primary/30 transition-colors">
                    <CardContent className="py-3 flex items-center justify-between">
                      <span className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-1">{rel.title}</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </nav>
        )}

        {/* Hub + Cross-links */}
        <nav className="border-t pt-8 space-y-3">
          <h2 className="text-lg font-semibold">Weitere Prüfungstrainings</h2>
          <div className="flex flex-wrap gap-2">
            <Link to="/pruefungstraining" className="text-sm text-primary hover:underline">Alle Prüfungstrainings</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/pruefungstraining/ausbildung" className="text-sm text-primary hover:underline">Ausbildung</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/pruefungstraining/fachwirt" className="text-sm text-primary hover:underline">Fachwirt</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/pruefungstraining/meister" className="text-sm text-primary hover:underline">Meister</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/pruefungstraining/sachkunde" className="text-sm text-primary hover:underline">Sachkunde</Link>
          </div>
        </nav>

        {/* Final CTA */}
        <section className="text-center py-8 space-y-4 bg-card rounded-2xl border border-border">
          <h2 className="text-2xl font-bold">Bereit für die Prüfung {name}?</h2>
          {isPublished ? (
            <>
              <p className="text-muted-foreground">Starte jetzt – {PRICING.defaultPrice} für {PRICING.defaultAccess} Prüfungstraining.</p>
              <Link to="/shop">
                <Button size="lg" className="shadow-glow">
                  <Target className="mr-2 h-5 w-5" /> Jetzt Prüfungstraining starten
                </Button>
              </Link>
            </>
          ) : (
            <p className="text-muted-foreground">Dieses Prüfungstraining wird gerade erstellt und ist bald verfügbar.</p>
          )}
        </section>
      </div>
    </>
  );
};

export default PruefungstrainingDetailPage;
