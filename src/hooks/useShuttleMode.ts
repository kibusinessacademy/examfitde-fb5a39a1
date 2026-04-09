import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export type ShuttleMode = 'adaptive' | 'random' | 'weakness' | 'speed' | 'exam_lite';

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
  xp_awarded?: number;
  streak?: number;
  best_streak?: number;
  ai_explanation?: string;
  ai_explanation_loading?: boolean;
}

export interface ShuttleStats {
  questions_answered: number;
  correct_count: number;
  accuracy: number;
  current_streak: number;
  best_streak: number;
  xp_earned: number;
}

export interface ShuttleDashboardSummary {
  today_answered: number;
  today_correct: number;
  today_accuracy: number;
  lifetime_questions: number;
  lifetime_correct: number;
  lifetime_accuracy: number;
  current_streak: number;
  best_streak: number;
  total_sessions: number;
  weakest_competency: { id: string; title: string; score: number } | null;
  recommended_mode: ShuttleMode;
}

type ShuttlePhase = 'idle' | 'loading' | 'question' | 'feedback' | 'ended' | 'error';

const INITIAL_STATS: ShuttleStats = {
  questions_answered: 0, correct_count: 0, accuracy: 0,
  current_streak: 0, best_streak: 0, xp_earned: 0,
};

export function useShuttleMode(curriculumId?: string) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<ShuttlePhase>('idle');
  const [mode, setMode] = useState<ShuttleMode>('adaptive');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<ShuttleQuestion | null>(null);
  const [feedback, setFeedback] = useState<ShuttleFeedback | null>(null);
  const [stats, setStats] = useState<ShuttleStats>(INITIAL_STATS);
  const [dashboardSummary, setDashboardSummary] = useState<ShuttleDashboardSummary | null>(null);
  const questionStartTime = useRef<number>(0);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('shuttle-engine', { body });
    if (error) throw error;
    return data;
  }, []);

  const fetchDashboard = useCallback(async () => {
    if (!user || !curriculumId) return;
    try {
      const data = await invoke({ action: 'dashboard', curriculum_id: curriculumId });
      if (data?.summary) {
        setDashboardSummary(data.summary);
        // Use recommended mode
        if (data.summary.recommended_mode) {
          setMode(data.summary.recommended_mode);
        }
      }
    } catch (err) {
      console.error('[shuttle] dashboard error:', err);
    }
  }, [user, curriculumId, invoke]);

  const startSession = useCallback(async (selectedMode?: ShuttleMode) => {
    if (!user || !curriculumId) return;
    const effectiveMode = selectedMode || mode;
    setMode(effectiveMode);
    setPhase('loading');
    try {
      const data = await invoke({
        action: 'start',
        curriculum_id: curriculumId,
        mode: effectiveMode,
        started_from: 'shuttle_page',
      });
      setSessionId(data.session.id);

      // Restore stats if resumed
      if (data.session.resumed) {
        setStats({
          questions_answered: data.session.questions_answered || 0,
          correct_count: data.session.correct_count || 0,
          accuracy: data.session.questions_answered > 0
            ? Math.round((data.session.correct_count / data.session.questions_answered) * 100) : 0,
          current_streak: data.session.current_streak || 0,
          best_streak: data.session.best_streak || 0,
          xp_earned: data.session.xp_earned || 0,
        });
      } else {
        setStats(INITIAL_STATS);
      }

      // Fetch first question
      const qData = await invoke({
        action: 'next',
        curriculum_id: curriculumId,
        session_id: data.session.id,
        mode: effectiveMode,
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
  }, [user, curriculumId, mode, invoke]);

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
      const fb = data.feedback;
      setFeedback(fb);
      setStats(prev => {
        const qa = prev.questions_answered + 1;
        const cc = prev.correct_count + (fb.is_correct ? 1 : 0);
        return {
          questions_answered: qa,
          correct_count: cc,
          accuracy: Math.round((cc / qa) * 100),
          current_streak: fb.streak ?? (fb.is_correct ? prev.current_streak + 1 : 0),
          best_streak: fb.best_streak ?? Math.max(prev.best_streak, fb.is_correct ? prev.current_streak + 1 : prev.best_streak),
          xp_earned: prev.xp_earned + (fb.xp_awarded || 0),
        };
      });
      setPhase('feedback');
    } catch (err) {
      console.error('[shuttle] submit error:', err);
      toast.error('Fehler beim Absenden');
      setPhase('question');
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
        mode,
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
  }, [sessionId, curriculumId, mode, invoke]);

  const endSession = useCallback(async () => {
    if (!sessionId) { setPhase('idle'); return; }
    try {
      const data = await invoke({ action: 'end', session_id: sessionId });
      setStats(prev => ({
        ...prev,
        ...data.summary,
        accuracy: data.summary.accuracy,
      }));
      setPhase('ended');
    } catch {
      setPhase('ended');
    }
  }, [sessionId, invoke]);

  const explainMistake = useCallback(async (questionId: string, selectedAnswer: number) => {
    if (!questionId) return;
    setFeedback(prev => prev ? { ...prev, ai_explanation_loading: true } : prev);
    try {
      const data = await invoke({
        action: 'explain',
        question_id: questionId,
        selected_answer: selectedAnswer,
        curriculum_id: curriculumId,
      });
      setFeedback(prev => prev ? {
        ...prev,
        ai_explanation: data.explanation,
        ai_explanation_loading: false,
      } : prev);
    } catch (err) {
      console.error('[shuttle] explain error:', err);
      setFeedback(prev => prev ? { ...prev, ai_explanation_loading: false } : prev);
      toast.error('Erklärung konnte nicht geladen werden');
    }
  }, [curriculumId, invoke]);

  const reset = useCallback(() => {
    setPhase('idle');
    setSessionId(null);
    setCurrentQuestion(null);
    setFeedback(null);
    setStats(INITIAL_STATS);
  }, []);

  return {
    phase, mode, setMode,
    currentQuestion, feedback, stats,
    sessionId, dashboardSummary,
    startSession, submitAnswer, nextQuestion,
    endSession, explainMistake, fetchDashboard, reset,
  };
}
