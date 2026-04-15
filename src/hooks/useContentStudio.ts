import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeInvalidation } from './useAdminRealtimeInvalidation';
import { toast } from 'sonner';

// ═══════════════════════════════════════════════════════════
// Content Pages (custom + certification SEO pages unified)
// ═══════════════════════════════════════════════════════════

export interface ContentPage {
  id: string;
  slug: string;
  page_type: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  body_md: string;
  schema_json: any;
  status: 'draft' | 'review' | 'published' | 'archived';
  language: string;
  audience: string;
  og_image_url: string | null;
  noindex: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  // unified source marker
  _source?: 'content_pages' | 'certification_seo';
  _quality_score?: number | null;
  _word_count?: number | null;
}

export function useContentPages() {
  useRealtimeInvalidation('content_pages', [['content-pages']]);

  return useQuery({
    queryKey: ['content-pages'],
    queryFn: async () => {
      // Fetch both sources in parallel
      const [customResult, seoResult] = await Promise.all([
        supabase
          .from('content_pages')
          .select('*')
          .order('updated_at', { ascending: false }),
        supabase
          .from('certification_seo_pages')
          .select('*')
          .order('updated_at', { ascending: false }),
      ]);

      if (customResult.error) throw customResult.error;

      const customPages = (customResult.data || []).map((p: any) => ({
        ...p,
        _source: 'content_pages' as const,
      })) as ContentPage[];

      // Map certification_seo_pages to ContentPage shape
      const seoPages = (seoResult.data || []).map((s: any) => ({
        id: s.id,
        slug: s.slug,
        page_type: s.page_type || 'landing',
        title: s.title,
        meta_title: s.meta_title,
        meta_description: s.meta_description,
        canonical_url: null,
        body_md: s.content_html || '',
        schema_json: s.content_json,
        status: s.is_published ? 'published' : 'draft',
        language: 'de',
        audience: 'b2c',
        og_image_url: null,
        noindex: false,
        published_at: s.published_at,
        created_at: s.created_at,
        updated_at: s.updated_at,
        _source: 'certification_seo' as const,
        _quality_score: s.quality_score,
        _word_count: s.word_count,
      })) as ContentPage[];

      return [...customPages, ...seoPages];
    },
  });
}

export function useContentPageMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['content-pages'] });

  const create = useMutation({
    mutationFn: async (page: Partial<ContentPage>) => {
      const { data, error } = await supabase.from('content_pages').insert(page as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(); toast.success('Seite erstellt'); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ContentPage> & { id: string }) => {
      const { error } = await supabase.from('content_pages').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Seite gespeichert'); },
    onError: (e: any) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('content_pages')
        .update({ status: 'published', published_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Seite veröffentlicht'); },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('content_pages').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Seite gelöscht'); },
  });

  return { create, update, publish, remove };
}

// ═══════════════════════════════════════════════════════════
// Blog Posts
// ═══════════════════════════════════════════════════════════

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  body_md: string;
  category: string | null;
  tags: string[];
  internal_links: any;
  schema_json: any;
  status: 'draft' | 'review' | 'published' | 'archived';
  author_name: string | null;
  og_image_url: string | null;
  canonical_url: string | null;
  noindex: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useBlogPosts() {
  useRealtimeInvalidation('blog_articles', [['blog-posts']]);

  return useQuery({
    queryKey: ['blog-posts'],
    queryFn: async () => {
      // blog_articles is the SSOT table with 90+ articles
      const { data, error } = await supabase
        .from('blog_articles')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      // Map blog_articles columns to BlogPost interface
      return (data || []).map((a: any) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        meta_title: a.title, // blog_articles has no separate meta_title
        meta_description: a.meta_description,
        excerpt: a.meta_description,
        body_md: a.content_md || '',
        category: a.topic_cluster,
        tags: a.keywords || [],
        internal_links: a.internal_links_json,
        schema_json: a.faq_json,
        status: a.status === 'published' ? 'published'
          : a.status === 'draft_generated' ? 'review'
          : a.status === 'archived' ? 'archived'
          : 'draft',
        author_name: a.generated_by_model,
        og_image_url: a.og_image_url || a.hero_image_url,
        canonical_url: a.canonical_url,
        noindex: false,
        published_at: a.published_at,
        created_at: a.created_at,
        updated_at: a.updated_at,
        // extra fields for UI
        _word_count: a.word_count,
        _reading_time: a.reading_time_min,
        _ai_score: a.ai_detection_score,
        _views: a.total_views,
        _performance: a.performance_score,
      })) as BlogPost[];
    },
  });
}

export function useBlogPostMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['blog-posts'] });

  const create = useMutation({
    mutationFn: async (post: Partial<BlogPost>) => {
      const { data, error } = await supabase.from('blog_posts').insert(post as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(); toast.success('Artikel erstellt'); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<BlogPost> & { id: string }) => {
      const { error } = await supabase.from('blog_posts').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Artikel gespeichert'); },
    onError: (e: any) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('blog_posts')
        .update({ status: 'published', published_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Artikel veröffentlicht'); },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('blog_posts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Artikel gelöscht'); },
  });

  return { create, update, publish, remove };
}

// ═══════════════════════════════════════════════════════════
// Content Assets
// ═══════════════════════════════════════════════════════════

export interface ContentAsset {
  id: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  alt_text: string | null;
  caption: string | null;
  keywords: string[];
  license: string | null;
  source_url: string | null;
  used_on_pages: string[];
  created_at: string;
  updated_at: string;
}

export function useContentAssets() {
  useRealtimeInvalidation('content_assets', [['content-assets']]);

  return useQuery({
    queryKey: ['content-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_assets')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ContentAsset[];
    },
  });
}

export function useContentAssetMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['content-assets'] });

  const create = useMutation({
    mutationFn: async (asset: Partial<ContentAsset>) => {
      const { data, error } = await supabase.from('content_assets').insert(asset as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(); toast.success('Asset hinzugefügt'); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ContentAsset> & { id: string }) => {
      const { error } = await supabase.from('content_assets').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Asset aktualisiert'); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('content_assets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Asset gelöscht'); },
  });

  return { create, update, remove };
}

// ═══════════════════════════════════════════════════════════
// SEO Redirects
// ═══════════════════════════════════════════════════════════

export interface SEORedirect {
  id: string;
  from_path: string;
  to_path: string;
  status_code: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useSEORedirects() {
  useRealtimeInvalidation('seo_redirects', [['seo-redirects']]);

  return useQuery({
    queryKey: ['seo-redirects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seo_redirects')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as SEORedirect[];
    },
  });
}

export function useSEORedirectMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['seo-redirects'] });

  const create = useMutation({
    mutationFn: async (redirect: Partial<SEORedirect>) => {
      const { data, error } = await supabase.from('seo_redirects').insert(redirect as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(); toast.success('Redirect erstellt'); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SEORedirect> & { id: string }) => {
      const { error } = await supabase.from('seo_redirects').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Redirect aktualisiert'); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('seo_redirects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Redirect gelöscht'); },
  });

  return { create, update, remove };
}
