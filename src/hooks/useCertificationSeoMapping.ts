import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CertificationSeoMapping {
  seo_slug: string;
  title: string;
  category_key: 'ausbildung' | 'fachwirt' | 'meister' | 'sachkunde' | 'projektmanagement';
  canonical_url_path: string;
  product_slug: string | null;
  product_url_path: string | null;
  product_package_id: string | null;
}

/**
 * Mapping SEO-Landingpage-Slug → kanonische Kategorie-URL + (optional) Kursprodukt-URL.
 * Quelle: v_certification_seo_with_product / get_certification_seo_with_product RPC.
 */
export function useCertificationSeoMapping(slug: string | undefined) {
  return useQuery({
    queryKey: ['cert-seo-mapping', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase.rpc(
        'get_certification_seo_with_product' as any,
        { p_slug: slug }
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as CertificationSeoMapping | null;
    },
    enabled: !!slug,
  });
}

/**
 * Bulk-Variante: alle Mappings auf einmal (für Cockpit-Listen).
 */
export function useAllCertificationSeoMappings() {
  return useQuery({
    queryKey: ['cert-seo-mapping-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_certification_seo_with_product' as any)
        .select('seo_slug, title, category_key, canonical_url_path, product_slug, product_url_path, product_package_id');
      if (error) throw error;
      return (data ?? []) as unknown as CertificationSeoMapping[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
