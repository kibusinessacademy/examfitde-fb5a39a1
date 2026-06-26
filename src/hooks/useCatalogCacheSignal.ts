import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Polls `catalog_cache_signal` every 60s. When `updated_at` changes
 * (any product / price / curriculum / course / package mutation), invalidate
 * the public catalog queries so new sellable courses appear on /berufe
 * without manual refresh.
 */
export function useCatalogCacheSignal() {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['catalog-cache-signal'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('catalog_cache_signal')
        .select('updated_at, source')
        .eq('id', 'singleton')
        .maybeSingle();
      if (error) throw error;
      return (data?.updated_at as string) ?? null;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!data) return;
    qc.invalidateQueries({ queryKey: ['full-course-catalog'] });
    qc.invalidateQueries({ queryKey: ['sellable-course-catalog'] });
  }, [data, qc]);
}
