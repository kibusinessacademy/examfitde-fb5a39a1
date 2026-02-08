import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface HandbookChapter {
  id: string;
  chapter_key: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  icon: string;
  sort_order: number;
  estimated_reading_minutes: number;
  is_premium: boolean;
  is_published: boolean;
}

export interface HandbookSection {
  id: string;
  chapter_id: string;
  section_key: string;
  title: string;
  content_markdown: string;
  content_type: 'text' | 'checklist' | 'tip' | 'warning' | 'example' | 'quote';
  sort_order: number;
}

export interface HandbookExercise {
  id: string;
  chapter_id: string;
  section_id: string | null;
  exercise_type: 'reflection' | 'decision' | 'analysis' | 'structure' | 'self_check';
  question_text: string;
  hint_text: string | null;
  explanation_text: string | null;
  example_answer: string | null;
  sort_order: number;
}

export interface HandbookProgress {
  id: string;
  user_id: string;
  chapter_id: string;
  started_at: string;
  completed_at: string | null;
  reading_time_minutes: number;
}

export interface HandbookRecommendation {
  id: string;
  trigger_type: string;
  chapter_id: string;
  recommendation_text: string;
  chapter?: HandbookChapter;
}

// Fetch all published chapters
export function useHandbookChapters() {
  return useQuery({
    queryKey: ['handbook-chapters'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('handbook_chapters')
        .select('*')
        .eq('is_published', true)
        .order('sort_order');

      if (error) throw error;
      return data as HandbookChapter[];
    },
  });
}

// Fetch a single chapter with sections and exercises
export function useHandbookChapter(chapterKey: string | undefined) {
  return useQuery({
    queryKey: ['handbook-chapter', chapterKey],
    queryFn: async () => {
      if (!chapterKey) return null;

      const { data: chapter, error: chapterError } = await supabase
        .from('handbook_chapters')
        .select('*')
        .eq('chapter_key', chapterKey)
        .eq('is_published', true)
        .single();

      if (chapterError) throw chapterError;

      const { data: sections, error: sectionsError } = await supabase
        .from('handbook_sections')
        .select('*')
        .eq('chapter_id', chapter.id)
        .order('sort_order');

      if (sectionsError) throw sectionsError;

      const { data: exercises, error: exercisesError } = await supabase
        .from('handbook_exercises')
        .select('*')
        .eq('chapter_id', chapter.id)
        .eq('is_active', true)
        .order('sort_order');

      if (exercisesError) throw exercisesError;

      return {
        chapter: chapter as HandbookChapter,
        sections: sections as HandbookSection[],
        exercises: exercises as HandbookExercise[],
      };
    },
    enabled: !!chapterKey,
  });
}

// Fetch user progress
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

// Mark chapter as started/completed
export function useUpdateHandbookProgress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ chapterId, completed }: { chapterId: string; completed?: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const upsertData = {
        user_id: user.id,
        chapter_id: chapterId,
        completed_at: completed ? new Date().toISOString() : null,
      };

      const { error } = await supabase
        .from('handbook_progress')
        .upsert(upsertData, { onConflict: 'user_id,chapter_id' });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['handbook-progress'] });
    },
  });
}

// Save exercise response
export function useSaveExerciseResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      exerciseId, 
      responseText, 
      selfRating 
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

// Fetch user exercise responses
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
      return data;
    },
    enabled: !!chapterId,
  });
}

// Fetch contextual recommendations
export function useHandbookRecommendations(triggerType?: string) {
  return useQuery({
    queryKey: ['handbook-recommendations', triggerType],
    queryFn: async () => {
      let query = supabase
        .from('handbook_recommendations')
        .select(`
          *,
          chapter:handbook_chapters(*)
        `)
        .eq('is_active', true)
        .order('priority');

      if (triggerType) {
        query = query.eq('trigger_type', triggerType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as HandbookRecommendation[];
    },
  });
}
