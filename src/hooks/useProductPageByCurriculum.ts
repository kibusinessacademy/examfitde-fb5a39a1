import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ProductPageSSOT } from '@/types/product-page';
import type { ProductPageSSOTRow } from '@/types/product-page-db';
import { mapProductPageSSOT } from '@/lib/product-page-mapper';

export function useProductPageByCurriculum(curriculumId: string | undefined) {
  return useQuery<ProductPageSSOT | null>({
    queryKey: ['product-page-ssot-by-curriculum', curriculumId],
    enabled: Boolean(curriculumId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!curriculumId) return null;

      const { data, error } = await (supabase as any)
        .from('v_product_page_ssot')
        .select('*')
        .eq('curriculum_id', curriculumId)
        .eq('status', 'published')
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to load product page for curriculum "${curriculumId}": ${error.message}`);
      }

      if (!data) return null;

      return mapProductPageSSOT(data as ProductPageSSOTRow);
    },
  });
}
