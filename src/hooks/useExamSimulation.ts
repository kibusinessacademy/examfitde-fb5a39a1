import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';

export interface ExamBlueprint {
  id: string;
  curriculum_id: string;
  title: string;
  description: string | null;
  total_questions: number;
  time_limit_minutes: number;
  pass_threshold: number;
  difficulty_distribution: {
    easy: number;
    medium: number;
    hard: number;
  };
  frozen: boolean;
}

export interface ExamSession {
  id: string;
  user_id: string;
  curriculum_id: string;
  blueprint_id: string;
  mode: 'simulation' | 'practice' | 'timed_exam' | 'adaptive';
  seed: number;
  total_questions: number;
  time_limit_minutes: number | null;
  started_at: string;
  finished_at: string | null;
  current_index: number;
  score_percentage: number | null;
  passed: boolean | null;
}

export interface ExamSessionQuestion {
  id: string;
  exam_session_id: string;
  question_id: string;
  order_index: number;
  difficulty: string;
  learning_field_code: string | null;
  competency_code: string | null;
  user_answer: number | null;
  is_correct: boolean | null;
  answered_at: string | null;
  time_spent_seconds: number;
}

export interface ExamQuestion {
  id: string;
  question_text: string;
  options: string[];
  difficulty: string;
  explanation: string | null;
}

export interface AnswerResult {
  is_correct: boolean;
  correct_answer: number;
  explanation: string | null;
  explanation_correct?: string | null;
  explanation_wrong?: string | null;
}

export interface ExamResult {
  total_questions: number;
  correct_answers: number;
  score_percentage: number;
  passed: boolean;
  pass_threshold: number;
  breakdown: {
    by_difficulty: Record<string, { total: number; correct: number }>;
    by_learning_field: Record<string, { total: number; correct: number }>;
  };
}

// Fetch available blueprints – SSOT: only published+integrity+council-approved packages
export function useExamBlueprints() {
  return useQuery({
    queryKey: ['exam-blueprints-ssot'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_learner_visible_exam_simulations');
      if (error) throw error;
      
      return (data ?? []).map((b: any) => ({
        id: b.blueprint_id,
        curriculum_id: b.curriculum_id,
        title: b.title,
        description: b.description,
        total_questions: b.total_questions,
        time_limit_minutes: b.time_limit_minutes,
        pass_threshold: b.pass_threshold,
        difficulty_distribution: b.difficulty_distribution as ExamBlueprint['difficulty_distribution'],
        frozen: true,
      })) as ExamBlueprint[];
    },
  });
}

// Fetch active exam session for user
export function useActiveExamSession() {
  return useQuery({
    queryKey: ['active-exam-session'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_sessions')
        .select('*')
        .is('finished_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data as ExamSession | null;
    },
  });
}

// Fetch exam session details
export function useExamSession(sessionId?: string) {
  return useQuery({
    queryKey: ['exam-session', sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      
      const { data, error } = await supabase
        .from('exam_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
      
      if (error) throw error;
      return data as ExamSession;
    },
    enabled: !!sessionId,
  });
}

// Fetch questions for a session
export function useExamSessionQuestions(sessionId?: string) {
  return useQuery({
    queryKey: ['exam-session-questions', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];

      const { data, error } = await supabase.functions.invoke('get-exam-session-questions', {
        body: { session_id: sessionId },
      });

      if (error) throw error;

      const items = (data?.questions || []) as Array<any>;
      return items.map((sq) => ({
        ...sq,
        // shape for UI: { ..., question: { question_text, options, difficulty } }
        question: sq.question as unknown as ExamQuestion,
      }));
    },
    enabled: !!sessionId,
  });
}


// Start new exam session
export function useStartExamSession() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      blueprintId, 
      mode = 'simulation' 
    }: { 
      blueprintId: string; 
      mode?: 'simulation' | 'practice' | 'timed_exam' | 'adaptive';
    }) => {
      const { data, error } = await supabase
        .rpc('start_exam_session', {
          p_blueprint_id: blueprintId,
          p_mode: mode,
        });
      
      if (error) throw error;
      return data as string;
    },
    onSuccess: (sessionId) => {
      queryClient.invalidateQueries({ queryKey: ['active-exam-session'] });
      queryClient.invalidateQueries({ queryKey: ['exam-session', sessionId] });
      toast.success('Prüfungssimulation gestartet');
    },
    onError: (error) => {
      const msg = getReadableErrorMessage(error);
      if (msg.includes('READINESS_BLOCKED')) {
        const reason = msg.replace(/.*READINESS_BLOCKED:\s*/, '');
        toast.error('Simulation gesperrt', { 
          description: reason || 'Du musst zuerst offene Schwächen nachtrainieren.',
          duration: 8000,
        });
      } else {
        toast.error('Fehler beim Starten', { description: msg });
      }
    },
  });
}

// Submit answer
export function useSubmitAnswer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      questionId,
      answer,
      timeSpent = 0,
      confidence,
    }: {
      sessionId: string;
      questionId: string;
      answer: number;
      timeSpent?: number;
      confidence?: number;
    }) => {
      const { data, error } = await supabase.functions.invoke('submit-exam-answer', {
        body: {
          question_id: questionId,
          selected_answer: answer,
          session_id: sessionId,
          time_spent: timeSpent,
          confidence,
        },
      });

      if (error) throw error;

      return {
        is_correct: !!data?.is_correct,
        correct_answer: Number(data?.correct_answer ?? -1),
        explanation: (data?.explanation ?? null) as string | null,
        explanation_correct: (data?.explanation_correct ?? null) as string | null,
        explanation_wrong: (data?.explanation_wrong ?? null) as string | null,
      } as AnswerResult;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['exam-session-questions', variables.sessionId],
      });
    },
  });
}


// Finish exam session
export function useFinishExamSession() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase
        .rpc('finish_exam_session', {
          p_session_id: sessionId,
        });
      
      if (error) throw error;
      return data as unknown as ExamResult;
    },
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ['exam-session', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['active-exam-session'] });
      toast.success('Prüfung abgeschlossen');
    },
    onError: (error) => {
      toast.error('Fehler beim Abschließen', { description: String(error) });
    },
  });
}

// Main hook for exam simulation state management
export function useExamSimulation(sessionId?: string) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [lastAnswer, setLastAnswer] = useState<AnswerResult | null>(null);
  
  const { data: session, isLoading: sessionLoading } = useExamSession(sessionId);
  const { data: questions, isLoading: questionsLoading } = useExamSessionQuestions(sessionId);
  const submitAnswer = useSubmitAnswer();
  const finishExam = useFinishExamSession();
  
  const currentQuestion = questions?.[currentIndex];
  const totalQuestions = questions?.length || 0;
  const answeredCount = questions?.filter(q => q.user_answer !== null).length || 0;
  const isComplete = session?.finished_at !== null;
  
  const handleAnswer = useCallback(async (answer: number, timeSpent?: number, confidence?: number) => {
    if (!sessionId || !currentQuestion) return;

    const result = await submitAnswer.mutateAsync({
      sessionId,
      questionId: currentQuestion.question_id,
      answer,
      timeSpent,
      confidence,
    });

    setLastAnswer(result);
    setShowResult(true);
  }, [sessionId, currentQuestion, submitAnswer]);

  
  const handleNext = useCallback(() => {
    setShowResult(false);
    setLastAnswer(null);
    
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, totalQuestions]);
  
  const handlePrevious = useCallback(() => {
    setShowResult(false);
    setLastAnswer(null);
    
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex]);
  
  const handleFinish = useCallback(async () => {
    if (!sessionId) return;
    return finishExam.mutateAsync(sessionId);
  }, [sessionId, finishExam]);
  
  const goToQuestion = useCallback((index: number) => {
    setShowResult(false);
    setLastAnswer(null);
    setCurrentIndex(index);
  }, []);
  
  return {
    session,
    questions,
    currentQuestion,
    currentIndex,
    totalQuestions,
    answeredCount,
    isComplete,
    showResult,
    lastAnswer,
    isLoading: sessionLoading || questionsLoading,
    isSubmitting: submitAnswer.isPending,
    isFinishing: finishExam.isPending,
    handleAnswer,
    handleNext,
    handlePrevious,
    handleFinish,
    goToQuestion,
  };
}
