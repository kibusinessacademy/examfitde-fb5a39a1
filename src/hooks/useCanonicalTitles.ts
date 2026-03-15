import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Fetches canonical titles from v_course_display_ssot for a list of package IDs.
 * Returns a Map<packageId, canonicalTitle> for efficient lookup.
 * Use: `canonicalTitles.get(pkg.id) || pkg.title || pkg.id.substring(0, 12)`
 */
export function useCanonicalTitles(packageIds: string[]) {
  return useQuery({
    queryKey: ['canonical-titles', packageIds],
    queryFn: async (): Promise<Map<string, string>> => {
      if (!packageIds.length) return new Map();
      const { data, error } = await (supabase as any)
        .from('v_course_display_ssot')
        .select('package_id, canonical_title')
        .in('package_id', packageIds);
      if (error) throw error;
      return new Map(
        (data || []).map((r: { package_id: string; canonical_title: string }) => [
          r.package_id,
          r.canonical_title,
        ]),
      );
    },
    enabled: packageIds.length > 0,
    staleTime: 60_000,
  });
}

/** Resolves a display title from canonical map with fallbacks */
export function resolveTitle(
  canonicalMap: Map<string, string> | undefined,
  id: string,
  rawTitle?: string | null,
): string {
  return canonicalMap?.get(id) || rawTitle || id.substring(0, 12);
}
