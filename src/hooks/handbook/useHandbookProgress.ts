import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { HandbookProgress } from './types';

/** Fetch user's handbook progress across all chapters */
export function useHandbookProgress() {
  return useQuery({
    queryKey: ['handbook-progress'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('handbook_progress')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;
      return data as HandbookProgress[];
    },
  });
}

/** Mark a chapter as started or completed */
export function useUpdateHandbookProgress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ chapterId, completed }: { chapterId: string; completed?: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('handbook_progress')
        .upsert({
          user_id: user.id,
          chapter_id: chapterId,
          completed_at: completed ? new Date().toISOString() : null,
        }, { onConflict: 'user_id,chapter_id' });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['handbook-progress'] });
    },
  });
}
