import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ResolvedPackageContext {
  package_id: string | null;
  curriculum_id: string | null;
  persona: string | null;
  certification_id: string | null;
}

interface ResolveArgs {
  certificationId?: string | null;
  curriculumId?: string | null;
}

/**
 * Resolves a published course_packages row from either a certification_id or
 * a curriculum_id. Used by pricing/detail pages to enrich `pricing_view`,
 * `cta_clicked` and `checkout_start` funnel events with `package_id` (SSOT
 * Pflichtfeld), so funnel-loss-detector kann Paritäts-Lücken finden.
 *
 * Anonymous-safe (RLS auf course_packages erlaubt published-Read).
 */
export function useResolvePackageContext({
  certificationId,
  curriculumId,
}: ResolveArgs) {
  return useQuery<ResolvedPackageContext | null>({
    queryKey: ['resolve-package-context', certificationId ?? null, curriculumId ?? null],
    enabled: Boolean(certificationId || curriculumId),
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      let query = supabase
        .from('course_packages')
        .select('id, curriculum_id, persona_profile, certification_id')
        .eq('status', 'published')
        .eq('is_published', true)
        .limit(1);

      if (certificationId) {
        query = query.eq('certification_id', certificationId);
      } else if (curriculumId) {
        query = query.eq('curriculum_id', curriculumId);
      }

      const { data, error } = await query.maybeSingle();
      if (error || !data) return null;

      return {
        package_id: (data as any).id ?? null,
        curriculum_id: (data as any).curriculum_id ?? null,
        persona: (data as any).persona_profile ?? null,
        certification_id: (data as any).certification_id ?? null,
      };
    },
  });
}
