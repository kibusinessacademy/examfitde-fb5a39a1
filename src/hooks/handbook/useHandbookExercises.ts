import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { HandbookExerciseResponse } from './types';

/** Fetch user's exercise responses for a given chapter */
export function useExerciseResponses(chapterId: string | undefined) {
  return useQuery({
    queryKey: ['handbook-exercise-responses', chapterId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !chapterId) return [];

      const { data: exercises } = await supabase
        .from('handbook_exercises')
        .select('id')
        .eq('chapter_id', chapterId);

      if (!exercises?.length) return [];

      const exerciseIds = exercises.map(e => e.id);

      const { data, error } = await supabase
        .from('handbook_exercise_responses')
        .select('*')
        .eq('user_id', user.id)
        .in('exercise_id', exerciseIds);

      if (error) throw error;
      return data as HandbookExerciseResponse[];
    },
    enabled: !!chapterId,
  });
}

/** Save or update an exercise response */
export function useSaveExerciseResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      exerciseId,
      responseText,
      selfRating,
    }: {
      exerciseId: string;
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['handbook-exercise-responses'] });
    },
  });
}
