import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ShuttleQuestion {
  id: string;
  question_text: string;
  question_type: string;
  options: string[];
  competency_id: string;
  difficulty: string;
  trap_type: string | null;
}

export interface ShuttleFeedback {
  is_correct: boolean;
  correct_answer: number;
  explanation: string;
  trap_tags?: string[];
  distractor_meta?: Record<string, unknown>;
  correct_option_text?: string;
}

export interface ShuttleStats {
  questions_answered: number;
  correct_count: number;
  accuracy: number;
}

type ShuttlePhase = 'idle' | 'loading' | 'question' | 'feedback' | 'ended' | 'error';

export function useShuttleMode(curriculumId?: string) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<ShuttlePhase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<ShuttleQuestion | null>(null);
  const [feedback, setFeedback] = useState<ShuttleFeedback | null>(null);
  const [stats, setStats] = useState<ShuttleStats>({ questions_answered: 0, correct_count: 0, accuracy: 0 });
  const questionStartTime = useRef<number>(0);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('shuttle-engine', { body });
    if (error) throw error;
    return data;
  }, []);

  const startSession = useCallback(async () => {
    if (!user || !curriculumId) return;
    setPhase('loading');
    try {
      const data = await invoke({ action: 'start', curriculum_id: curriculumId });
      setSessionId(data.session.id);
      setStats({ questions_answered: 0, correct_count: 0, accuracy: 0 });

      // Immediately fetch first question
      const qData = await invoke({
        action: 'next',
        curriculum_id: curriculumId,
        session_id: data.session.id,
      });
      if (qData.question) {
        setCurrentQuestion(qData.question);
        questionStartTime.current = Date.now();
        setPhase('question');
      } else {
        toast.error('Keine Fragen verfügbar');
        setPhase('error');
      }
    } catch (err) {
      console.error('[shuttle] start error:', err);
      toast.error('Shuttle konnte nicht gestartet werden');
      setPhase('error');
    }
  }, [user, curriculumId, invoke]);

  const submitAnswer = useCallback(async (selectedAnswer: number) => {
    if (!sessionId || !currentQuestion) return;
    setPhase('loading');
    const responseTimeMs = Date.now() - questionStartTime.current;
    try {
      const data = await invoke({
        action: 'submit',
        session_id: sessionId,
        question_id: currentQuestion.id,
        selected_answer: selectedAnswer,
        response_time_ms: responseTimeMs,
        curriculum_id: curriculumId,
      });
      setFeedback(data.feedback);
      setStats(prev => ({
        questions_answered: prev.questions_answered + 1,
        correct_count: prev.correct_count + (data.feedback.is_correct ? 1 : 0),
        accuracy: Math.round(
          ((prev.correct_count + (data.feedback.is_correct ? 1 : 0)) /
            (prev.questions_answered + 1)) * 100
        ),
      }));
      setPhase('feedback');
    } catch (err) {
      console.error('[shuttle] submit error:', err);
      toast.error('Fehler beim Absenden');
      setPhase('question'); // Stay on question
    }
  }, [sessionId, currentQuestion, curriculumId, invoke]);

  const nextQuestion = useCallback(async () => {
    if (!sessionId || !curriculumId) return;
    setPhase('loading');
    setFeedback(null);
    try {
      const data = await invoke({
        action: 'next',
        curriculum_id: curriculumId,
        session_id: sessionId,
      });
      if (data.question) {
        setCurrentQuestion(data.question);
        questionStartTime.current = Date.now();
        setPhase('question');
      } else {
        await endSession();
      }
    } catch (err) {
      console.error('[shuttle] next error:', err);
      toast.error('Fehler beim Laden der nächsten Frage');
      setPhase('error');
    }
  }, [sessionId, curriculumId, invoke]);

  const endSession = useCallback(async () => {
    if (!sessionId) {
      setPhase('idle');
      return;
    }
    try {
      const data = await invoke({ action: 'end', session_id: sessionId });
      setStats(data.summary);
      setPhase('ended');
    } catch {
      setPhase('ended');
    }
  }, [sessionId, invoke]);

  const reset = useCallback(() => {
    setPhase('idle');
    setSessionId(null);
    setCurrentQuestion(null);
    setFeedback(null);
    setStats({ questions_answered: 0, correct_count: 0, accuracy: 0 });
  }, []);

  return {
    phase,
    currentQuestion,
    feedback,
    stats,
    sessionId,
    startSession,
    submitAnswer,
    nextQuestion,
    endSession,
    reset,
  };
}
