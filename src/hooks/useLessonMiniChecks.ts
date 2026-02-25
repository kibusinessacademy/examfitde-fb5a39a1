import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { MiniCheckQuestion, MiniCheckContent } from '@/components/lesson/MiniCheckPlayer';

/**
 * Fetches MiniCheck questions from the pipeline DB table (minicheck_questions)
 * via the get_lesson_minichecks RPC. Returns data in MiniCheckContent format
 * compatible with MiniCheckPlayer.
 */
export function useLessonMiniChecks(lessonId: string | undefined) {
  return useQuery({
    queryKey: ['lesson-minichecks', lessonId],
    queryFn: async (): Promise<MiniCheckContent | null> => {
      if (!lessonId) return null;

      const { data, error } = await supabase.rpc('get_lesson_minichecks', {
        p_lesson_id: lessonId,
      });

      if (error) {
        console.error('Error fetching lesson minichecks:', error);
        throw error;
      }

      // data is jsonb array from the RPC
      const questions = (data as unknown as MiniCheckQuestion[]) || [];

      if (questions.length === 0) return null;

      return {
        type: 'mini_check',
        questions,
        passing_score: 70,
      };
    },
    enabled: !!lessonId,
    staleTime: 60_000,
  });
}
