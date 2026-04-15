import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CatalogEntry {
  berufId: string;
  title: string;
  titleLong: string | null;
  slug: string;
  publishedSlug: string | null;
  kammer: string | null;
  zustaendigkeit: string | null;
  ausbildungsdauerMonate: number | null;
  dqrNiveau: number | null;
  isPublished: boolean;
  packageId: string | null;
  category: string | null;
  categoryLabel: string | null;
  description: string | null;
  discoveryTeaser: string | null;
  popularityScore: number | null;
}

export function useFullCatalog() {
  return useQuery({
    queryKey: ['full-course-catalog'],
    queryFn: async (): Promise<CatalogEntry[]> => {
      const { data, error } = await (supabase as any)
        .from('v_full_course_catalog')
        .select('*');

      if (error) throw error;
      return (data || []).map((r: any): CatalogEntry => ({
        berufId: r.beruf_id,
        title: r.title,
        titleLong: r.title_long,
        slug: r.published_slug || r.slug,
        publishedSlug: r.published_slug,
        kammer: r.kammer,
        zustaendigkeit: r.zustaendigkeit,
        ausbildungsdauerMonate: r.ausbildungsdauer_monate,
        dqrNiveau: r.dqr_niveau,
        isPublished: r.is_published === true,
        packageId: r.package_id,
        category: r.category,
        categoryLabel: r.category_label,
        description: r.description,
        discoveryTeaser: r.discovery_teaser,
        popularityScore: r.popularity_score,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}
