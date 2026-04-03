import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import ReactMarkdown from 'react-markdown';
import { Clock, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

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

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description: article.meta_description,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    author: { '@type': 'Organization', name: 'ExamFit' },
    publisher: { '@type': 'Organization', name: 'ExamFit' },
    wordCount: article.word_count,
    keywords: (article.keywords || []).join(', '),
  };

  return (
    <>
      <SEOHead
        title={`${article.title} | ExamFit Blog`}
        description={article.meta_description || ''}
        canonical={`/blog/${article.slug}`}
        structuredData={structuredData}
      />

      <article className="min-h-screen bg-background">
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

          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-8">
            {article.published_at && (
              <span>{format(new Date(article.published_at), 'd. MMMM yyyy', { locale: de })}</span>
            )}
            {article.reading_time_min && (
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {article.reading_time_min} Min. Lesezeit
              </span>
            )}
          </div>

          <div className="prose prose-lg dark:prose-invert max-w-none">
            <ReactMarkdown>{article.content_md}</ReactMarkdown>
          </div>

          {/* CTA Block */}
          <div className="mt-12 p-6 rounded-xl bg-primary/5 border border-primary/20 text-center">
            <p className="text-lg font-semibold text-foreground mb-2">
              Du lernst nicht mehr. Du trainierst, zu bestehen.
            </p>
            <p className="text-muted-foreground mb-4">
              Trainiere echte Prüfungsfragen und erkenne deine Schwächen – bevor die Klausur es tut.
            </p>
            <Link
              to="/pruefungstraining-studium"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Jetzt Prüfungstraining starten
            </Link>
          </div>

          {/* Keywords as tags */}
          {article.keywords && article.keywords.length > 0 && (
            <div className="mt-8 flex flex-wrap gap-2">
              {article.keywords.map((kw: string) => (
                <span key={kw} className="px-3 py-1 text-xs bg-muted text-muted-foreground rounded-full">
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>
      </article>
    </>
  );
}
