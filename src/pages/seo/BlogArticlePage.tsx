import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import ReactMarkdown from 'react-markdown';
import { Clock, ArrowLeft, Calendar, Tag } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { GrowthBrandFooter } from '@/components/seo/GrowthBrandFooter';

export default function BlogArticlePage() {
  const { slug } = useParams<{ slug: string }>();

  const { data: article, isLoading } = useQuery({
    queryKey: ['blog-article', slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blog_articles')
        .select('*')
        .eq('slug', slug)
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

  const faqItems = (article as any).faq_json as Array<{ q: string; a: string }> | null;

  // BlogPosting structured data
  const blogPostingSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description: article.meta_description,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    author: { '@type': 'Organization', name: 'ExamFit', url: 'https://examfit.de' },
    publisher: {
      '@type': 'Organization',
      name: 'ExamFit',
      url: 'https://examfit.de',
      logo: { '@type': 'ImageObject', url: 'https://examfit.de/logo.png' },
    },
    wordCount: article.word_count,
    keywords: (article.keywords || []).join(', '),
    mainEntityOfPage: { '@type': 'WebPage', '@id': `https://examfit.de/blog/${article.slug}` },
    ...((article as any).hero_image_url ? {
      image: {
        '@type': 'ImageObject',
        url: (article as any).hero_image_url,
        ...((article as any).hero_image_alt ? { description: (article as any).hero_image_alt } : {}),
      },
    } : {}),
  };

  // FAQPage structured data
  const faqSchema = faqItems && faqItems.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map(item => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  } : null;

  const structuredData = [blogPostingSchema, ...(faqSchema ? [faqSchema] : [])];

  return (
    <>
      <SEOHead
        title={`${article.title} | ExamFit Blog`}
        description={article.meta_description || ''}
        canonical={`/blog/${article.slug}`}
        type="article"
        image={(article as any).og_image_url || (article as any).hero_image_url || '/og-image.png'}
        imageAlt={(article as any).hero_image_alt || article.title}
        publishedTime={article.published_at || undefined}
        modifiedTime={article.updated_at}
        author="ExamFit"
        structuredData={structuredData}
      />

      <article className="min-h-screen bg-background" data-content-id={article.id}>
        {/* Hero Image */}
        {(article as any).hero_image_url && (
          <div className="w-full max-h-[400px] overflow-hidden bg-muted">
            <img
              src={(article as any).hero_image_url}
              alt={(article as any).hero_image_alt || article.title}
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
            { label: article.title },
          ]} />

          <Link to="/blog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors mt-4 mb-6">
            <ArrowLeft className="h-4 w-4" /> Alle Artikel
          </Link>

          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            {article.title}
          </h1>

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
            {article.word_count && (
              <span className="text-xs">{article.word_count} Wörter</span>
            )}
          </div>

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
                  <details key={idx} className="group border border-border rounded-lg">
                    <summary className="flex items-center justify-between cursor-pointer p-4 font-medium text-foreground hover:text-primary transition-colors">
                      {item.q}
                      <span className="ml-2 text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div className="px-4 pb-4 text-muted-foreground">
                      {item.a}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

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

          {/* Keywords as tags */}
          {article.keywords && article.keywords.length > 0 && (
            <div className="mt-8 flex flex-wrap gap-2">
              {article.keywords.map((kw: string) => (
                <span key={kw} className="inline-flex items-center gap-1 px-3 py-1 text-xs bg-muted text-muted-foreground rounded-full">
                  <Tag className="h-3 w-3" />
                  {kw}
                </span>
              ))}
            </div>
          )}

          <GrowthBrandFooter contentId={article.id} />
        </div>
      </article>
    </>
  );
}
