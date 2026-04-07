import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { Clock, ArrowRight, Calendar, Tag, ChevronLeft, ChevronRight, BookOpen, AlertTriangle, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const SITE_URL = 'https://examfit.de';
const PAGE_SIZE = 20;

const ARTICLE_TYPES = [
  { value: '', label: 'Alle' },
  { value: 'definition', label: 'Definitionen' },
  { value: 'mistake', label: 'Typische Fehler' },
  { value: 'example', label: 'Beispiele' },
  { value: 'comparison', label: 'Vergleiche' },
  { value: 'faq', label: 'FAQ' },
  { value: 'strategy', label: 'Strategien' },
];

export default function BlogIndexPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const typeFilter = searchParams.get('type') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

  const { data, isLoading } = useQuery({
    queryKey: ['blog-articles', typeFilter, page],
    queryFn: async () => {
      let query = supabase
        .from('blog_articles')
        .select('id, slug, title, meta_description, keywords, published_at, word_count, reading_time_min, hero_image_url, hero_image_alt, topic_cluster, article_type, short_answer', { count: 'exact' })
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (typeFilter) query = query.eq('article_type', typeFilter);

      const { data, error, count } = await query;
      if (error) throw error;
      return { articles: data || [], total: count || 0 };
    },
  });

  const articles = data?.articles || [];
  const totalPages = Math.ceil((data?.total || 0) / PAGE_SIZE);

  const setFilter = (type: string) => {
    const params = new URLSearchParams(searchParams);
    if (type) params.set('type', type); else params.delete('type');
    params.delete('page');
    setSearchParams(params);
  };

  const setPage = (p: number) => {
    const params = new URLSearchParams(searchParams);
    if (p > 1) params.set('page', String(p)); else params.delete('page');
    setSearchParams(params);
  };

  const blogListSchema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'ExamFit Blog – Prüfungstipps & Klausurstrategien',
    description: 'Prüfungstipps, Klausurstrategien und Transferwissen für IHK-Prüfungen.',
    url: `${SITE_URL}/blog`,
    publisher: { '@type': 'Organization', name: 'ExamFit', url: SITE_URL },
    blogPost: articles.slice(0, 10).map((a: any) => ({
      '@type': 'BlogPosting',
      headline: a.title,
      url: `${SITE_URL}/blog/${a.slug}`,
      datePublished: a.published_at,
      description: a.meta_description,
      ...(a.hero_image_url ? { image: a.hero_image_url } : {}),
    })),
  };

  return (
    <>
      <SEOHead
        title="Klausur-Blog – Prüfungstipps & Strategien | ExamFit"
        description="Prüfungstipps, Klausurstrategien und Transferwissen für IHK-Prüfungen, Fachwirt, Meister und Studium."
        canonical="/blog"
        structuredData={blogListSchema}
      />

      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <Breadcrumbs items={[{ label: 'Blog', href: '/blog' }]} />

          <h1 className="text-3xl md:text-4xl font-bold text-foreground mt-6 mb-2">Klausur-Blog</h1>
          <p className="text-lg text-muted-foreground mb-8">
            Prüfungstipps, typische Denkfehler und Klausurstrategien – direkt aus echten Prüfungsfragen.
          </p>

          {/* RSS link */}
          <link rel="alternate" type="application/rss+xml" title="ExamFit Blog RSS" href={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-rss-feed`} />

          {/* Type Filter */}
          <div className="flex flex-wrap gap-2 mb-8">
            {ARTICLE_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setFilter(t.value)}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  typeFilter === t.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="space-y-6">
              {[1, 2, 3].map(i => <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />)}
            </div>
          ) : articles.length === 0 ? (
            <p className="text-muted-foreground">Keine Artikel gefunden.</p>
          ) : (
            <>
              <div className="space-y-8">
                {articles.map((article: any) => (
                  <Link
                    key={article.id}
                    to={`/blog/${article.slug}`}
                    className="block group rounded-xl border border-border hover:border-primary/30 hover:shadow-md transition-all bg-card overflow-hidden"
                  >
                    <div className="flex flex-col sm:flex-row">
                      {article.hero_image_url && (
                        <div className="sm:w-48 sm:min-h-[140px] bg-muted flex-shrink-0">
                          <img
                            src={article.hero_image_url}
                            alt={article.hero_image_alt || article.title}
                            className="w-full h-40 sm:h-full object-cover"
                            loading="lazy"
                            width={192}
                            height={140}
                          />
                        </div>
                      )}
                      <div className="p-6 flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {article.article_type && article.article_type !== 'general' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-accent text-accent-foreground rounded-full">
                              {article.article_type === 'mistake' && <AlertTriangle className="h-3 w-3" />}
                              {article.article_type === 'definition' && <BookOpen className="h-3 w-3" />}
                              {article.article_type === 'strategy' && <Lightbulb className="h-3 w-3" />}
                              {ARTICLE_TYPES.find(t => t.value === article.article_type)?.label || article.article_type}
                            </span>
                          )}
                        </div>
                        <h2 className="text-xl font-semibold text-foreground group-hover:text-primary transition-colors mb-2">
                          {article.title}
                        </h2>
                        {(article.short_answer || article.meta_description) && (
                          <p className="text-muted-foreground text-sm mb-3 line-clamp-2">
                            {article.short_answer || article.meta_description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          {article.published_at && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(article.published_at), 'd. MMM yyyy', { locale: de })}
                            </span>
                          )}
                          {article.reading_time_min && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />{article.reading_time_min} Min.
                            </span>
                          )}
                          {article.topic_cluster && (
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-muted rounded-full">
                              <Tag className="h-3 w-3" />{article.topic_cluster}
                            </span>
                          )}
                          <span className="ml-auto flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                            Lesen <ArrowRight className="h-3 w-3" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <nav className="flex items-center justify-center gap-2 mt-12" aria-label="Seitennavigation">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground px-4">
                    Seite {page} von {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page >= totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
