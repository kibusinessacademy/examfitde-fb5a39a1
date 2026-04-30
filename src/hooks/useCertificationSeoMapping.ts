import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type SeoCategoryKey =
  | 'ausbildung'
  | 'fachwirt'
  | 'meister'
  | 'sachkunde'
  | 'projektmanagement';

export type SeoMappingSource =
  | 'meta_override'
  | 'id_chain'
  | 'catalog_slug'
  | 'slug_base'
  | 'unmatched';

export interface CertificationSeoMapping {
  seo_page_id: string;
  seo_slug: string;
  seo_title: string | null;
  seo_is_published: boolean | null;
  product_slug_override: string | null;
  certification_catalog_id: string | null;
  catalog_slug: string | null;
  catalog_title: string | null;
  category_segment: SeoCategoryKey;
  canonical_url_path: string;
  package_id: string | null;
  package_canonical_slug: string | null;
  package_title: string | null;
  product_url_path: string | null;
  mapping_source: SeoMappingSource;
}

/**
 * Buy-CTA mit prefilled Filter wenn kein Produkt verlinkt ist.
 * - product_url_path vorhanden → direkt zum Training
 * - sonst /shop?ref=<slug>&category=<segment>&q=<title>
 */
export function buildBuyCtaUrl(m: Pick<
  CertificationSeoMapping,
  'product_url_path' | 'seo_slug' | 'category_segment' | 'catalog_title' | 'seo_title'
>): string {
  if (m.product_url_path) return m.product_url_path;
  const params = new URLSearchParams({
    ref: m.seo_slug,
    category: m.category_segment,
  });
  const q = (m.catalog_title ?? m.seo_title ?? '').trim();
  if (q) params.set('q', q);
  return `/shop?${params.toString()}`;
}

/** Mapping für einzelne SEO-Page via RPC. */
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

/** Bulk-Mapping für Cockpit-Listen. */
export function useAllCertificationSeoMappings() {
  return useQuery({
    queryKey: ['cert-seo-mapping-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_certification_seo_with_product' as any)
        .select('*');
      if (error) throw error;
      return (data ?? []) as unknown as CertificationSeoMapping[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
