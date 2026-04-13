import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { MiniCheckQuestion, MiniCheckContent } from '@/components/lesson/MiniCheckPlayer';

/**
 * Fetches drill MiniCheck questions from the pipeline DB (minicheck_questions mode='drill')
 * via the get_drill_minichecks RPC. Returns data in MiniCheckContent format.
 * No is_correct — answer check is server-side only.
 */
export function useDrillMiniChecks(
  curriculumId: string | undefined,
  competencyId?: string | null,
  limit = 5,
  enabled = true
) {
  return useQuery({
    queryKey: ['drill-minichecks', curriculumId, competencyId, limit],
    queryFn: async (): Promise<MiniCheckContent | null> => {
      if (!curriculumId) return null;

      const { data, error } = await supabase.rpc('get_drill_minichecks', {
        p_curriculum_id: curriculumId,
        p_competency_id: competencyId ?? undefined as any,
        p_limit: limit,
      });

      if (error) {
        console.error('Error fetching drill minichecks:', error);
        throw error;
      }

      const questions = (data as unknown as MiniCheckQuestion[]) || [];
      if (questions.length === 0) return null;

      return {
        type: 'mini_check',
        questions,
        passing_score: 60, // drills are more forgiving
      };
    },
    enabled: !!curriculumId && enabled,
    staleTime: 0, // always fresh for drills (random selection)
  });
}
