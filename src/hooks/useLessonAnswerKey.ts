import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AnswerCheckResult {
  score: number;
  keyword_score: number;
  checklist_score: number;
  found_keywords: string[];
  missing_keywords: string[];
  found_checklist: string[];
  missing_checklist: string[];
  has_exemplar: boolean;
  error?: string;
  message?: string;
}

export function useLessonAnswerKey(lessonId: string | undefined) {
  return useQuery({
    queryKey: ['lesson-answer-key', lessonId],
    queryFn: async () => {
      if (!lessonId) return null;
      const { data, error } = await supabase
        .from('lesson_answer_keys' as any)
        .select('exemplar_answer, keywords, checklist')
        .eq('lesson_id', lessonId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as { exemplar_answer: string; keywords: string[]; checklist: string[] } | null;
    },
    enabled: !!lessonId,
    staleTime: 5 * 60 * 1000,
  });
}

export async function checkLessonAnswer(lessonId: string, userAnswer: string): Promise<AnswerCheckResult> {
  const { data, error } = await supabase.rpc('check_lesson_answer' as any, {
    p_lesson_id: lessonId,
    p_user_answer: userAnswer,
  });
  if (error) throw error;
  return data as unknown as AnswerCheckResult;
}
