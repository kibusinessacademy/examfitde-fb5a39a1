import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Phase 2: Product-based access check via can_access_product()
 * Replaces legacy feature-flag checks for product-level access.
 */
export function useProductAccess(productId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['product-access', user?.id, productId],
    queryFn: async () => {
      if (!user || !productId) return false;

      const { data, error } = await supabase
        .rpc('can_access_product' as any, {
          p_user_id: user.id,
          p_product_id: productId,
        });

      if (error) {
        console.error('Product access check error:', error);
        return false;
      }
      return data as boolean;
    },
    enabled: !!user && !!productId,
    staleTime: 60 * 1000,
  });
}

/**
 * Phase 2: Bridge function — checks access by curriculum_id + feature
 * Uses new product system when available, falls back to legacy flags.
 * This is the recommended replacement for useCheckEntitlement.
 */
export function useProductAccessByCurriculum(
  curriculumId: string | undefined,
  feature?: 'learning_course' | 'exam_trainer' | 'ai_tutor' | 'oral_trainer'
) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['product-access-curriculum', user?.id, curriculumId, feature],
    queryFn: async () => {
      if (!user || !curriculumId) return false;

      const { data, error } = await supabase
        .rpc('check_product_access_by_curriculum' as any, {
          p_user_id: user.id,
          p_curriculum_id: curriculumId,
          p_feature: feature || null,
        });

      if (error) {
        console.error('Product access by curriculum error:', error);
        return false;
      }
      return data as boolean;
    },
    enabled: !!user && !!curriculumId,
    staleTime: 60 * 1000,
  });
}

export interface ProductCatalogItem {
  id: string;
  slug: string;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  product_type: string;
  certification_id: string | null;
  curriculum_id: string | null;
  visibility: string;
  channel_enabled: boolean;
}

/**
 * Phase 2: Load product catalog filtered by channel.
 */
export function useProductCatalog(channel: string = 'web') {
  return useQuery({
    queryKey: ['product-catalog', channel],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_product_catalog' as any, { p_channel: channel });

      if (error) throw error;
      return (data || []) as ProductCatalogItem[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  product_type: string;
  certification_id: string | null;
  curriculum_id: string | null;
  visibility: string;
  status: string;
  version_id: string | null;
  version_tag: string | null;
  release_notes: string | null;
}

/**
 * Phase 2: Load single product detail with current version.
 */
export function useProductDetail(slug: string | undefined) {
  return useQuery({
    queryKey: ['product-detail', slug],
    queryFn: async () => {
      if (!slug) return null;

      const { data, error } = await supabase
        .rpc('get_product_detail' as any, { p_slug: slug });

      if (error) throw error;
      const rows = data as ProductDetail[];
      return rows?.[0] || null;
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}
