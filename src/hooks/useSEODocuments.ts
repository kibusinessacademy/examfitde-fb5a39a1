import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SEODocumentPublic {
  id: string;
  doc_type: string;
  slug: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  content_md: string | null;
  excerpt: string | null;
  canonical_url: string | null;
  og_image_path: string | null;
  published_at: string | null;
  updated_at: string;
  internal_links: unknown;
}

/**
 * Fetch all published SEO documents, optionally filtered by doc_type
 */
export function useSEODocuments(docType?: string) {
  return useQuery({
    queryKey: ['seo-documents-public', docType],
    queryFn: async () => {
      let query = supabase
        .from('seo_documents')
        .select('id, doc_type, slug, title, meta_title, meta_description, content_md, excerpt, canonical_url, og_image_path, published_at, updated_at, internal_links')
        .eq('status', 'published')
        .order('published_at', { ascending: false });

      if (docType) {
        query = query.eq('doc_type', docType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as SEODocumentPublic[];
    },
  });
}

/**
 * Fetch a single published SEO document by slug
 */
export function useSEODocument(slug: string, docType?: string) {
  return useQuery({
    queryKey: ['seo-document', slug, docType],
    enabled: !!slug,
    queryFn: async () => {
      let query = supabase
        .from('seo_documents')
        .select('*')
        .eq('slug', slug)
        .eq('status', 'published');

      if (docType) {
        query = query.eq('doc_type', docType);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as SEODocumentPublic | null;
    },
  });
}
