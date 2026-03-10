import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { HandbookExerciseResponse } from './types';
import { EXERCISE_RESPONSE_FIELDS } from './types';

/**
 * Fetch user's exercise responses for a given chapter.
 * Accepts exerciseIds directly (from chapter hook cache) to avoid redundant DB round-trip.
 */
export function useExerciseResponses(
  chapterId: string | undefined,
  exerciseIds?: string[],
) {
  return useQuery({
    queryKey: ['handbook-exercise-responses', chapterId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !chapterId) return [];

      // Use provided IDs or fetch from DB
      let ids = exerciseIds;
      if (!ids?.length) {
        const { data: exercises } = await supabase
          .from('handbook_exercises')
          .select('id')
          .eq('chapter_id', chapterId);
        ids = exercises?.map(e => e.id);
      }

      if (!ids?.length) return [];

      const { data, error } = await supabase
        .from('handbook_exercise_responses')
        .select(EXERCISE_RESPONSE_FIELDS)
        .eq('user_id', user.id)
        .in('exercise_id', ids);

      if (error) throw error;
      return data as HandbookExerciseResponse[];
    },
    enabled: !!chapterId,
  });
}

/** Save or update an exercise response — invalidates chapter-scoped cache */
export function useSaveExerciseResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      exerciseId,
      chapterId,
      responseText,
      selfRating,
    }: {
      exerciseId: string;
      chapterId?: string;
      responseText?: string;
      selfRating?: number;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('handbook_exercise_responses')
        .upsert({
          user_id: user.id,
          exercise_id: exerciseId,
          response_text: responseText,
          self_rating: selfRating,
          responded_at: new Date().toISOString(),
        }, { onConflict: 'user_id,exercise_id' });

      if (error) throw error;

      // Return chapterId for targeted invalidation
      return { chapterId };
    },
    onSuccess: (_data, variables) => {
      if (variables.chapterId) {
        // Targeted invalidation — only this chapter's responses
        queryClient.invalidateQueries({
          queryKey: ['handbook-exercise-responses', variables.chapterId],
        });
      } else {
        // Fallback: invalidate all exercise response caches
        queryClient.invalidateQueries({
          queryKey: ['handbook-exercise-responses'],
        });
      }
    },
  });
}
