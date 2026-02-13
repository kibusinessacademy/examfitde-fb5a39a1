import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CertificationSEOPage {
  id: string;
  certification_catalog_id: string;
  page_type: string;
  slug: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  content_html: string | null;
  content_json: Record<string, unknown> | null;
  is_published: boolean;
  word_count: number;
  internal_links: Array<{ slug: string; title: string }>;
}

export function useCertificationSEOPage(slug: string) {
  return useQuery({
    queryKey: ['cert-seo-page', slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('certification_seo_pages')
        .select('*')
        .eq('slug', slug)
        .eq('is_published', true)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as CertificationSEOPage | null;
    },
    enabled: !!slug,
  });
}

export function useCertificationSEOPagesByType(pageType: string) {
  return useQuery({
    queryKey: ['cert-seo-pages-by-type', pageType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('certification_seo_pages')
        .select('*')
        .eq('page_type', pageType)
        .eq('is_published', true)
        .order('title');

      if (error) throw error;
      return (data ?? []) as unknown as CertificationSEOPage[];
    },
  });
}

export function useCertificationCatalog() {
  return useQuery({
    queryKey: ['certification-catalog-full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('certification_catalog')
        .select('*')
        .order('priority_score', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/** SEO category routes mapping */
export const CERTIFICATION_CATEGORY_ROUTES: Record<string, { path: string; label: string; seoTitle: string }> = {
  ausbildung: {
    path: '/ausbildung',
    label: 'Ausbildungsberufe',
    seoTitle: 'IHK Ausbildungsprüfungen',
  },
  fachwirt: {
    path: '/fachwirt',
    label: 'Fachwirt-Prüfungen',
    seoTitle: 'Fachwirt IHK Prüfungsvorbereitung',
  },
  meister: {
    path: '/meister',
    label: 'Meisterprüfungen',
    seoTitle: 'Meisterprüfung Vorbereitung',
  },
  sachkunde: {
    path: '/sachkunde',
    label: 'Sachkundeprüfungen',
    seoTitle: 'Sachkundeprüfung Training',
  },
  projektmanagement: {
    path: '/projektmanagement',
    label: 'Projektmanagement',
    seoTitle: 'Projektmanagement Zertifizierungen',
  },
};
