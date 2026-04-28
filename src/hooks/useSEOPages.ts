import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { generateSlug } from '@/lib/seo';

export interface SEOPageData {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  curriculum_id: string;
  product_key: string;
  product_name: string;
  is_published: boolean;
}

export function useCurriculumProducts() {
  return useQuery({
    queryKey: ['curriculum-products-seo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curriculum_products')
        .select(`
          id,
          slug,
          seo_title,
          seo_description,
          is_published,
          curriculum_id,
          curricula (id, title, description),
          store_products (product_key, name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data?.map(item => ({
        id: item.id,
        slug: item.slug || generateSlug((item.curricula as any)?.title || ''),
        title: (item.curricula as any)?.title || '',
        description: (item.curricula as any)?.description || null,
        seo_title: item.seo_title,
        seo_description: item.seo_description,
        curriculum_id: item.curriculum_id,
        product_key: (item.store_products as any)?.product_key || '',
        product_name: (item.store_products as any)?.name || '',
        is_published: item.is_published,
      })) as SEOPageData[];
    },
  });
}

// Mapping der Zuständigkeits-Kürzel zu lesbaren Kammer-Namen
export const KAMMER_MAPPING: Record<string, { name: string; short: string; type: 'IHK' | 'HWK' | 'Sonstige' }> = {
  'IH': { name: 'Industrie- und Handelskammer', short: 'IHK', type: 'IHK' },
  'Hw': { name: 'Handwerkskammer', short: 'HWK', type: 'HWK' },
  'Lw': { name: 'Landwirtschaftskammer', short: 'LWK', type: 'Sonstige' },
  'FB': { name: 'Freie Berufe', short: 'FB', type: 'Sonstige' },
  'ÖD': { name: 'Öffentlicher Dienst', short: 'ÖD', type: 'Sonstige' },
  'Seeverk': { name: 'Seeverkehrswirtschaft', short: 'See', type: 'IHK' },
};

export function getKammerInfo(zustaendigkeit: string) {
  return KAMMER_MAPPING[zustaendigkeit] || { name: zustaendigkeit, short: zustaendigkeit, type: 'Sonstige' as const };
}

export function useBerufPages() {
  return useQuery({
    queryKey: ['berufe-pages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('berufe')
        .select('*')
        .eq('ist_aktiv', true)
        .order('bezeichnung_kurz');

      if (error) throw error;

      return data?.map(beruf => {
        const kammerInfo = getKammerInfo(beruf.zustaendigkeit);
        // Safe fallback: if taetigkeitsprofil is null/garbled, generate neutral description
        const years = Math.round((beruf.ausbildungsdauer_monate ?? 0) / 12);
        const safeDescription = beruf.taetigkeitsprofil && beruf.taetigkeitsprofil.length >= 25
          ? beruf.taetigkeitsprofil
          : `${beruf.bezeichnung_kurz} – ${years}-jährige duale Ausbildung (${kammerInfo.short}).`;
        return {
          id: beruf.id,
          slug: generateSlug(beruf.bezeichnung_kurz),
          title: beruf.bezeichnung_kurz,
          fullTitle: beruf.bezeichnung_lang || beruf.bezeichnung_kurz,
          description: safeDescription,
          duration: beruf.ausbildungsdauer_monate,
          dqrLevel: beruf.dqr_niveau,
          bibbUrl: beruf.bibb_profil_url,
          zustaendigkeit: beruf.zustaendigkeit,
          kammer: kammerInfo.short,
          kammerName: kammerInfo.name,
          kammerType: kammerInfo.type,
        };
      });
    },
  });
}

export function useSingleBeruf(slug: string) {
  const { data: berufe } = useBerufPages();
  return berufe?.find(b => b.slug === slug);
}

/**
 * Bundle-only Strategie: productKey-Parameter wird ignoriert/normalisiert auf 'bundle'.
 * Es gibt nur ein kaufbares Produkt — alle Slugs sollen zum Bundle aufgelöst werden.
 */
export function useCurriculumProductBySlug(slug: string, _productKey?: string) {
  const { data: products } = useCurriculumProducts();

  if (!products) return undefined;

  return products.find(p => {
    const matchesSlug = p.slug === slug || generateSlug(p.title) === slug;
    return matchesSlug && p.product_key === 'bundle';
  });
}
