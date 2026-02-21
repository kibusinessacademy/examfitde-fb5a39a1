import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SEOPerformanceStats {
  totalPages: number;
  publishedPages: number;
  draftPages: number;
  blogPosts: number;
  landingPages: number;
  avgMetaScore: number;
  missingMetaDescription: number;
  missingOgImage: number;
  redirectsCount: number;
  lastPublished: string | null;
}

/**
 * Fetch aggregated SEO performance stats for the admin dashboard
 */
export function useSEOPerformance() {
  return useQuery({
    queryKey: ['seo-performance-stats'],
    queryFn: async (): Promise<SEOPerformanceStats> => {
      // Parallel queries for performance
      const [docsResult, blogResult, redirectsResult] = await Promise.all([
        supabase
          .from('seo_documents')
          .select('id, status, meta_description, og_image_path, doc_type, published_at')
          .order('published_at', { ascending: false }),
        supabase
          .from('blog_posts')
          .select('id, status, meta_description, og_image_url, published_at')
          .order('published_at', { ascending: false }),
        supabase
          .from('seo_redirects' as any)
          .select('id'),
      ]);

      const docs = docsResult.data || [];
      const blogs = blogResult.data || [];
      const redirects = redirectsResult.data || [];

      const allItems = [
        ...docs.map(d => ({
          status: d.status,
          hasMeta: !!d.meta_description,
          hasOg: !!d.og_image_path,
          type: d.doc_type,
          publishedAt: d.published_at,
        })),
        ...blogs.map(b => ({
          status: b.status,
          hasMeta: !!b.meta_description,
          hasOg: !!b.og_image_url,
          type: 'blog',
          publishedAt: b.published_at,
        })),
      ];

      const published = allItems.filter(i => i.status === 'published');
      const metaScores = allItems.map(i => {
        let score = 0;
        if (i.hasMeta) score += 50;
        if (i.hasOg) score += 50;
        return score;
      });

      const lastPublishedItem = published.sort((a, b) =>
        new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()
      )[0];

      return {
        totalPages: allItems.length,
        publishedPages: published.length,
        draftPages: allItems.filter(i => i.status === 'draft').length,
        blogPosts: allItems.filter(i => i.type === 'blog').length,
        landingPages: allItems.filter(i => i.type === 'landing').length,
        avgMetaScore: metaScores.length > 0
          ? Math.round(metaScores.reduce((a, b) => a + b, 0) / metaScores.length)
          : 0,
        missingMetaDescription: allItems.filter(i => !i.hasMeta).length,
        missingOgImage: allItems.filter(i => !i.hasOg).length,
        redirectsCount: redirects.length,
        lastPublished: lastPublishedItem?.publishedAt || null,
      };
    },
    staleTime: 60_000,
  });
}
