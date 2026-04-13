import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import ReactMarkdown from 'react-markdown';
import { Clock, ArrowLeft, Calendar, Tag, BookOpen, AlertTriangle, Lightbulb } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { GrowthBrandFooter } from '@/components/seo/GrowthBrandFooter';

const SITE_URL = 'https://examfit.de';

export default function BlogArticlePage() {
  const { slug } = useParams<{ slug: string }>();

  const { data: article, isLoading } = useQuery({
    queryKey: ['blog-article', slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blog_articles')
        .select('*')
        .eq('slug', slug!)
        .eq('status', 'published')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold text-foreground">Artikel nicht gefunden</h1>
        <Link to="/blog" className="text-primary hover:underline">← Zurück zum Blog</Link>
      </div>
    );
  }

  const a = article as any;
  const faqItems = a.faq_json as Array<{ q: string; a: string }> | null;
  const answerBlocks = a.answer_blocks as { definition_block?: string; example_block?: string; mistake_block?: string; memory_tip?: string } | null;
  const entityData = a.entity_data as { beruf?: string; pruefung?: string; concepts?: string[]; synonyms?: string[]; related_concepts?: string[] } | null;

  // BlogPosting + Speakable structured data
  const blogPostingSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description: article.meta_description,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    author: { '@type': 'Organization', name: 'ExamFit', url: SITE_URL },
    publisher: {
      '@type': 'Organization', name: 'ExamFit', url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` },
    },
    wordCount: article.word_count,
    keywords: (article.keywords || []).join(', '),
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/blog/${article.slug}` },
    ...(a.hero_image_url ? {
      image: { '@type': 'ImageObject', url: a.hero_image_url, ...(a.hero_image_alt ? { description: a.hero_image_alt } : {}) },
    } : {}),
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['.short-answer', 'h1', '.definition-block'],
    },
    ...(a.primary_question ? { about: { '@type': 'Thing', name: a.primary_question } } : {}),
    inLanguage: 'de-DE',
  };

  // FAQPage
  const faqSchema = faqItems?.length ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map(item => ({
      '@type': 'Question', name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  } : null;

  // BreadcrumbList
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ExamFit', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
      { '@type': 'ListItem', position: 3, name: article.title, item: `${SITE_URL}/blog/${article.slug}` },
    ],
  };

  const structuredData = [blogPostingSchema, breadcrumbSchema, ...(faqSchema ? [faqSchema] : [])];

  return (
    <>
      <SEOHead
        title={`${article.title} | ExamFit Blog`}
        description={article.meta_description || ''}
        canonical={`/blog/${article.slug}`}
        type="article"
        image={a.og_image_url || a.hero_image_url || '/og-image.png'}
        imageAlt={a.hero_image_alt || article.title}
        publishedTime={article.published_at || undefined}
        modifiedTime={article.updated_at}
        author="ExamFit"
        structuredData={structuredData}
      />

      <article className="min-h-screen bg-background" data-content-id={article.id}>
        {/* Hero Image */}
        {a.hero_image_url && (
          <div className="w-full max-h-[400px] overflow-hidden bg-muted">
            <img
              src={a.hero_image_url}
              alt={a.hero_image_alt || article.title}
              className="w-full h-full object-cover"
              loading="eager"
              width={1200}
              height={630}
            />
          </div>
        )}

        <div className="max-w-3xl mx-auto px-4 py-12">
          <Breadcrumbs items={[
            { label: 'Blog', href: '/blog' },
            ...(a.article_type && a.article_type !== 'general' ? [{ label: articleTypeLabel(a.article_type), href: `/blog?type=${a.article_type}` }] : []),
            { label: article.title },
          ]} />

          <Link to="/blog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors mt-4 mb-6">
            <ArrowLeft className="h-4 w-4" /> Alle Artikel
          </Link>

          {/* H1 */}
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            {article.title}
          </h1>

          {/* Short Answer Block (speakable, snippet-ready) */}
          {a.short_answer && (
            <div className="short-answer bg-primary/5 border-l-4 border-primary p-4 rounded-r-lg mb-8 text-foreground text-lg leading-relaxed">
              {a.short_answer}
            </div>
          )}

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-8">
            {article.published_at && (
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {format(new Date(article.published_at), 'd. MMMM yyyy', { locale: de })}
              </span>
            )}
            {article.reading_time_min && (
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {article.reading_time_min} Min. Lesezeit
              </span>
            )}
            {a.article_type && a.article_type !== 'general' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent text-accent-foreground rounded-full text-xs">
                {articleTypeIcon(a.article_type)}
                {articleTypeLabel(a.article_type)}
              </span>
            )}
          </div>

          {/* Answer Blocks (structured, visible) */}
          {answerBlocks && (
            <div className="grid gap-4 mb-10">
              {answerBlocks.definition_block && (
                <div className="definition-block p-4 bg-muted/50 rounded-lg border border-border">
                  <h2 className="text-sm font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                    <BookOpen className="h-4 w-4" /> Definition
                  </h2>
                  <p className="text-foreground">{answerBlocks.definition_block}</p>
                </div>
              )}
              {answerBlocks.mistake_block && (
                <div className="p-4 bg-destructive/5 rounded-lg border border-destructive/20">
                  <h2 className="text-sm font-semibold text-destructive mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> Typischer Fehler
                  </h2>
                  <p className="text-foreground">{answerBlocks.mistake_block}</p>
                </div>
              )}
              {answerBlocks.memory_tip && (
                <div className="p-4 bg-accent/30 rounded-lg border border-accent">
                  <h2 className="text-sm font-semibold text-accent-foreground mb-1 flex items-center gap-1">
                    <Lightbulb className="h-4 w-4" /> Merktipp
                  </h2>
                  <p className="text-foreground">{answerBlocks.memory_tip}</p>
                </div>
              )}
            </div>
          )}

          {/* Article Content */}
          <div className="prose prose-lg dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-a:text-primary prose-img:rounded-lg">
            <ReactMarkdown>{article.content_md}</ReactMarkdown>
          </div>

          {/* FAQ Section */}
          {faqItems && faqItems.length > 0 && (
            <section className="mt-12" aria-label="Häufige Fragen">
              <h2 className="text-2xl font-bold text-foreground mb-6">Häufig gestellte Fragen</h2>
              <div className="space-y-4">
                {faqItems.map((item, idx) => (
                  <details key={idx} className="group border border-border rounded-lg" itemScope itemType="https://schema.org/Question">
                    <summary className="flex items-center justify-between cursor-pointer p-4 font-medium text-foreground hover:text-primary transition-colors" itemProp="name">
                      {item.q}
                      <span className="ml-2 text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div className="px-4 pb-4 text-muted-foreground" itemScope itemType="https://schema.org/Answer" itemProp="acceptedAnswer">
                      <span itemProp="text">{item.a}</span>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* Entity Data / Related Concepts */}
          {entityData?.related_concepts?.length ? (
            <div className="mt-8 p-4 bg-muted/30 rounded-lg">
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">Verwandte Themen</h3>
              <div className="flex flex-wrap gap-2">
                {entityData.related_concepts.map((c) => (
                  <span key={c} className="inline-flex items-center px-3 py-1 text-xs bg-background text-foreground rounded-full border border-border">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* CTA Block */}
          <div className="mt-12 p-6 rounded-xl bg-primary/5 border border-primary/20 text-center">
            <p className="text-lg font-semibold text-foreground mb-2">
              Du lernst nicht mehr. Du trainierst, zu bestehen.
            </p>
            <p className="text-muted-foreground mb-4">
              Trainiere echte Prüfungsfragen und erkenne deine Schwächen – bevor die Prüfung es tut.
            </p>
            <Link
              to="/pruefungstraining"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Jetzt Prüfungstraining starten
            </Link>
          </div>

          {/* Keywords */}
          {(article.keywords?.length ?? 0) > 0 && (
            <div className="mt-8 flex flex-wrap gap-2">
              {article.keywords!.map((kw: string) => (
                <span key={kw} className="inline-flex items-center gap-1 px-3 py-1 text-xs bg-muted text-muted-foreground rounded-full">
                  <Tag className="h-3 w-3" />{kw}
                </span>
              ))}
            </div>
          )}

          {/* Last updated */}
          {article.updated_at && (
            <p className="mt-6 text-xs text-muted-foreground">
              Zuletzt aktualisiert: {format(new Date(article.updated_at), 'd. MMMM yyyy', { locale: de })}
            </p>
          )}

          <GrowthBrandFooter contentId={article.id} />
        </div>
      </article>
    </>
  );
}

function articleTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    definition: 'Definition', mistake: 'Typischer Fehler', example: 'Beispiel',
    comparison: 'Vergleich', faq: 'FAQ', strategy: 'Strategie',
  };
  return labels[type] || type;
}

function articleTypeIcon(type: string) {
  switch (type) {
    case 'mistake': return <AlertTriangle className="h-3 w-3" />;
    case 'definition': return <BookOpen className="h-3 w-3" />;
    case 'strategy': return <Lightbulb className="h-3 w-3" />;
    default: return null;
  }
}
