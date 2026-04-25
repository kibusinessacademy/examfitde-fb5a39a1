import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import type { HandbookProgress } from './types';
import { PROGRESS_FIELDS } from './types';

/** Fetch user's handbook progress across all chapters */
export function useHandbookProgress() {
  return useQuery({
    queryKey: ['handbook-progress'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('handbook_progress')
        .select(PROGRESS_FIELDS)
        .eq('user_id', user.id);

      if (error) throw error;
      return data as HandbookProgress[];
    },
  });
}

/**
 * Mark a chapter as started or completed.
 * - First call: sets started_at (if not already set)
 * - completed=true: sets completed_at (only if not already completed)
 * - Never nulls out an existing completed_at
 */
export function useUpdateHandbookProgress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ chapterId, completed }: { chapterId: string; completed?: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check existing progress to avoid overwriting timestamps
      const { data: existing } = await supabase
        .from('handbook_progress')
        .select('id, started_at, completed_at')
        .eq('user_id', user.id)
        .eq('chapter_id', chapterId)
        .maybeSingle();

      const now = new Date().toISOString();

      if (existing) {
        // Don't null out an existing completed_at; only set forward
        const updates: TablesUpdate<'handbook_progress'> = {};

        if (!existing.started_at) {
          updates.started_at = now;
        }

        if (completed && !existing.completed_at) {
          updates.completed_at = now;
        }

        if (Object.keys(updates).length > 0) {
          const { error } = await supabase
            .from('handbook_progress')
            .update(updates)
            .eq('id', existing.id);
          if (error) throw error;
        }
      } else {
        // First visit — create with started_at, optionally completed_at
        const { error } = await supabase
          .from('handbook_progress')
          .insert({
            user_id: user.id,
            chapter_id: chapterId,
            started_at: now,
            completed_at: completed ? now : null,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['handbook-progress'] });
    },
  });
}
