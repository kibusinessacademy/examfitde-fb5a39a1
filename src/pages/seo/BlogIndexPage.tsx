import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { Clock, ArrowRight, Calendar, Tag } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function BlogIndexPage() {
  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['blog-articles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blog_articles')
        .select('id, slug, title, meta_description, keywords, published_at, word_count, reading_time_min, hero_image_url, hero_image_alt, topic_cluster')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  // Blog listing structured data
  const blogListSchema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'ExamFit Klausur-Blog',
    description: 'Prüfungstipps, Klausurstrategien und Transferwissen – direkt aus echten Prüfungsfragen.',
    url: 'https://examfit.de/blog',
    publisher: { '@type': 'Organization', name: 'ExamFit', url: 'https://examfit.de' },
    blogPost: articles.slice(0, 10).map((a: any) => ({
      '@type': 'BlogPosting',
      headline: a.title,
      url: `https://examfit.de/blog/${a.slug}`,
      datePublished: a.published_at,
      description: a.meta_description,
      ...(a.hero_image_url ? { image: a.hero_image_url } : {}),
    })),
  };

  // Get unique topic clusters for filter
  const clusters = [...new Set(articles.map((a: any) => a.topic_cluster).filter(Boolean))];

  return (
    <>
      <SEOHead
        title="Klausur-Blog – Prüfungstipps & Strategien | ExamFit"
        description="Prüfungstipps, Klausurstrategien und Transferwissen für IHK-Prüfungen, Fachwirt, Meister und Studium. Lerne, wie du Prüfungen bestehst – nicht nur Stoff."
        canonical="/blog"
        structuredData={blogListSchema}
      />

      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <Breadcrumbs items={[{ label: 'Blog', href: '/blog' }]} />

          <h1 className="text-3xl md:text-4xl font-bold text-foreground mt-6 mb-2">
            Klausur-Blog
          </h1>
          <p className="text-lg text-muted-foreground mb-10">
            Prüfungstipps, typische Denkfehler und Klausurstrategien – direkt aus echten Prüfungsfragen.
          </p>

          {isLoading ? (
            <div className="space-y-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <p className="text-muted-foreground">Noch keine Artikel vorhanden.</p>
          ) : (
            <div className="space-y-8">
              {articles.map((article: any) => (
                <Link
                  key={article.id}
                  to={`/blog/${article.slug}`}
                  className="block group rounded-xl border border-border hover:border-primary/30 hover:shadow-md transition-all bg-card overflow-hidden"
                >
                  <div className="flex flex-col sm:flex-row">
                    {/* Hero image thumbnail */}
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
                      <h2 className="text-xl font-semibold text-foreground group-hover:text-primary transition-colors mb-2">
                        {article.title}
                      </h2>

                      {article.meta_description && (
                        <p className="text-muted-foreground text-sm mb-3 line-clamp-2">
                          {article.meta_description}
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
                            <Clock className="h-3 w-3" />
                            {article.reading_time_min} Min.
                          </span>
                        )}
                        {article.topic_cluster && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-muted rounded-full">
                            <Tag className="h-3 w-3" />
                            {article.topic_cluster}
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
          )}
        </div>
      </div>
    </>
  );
}
