import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { Clock, BookOpen, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function BlogIndexPage() {
  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['blog-articles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blog_articles')
        .select('id, slug, title, meta_description, keywords, published_at, word_count, reading_time_min')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <>
      <SEOHead
        title="Klausur-Blog – Prüfungstipps für Studierende | ExamFit"
        description="Prüfungstipps, Klausurstrategien und Transferwissen für Studierende. Lerne, wie du Klausuren bestehst – nicht nur Stoff."
        canonical="/blog"
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
                <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <p className="text-muted-foreground">Noch keine Artikel vorhanden.</p>
          ) : (
            <div className="space-y-6">
              {articles.map((article: any) => (
                <Link
                  key={article.id}
                  to={`/blog/${article.slug}`}
                  className="block group p-6 rounded-xl border border-border hover:border-primary/30 hover:shadow-md transition-all bg-card"
                >
                  <h2 className="text-xl font-semibold text-foreground group-hover:text-primary transition-colors mb-2">
                    {article.title}
                  </h2>
                  {article.meta_description && (
                    <p className="text-muted-foreground text-sm mb-3 line-clamp-2">
                      {article.meta_description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {article.published_at && (
                      <span>{format(new Date(article.published_at), 'd. MMMM yyyy', { locale: de })}</span>
                    )}
                    {article.reading_time_min && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {article.reading_time_min} Min. Lesezeit
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      Lesen <ArrowRight className="h-3 w-3" />
                    </span>
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
