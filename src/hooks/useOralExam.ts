import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTargetLanguage } from '@/hooks/i18n/useTranslatedContent';

export interface OralExamSession {
  id: string;
  user_id: string;
  curriculum_id: string;
  blueprint_id: string | null;
  mode: 'practice' | 'simulation';
  total_questions: number;
  time_limit_minutes: number | null;
  current_question_index: number;
  started_at: string;
  finished_at: string | null;
  overall_score: number | null;
  passed: boolean | null;
  fachlichkeit_score: number | null;
  struktur_score: number | null;
  begriffssicherheit_score: number | null;
  praxisbezug_score: number | null;
  strengths: string[] | null;
  weaknesses: string[] | null;
  improvement_suggestions: string[] | null;
  topic_filter?: string[] | null;
  topic_scores?: TopicScore[] | null;
}


export interface OralExamQuestion {
  id: string;
  session_id: string;
  question_text: string;
  expected_answer_points: string[] | null;
  follow_up_questions: string[] | null;
  order_index: number;
  time_limit_seconds: number;
  user_answer: string | null;
  answer_submitted_at: string | null;
  fachlichkeit_score: number | null;
  struktur_score: number | null;
  begriffssicherheit_score: number | null;
  praxisbezug_score: number | null;
  ai_feedback: string | null;
  covered_points: string[] | null;
  missed_points: string[] | null;
  topic_key?: string | null;
  topic_label?: string | null;
  learning_field_id?: string | null;
  competency_id?: string | null;
}

export interface TopicScore {
  topic_key: string;
  topic_label: string;
  questions_total: number;
  questions_answered: number;
  fachlichkeit_pct: number;
  struktur_pct: number;
  begriffssicherheit_pct: number;
  praxisbezug_pct: number;
  overall_pct: number;
}

export interface EvaluationResult {
  fachlichkeit_score: number;
  struktur_score: number;
  begriffssicherheit_score: number;
  praxisbezug_score: number;
  overall_score: number;
  feedback: string;
  covered_points: string[];
  missed_points: string[];
  strengths: string[];
  improvements: string[];
  sample_answer?: string;
  follow_up_question?: string;
}

interface UseOralExamOptions {
  curriculumId: string;
  mode?: 'practice' | 'simulation';
  totalQuestions?: number;
  topicKeys?: string[];
}


export function useOralExam({ curriculumId, mode = 'practice', totalQuestions = 5, topicKeys = [] }: UseOralExamOptions) {
  const [session, setSession] = useState<OralExamSession | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<OralExamQuestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const targetLang = useTargetLanguage();

  const startSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('oral-exam', {
        body: {
          action: 'start_session',
          curriculum_id: curriculumId,
          mode,
          total_questions: totalQuestions,
          topic_keys: topicKeys,
          lang: targetLang,
        }
      });

      // FunctionsHttpError carries the body in error.context — extract it for the user.
      if (error) {
        let serverMsg: string | undefined;
        let serverCode: string | undefined;
        try {
          const ctx: any = (error as any).context;
          const raw = typeof ctx?.json === 'function' ? await ctx.json() : ctx?.body ?? ctx;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          serverMsg = parsed?.message ?? parsed?.error;
          serverCode = parsed?.error;
        } catch { /* noop */ }
        const composed = serverMsg || (error as Error).message || 'Unbekannter Fehler';
        const err = new Error(composed);
        (err as any).code = serverCode;
        throw err;
      }
      if (data?.error) {
        throw new Error(data?.message ?? data.error);
      }

      setSession(data.session);
      setCurrentQuestion(data.firstQuestion);
      setEvaluation(null);

      return data;
    } catch (error) {
      const err = error as Error & { code?: string };
      console.error('Failed to start oral exam:', err);
      const friendly =
        err.code === 'NO_ORAL_BLUEPRINTS'
          ? 'Für diesen Beruf sind noch keine geprüften Oral-Blueprints freigegeben. Bitte wähle einen anderen Beruf oder versuche es später erneut.'
          : err.message?.includes('Unauthorized') || err.message?.includes('Invalid token')
            ? 'Bitte melde dich an, um die Prüfungssimulation zu starten.'
            : err.message?.includes('Rate limit')
              ? 'Du hast in kurzer Zeit zu viele Prüfungen gestartet. Bitte warte einen Moment.'
              : err.message || 'Die Prüfung konnte nicht gestartet werden.';
      toast({
        title: 'Prüfung konnte nicht gestartet werden',
        description: friendly,
        variant: 'destructive'
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [curriculumId, mode, totalQuestions, topicKeys, toast, targetLang]);





  const submitAnswer = useCallback(async (answer: string) => {
    if (!currentQuestion) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('oral-exam', {
        body: {
          action: 'evaluate_answer',
          question_id: currentQuestion.id,
          user_answer: answer,
          lang: targetLang,
        }
      });

      if (error) throw error;
      
      setEvaluation(data.evaluation);
      
      // Update local session state
      if (session) {
        setSession({
          ...session,
          current_question_index: session.current_question_index + 1
        });
      }

      return { evaluation: data.evaluation, isLast: data.is_last };
    } catch (error) {
      console.error('Failed to submit answer:', error);
      toast({
        title: 'Fehler',
        description: 'Die Antwort konnte nicht bewertet werden.',
        variant: 'destructive'
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [currentQuestion, session, toast, targetLang]);

  const nextQuestion = useCallback(async () => {
    if (!session) return;
    
    setIsLoading(true);
    setEvaluation(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('oral-exam', {
        body: {
          action: 'generate_question',
          session_id: session.id,
          lang: targetLang,
        }
      });

      if (error) throw error;
      
      setCurrentQuestion(data.question);
      return data.question;
    } catch (error) {
      console.error('Failed to get next question:', error);
      toast({
        title: 'Fehler',
        description: 'Die nächste Frage konnte nicht geladen werden.',
        variant: 'destructive'
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [session, toast, targetLang]);

  const finishSession = useCallback(async () => {
    if (!session) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('oral-exam', {
        body: {
          action: 'finish_session',
          session_id: session.id,
          lang: targetLang,
        }
      });

      if (error) throw error;
      
      setSession(data.session);
      queryClient.invalidateQueries({ queryKey: ['oral-exam-history'] });
      
      return data;
    } catch (error) {
      console.error('Failed to finish session:', error);
      toast({
        title: 'Fehler',
        description: 'Die Prüfung konnte nicht abgeschlossen werden.',
        variant: 'destructive'
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [session, toast, queryClient]);

  const reset = useCallback(() => {
    setSession(null);
    setCurrentQuestion(null);
    setEvaluation(null);
  }, []);

  return {
    session,
    currentQuestion,
    evaluation,
    isLoading,
    startSession,
    submitAnswer,
    nextQuestion,
    finishSession,
    reset,
    progress: session ? {
      current: session.current_question_index,
      total: session.total_questions,
      percent: (session.current_question_index / session.total_questions) * 100
    } : null
  };
}

// Hook for fetching oral exam history
export function useOralExamHistory(curriculumId?: string) {
  return useQuery({
    queryKey: ['oral-exam-history', curriculumId],
    queryFn: async () => {
      let query = supabase
        .from('oral_exam_sessions')
        .select(`
          *,
          curriculum:curricula(title),
          questions:oral_exam_questions(count)
        `)
        .order('started_at', { ascending: false })
        .limit(20);
      
      if (curriculumId) {
        query = query.eq('curriculum_id', curriculumId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    staleTime: 60_000
  });
}
