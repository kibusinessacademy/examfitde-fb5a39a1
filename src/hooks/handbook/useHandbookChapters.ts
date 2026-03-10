import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { HandbookChapter, HandbookSection, HandbookExercise } from './types';
import {
  CHAPTER_LIST_FIELDS,
  CHAPTER_DETAIL_FIELDS,
  SECTION_DISPLAY_FIELDS,
  EXERCISE_FIELDS,
} from './types';

/** Fetch all published chapters (lightweight list) */
export function useHandbookChapters() {
  return useQuery({
    queryKey: ['handbook-chapters'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('handbook_chapters')
        .select(CHAPTER_LIST_FIELDS)
        .eq('is_published', true)
        .order('sort_order');

      if (error) throw error;
      return data as HandbookChapter[];
    },
  });
}

/** Fetch a single chapter with its sections and exercises */
export function useHandbookChapter(chapterKey: string | undefined) {
  return useQuery({
    queryKey: ['handbook-chapter', chapterKey],
    queryFn: async () => {
      if (!chapterKey) return null;

      // maybeSingle() → returns null instead of throwing on 0 rows
      const { data: chapter, error: chapterError } = await supabase
        .from('handbook_chapters')
        .select(CHAPTER_DETAIL_FIELDS)
        .eq('chapter_key', chapterKey)
        .eq('is_published', true)
        .maybeSingle();

      if (chapterError) throw chapterError;
      if (!chapter) return null;

      // Parallel fetch sections + exercises
      const [sectionsRes, exercisesRes] = await Promise.all([
        supabase
          .from('handbook_sections')
          .select(SECTION_DISPLAY_FIELDS)
          .eq('chapter_id', chapter.id)
          .order('sort_order'),
        supabase
          .from('handbook_exercises')
          .select(EXERCISE_FIELDS)
          .eq('chapter_id', chapter.id)
          .eq('is_active', true)
          .order('sort_order'),
      ]);

      if (sectionsRes.error) throw sectionsRes.error;
      if (exercisesRes.error) throw exercisesRes.error;

      return {
        chapter: chapter as HandbookChapter,
        sections: sectionsRes.data as HandbookSection[],
        exercises: exercisesRes.data as HandbookExercise[],
      };
    },
    enabled: !!chapterKey,
  });
}
