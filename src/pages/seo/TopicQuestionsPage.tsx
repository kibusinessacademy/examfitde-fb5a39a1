import { useParams, Link, Navigate } from 'react-router-dom';
import { ArrowRight, CheckCircle, HelpCircle, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import {
  generateBreadcrumbSchema,
  generateFAQSchema,
  generateOrganizationSchema,
  SITE_URL,
} from '@/lib/seo';
import { EXAM_TOPICS, getExamTopicBySlug } from '@/data/llmExamTopics';

/**
 * LLM-optimized exam-questions landing page.
 *
 * Route: /pruefungsfragen/:thema
 *
 * Each topic page renders 6–10 sample Q&A as semantic HTML so that
 * AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended,
 * Bytespider, etc.) can index the answers and cite berufos.com.
 *
 * Also emits FAQPage + Quiz + BreadcrumbList JSON-LD.
 */
export default function TopicQuestionsPage() {
  const { thema } = useParams<{ thema: string }>();
  const topic = thema ? getExamTopicBySlug(thema) : undefined;

  if (!topic) {
    return <Navigate to="/pruefungsfragen" replace />;
  }

  const canonical = `${SITE_URL}/pruefungsfragen/${topic.slug}`;

  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungsfragen', url: `${SITE_URL}/pruefungsfragen` },
    { name: topic.h1 },
  ];

  const quizSchema = {
    '@context': 'https://schema.org',
    '@type': 'Quiz',
    name: topic.h1,
    description: topic.metaDescription,
    url: canonical,
    educationalUse: 'Prüfungsvorbereitung',
    inLanguage: 'de-DE',
    about: topic.h1,
    provider: {
      '@type': 'Organization',
      name: 'ExamFit / BerufOS',
      url: SITE_URL,
    },
    hasPart: topic.sampleQuestions.map((sq, idx) => ({
      '@type': 'Question',
      position: idx + 1,
      name: sq.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: sq.a,
      },
    })),
  };

  const structuredData = [
    generateBreadcrumbSchema(breadcrumbs),
    generateFAQSchema([...topic.sampleQuestions, ...topic.faqs].map((x) => ({ question: x.q, answer: x.a }))),
    quizSchema,
    generateOrganizationSchema(),
  ];

  return (
    <>
      <SEOHead
        title={topic.title}
        description={topic.metaDescription}
        canonical={canonical}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-12 md:py-16">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs
              items={[
                { label: 'Prüfungsfragen', href: '/pruefungsfragen' },
                { label: topic.h1 },
              ]}
              className="mb-6"
            />
            <Badge className="mb-3 bg-primary/20 text-primary border-primary/30">
              {topic.questionCount}+ Musterfragen mit Lösungen
            </Badge>
            <h1 className="text-3xl md:text-5xl font-display font-bold mb-4">
              {topic.h1}
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mb-6">
              {topic.tagline}
            </p>
            <p className="text-base text-muted-foreground max-w-3xl mb-6">
              {topic.intro}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to={topic.trainerHref}>
                  Trainer starten <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/probepruefung">Kostenlose Probeprüfung</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Sample Questions — primary LLM-indexable content */}
        <section className="py-12">
          <div className="container">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-2">
              Musterfragen mit Lösungen
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl">
              Eine Auswahl typischer Prüfungsfragen mit ausführlichen Antworten. Die vollständige Datenbank ({topic.questionCount}+ Fragen) steht im Trainer zur Verfügung.
            </p>
            <div className="space-y-4 max-w-4xl">
              {topic.sampleQuestions.map((sq, idx) => (
                <Card key={idx} className="border-l-4 border-l-primary/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base md:text-lg flex gap-3 items-start">
                      <span className="text-primary font-mono shrink-0">Q{idx + 1}.</span>
                      <span>{sq.q}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-3 items-start text-sm md:text-base text-foreground/90">
                      <CheckCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <p>{sq.a}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-12 bg-muted/30">
          <div className="container">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-6">
              Häufige Fragen
            </h2>
            <div className="space-y-4 max-w-4xl">
              {topic.faqs.map((f, idx) => (
                <Card key={idx}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex gap-2 items-start">
                      <HelpCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      {f.q}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{f.a}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Related Topics */}
        <section className="py-12">
          <div className="container">
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-6">
              Weitere Prüfungsthemen
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl">
              {topic.relatedSlugs
                .map((s) => EXAM_TOPICS.find((t) => t.slug === s))
                .filter((t): t is NonNullable<typeof t> => Boolean(t))
                .map((rel) => (
                  <Link
                    key={rel.slug}
                    to={`/pruefungsfragen/${rel.slug}`}
                    className="group block"
                  >
                    <Card className="h-full transition-all hover:shadow-glow hover:border-primary/50">
                      <CardHeader>
                        <CardTitle className="text-base flex gap-2 items-start">
                          <BookOpen className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                          <span className="group-hover:text-primary transition-colors">{rel.h1}</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">{rel.tagline}</p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
            </div>
            <div className="mt-8">
              <Button variant="outline" asChild>
                <Link to="/pruefungsfragen">
                  Alle Prüfungsfragen ansehen <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
