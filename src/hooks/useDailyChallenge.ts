import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface DailyChallengeQuestion {
  id: string;
  question_text: string;
  question_type: string;
  options: string[];
  difficulty: string;
  competency_id: string;
}

export interface DailyChallengeStreak {
  current: number;
  longest: number;
  total_completed: number;
}

export interface DailyChallengeAnswer {
  question_id: string;
  selected_index: number;
  correct_index: number;
  is_correct: boolean;
}

export interface DailyChallengeState {
  challengeId: string | null;
  challengeDate: string | null;
  questions: DailyChallengeQuestion[];
  answers: DailyChallengeAnswer[];
  completed: boolean;
  correctCount: number;
  totalQuestions: number;
  streak: DailyChallengeStreak;
}

type Phase = 'idle' | 'loading' | 'active' | 'feedback' | 'completed' | 'error';

export function useDailyChallenge(curriculumId?: string) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [state, setState] = useState<DailyChallengeState>({
    challengeId: null,
    challengeDate: null,
    questions: [],
    answers: [],
    completed: false,
    correctCount: 0,
    totalQuestions: 0,
    streak: { current: 0, longest: 0, total_completed: 0 },
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastFeedback, setLastFeedback] = useState<{
    is_correct: boolean;
    correct_answer: number;
    explanation: string;
  } | null>(null);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('daily-challenge', { body });
    if (error) throw error;
    return data;
  }, []);

  const loadChallenge = useCallback(async () => {
    if (!user || !curriculumId) return;
    setPhase('loading');
    try {
      const data = await invoke({ action: 'get', curriculum_id: curriculumId });
      if (data.error) {
        toast.error(data.error === 'NOT_ENOUGH_QUESTIONS'
          ? 'Nicht genug Fragen für die Daily Challenge verfügbar.'
          : data.error);
        setPhase('error');
        return;
      }

      const answeredCount = (data.answers || []).length;
      setState({
        challengeId: data.challenge_id,
        challengeDate: data.challenge_date,
        questions: data.questions || [],
        answers: data.answers || [],
        completed: data.completed,
        correctCount: data.correct_count,
        totalQuestions: data.total_questions,
        streak: data.streak || { current: 0, longest: 0, total_completed: 0 },
      });
      setCurrentIndex(answeredCount);
      setPhase(data.completed ? 'completed' : 'active');
    } catch (e) {
      console.error('[daily-challenge] load error:', e);
      toast.error('Challenge konnte nicht geladen werden');
      setPhase('error');
    }
  }, [user, curriculumId, invoke]);

  const submitAnswer = useCallback(async (selectedIndex: number) => {
    if (!state.challengeId || !state.questions[currentIndex]) return;
    setPhase('feedback');

    try {
      const data = await invoke({
        action: 'submit',
        challenge_id: state.challengeId,
        question_id: state.questions[currentIndex].id,
        selected_index: selectedIndex,
      });

      if (data.error) {
        toast.error(data.error);
        setPhase('active');
        return;
      }

      setLastFeedback({
        is_correct: data.is_correct,
        correct_answer: data.correct_answer,
        explanation: data.explanation,
      });

      setState(prev => ({
        ...prev,
        correctCount: data.correct_count,
        completed: data.completed,
        answers: [
          ...prev.answers,
          {
            question_id: prev.questions[currentIndex].id,
            selected_index: selectedIndex,
            correct_index: data.correct_answer,
            is_correct: data.is_correct,
          },
        ],
      }));

      if (data.completed) {
        // Reload to get updated streak
        setTimeout(async () => {
          try {
            const refreshed = await invoke({ action: 'get', curriculum_id: curriculumId! });
            if (!refreshed.error) {
              setState(prev => ({
                ...prev,
                streak: refreshed.streak || prev.streak,
              }));
            }
          } catch { /* non-critical */ }
        }, 500);
      }
    } catch (e) {
      console.error('[daily-challenge] submit error:', e);
      toast.error('Antwort konnte nicht gesendet werden');
      setPhase('active');
    }
  }, [state.challengeId, state.questions, currentIndex, invoke, curriculumId]);

  const nextQuestion = useCallback(() => {
    if (state.completed) {
      setPhase('completed');
    } else {
      setCurrentIndex(prev => prev + 1);
      setLastFeedback(null);
      setPhase('active');
    }
  }, [state.completed]);

  const currentQuestion = state.questions[currentIndex] ?? null;
  const progress = state.totalQuestions > 0
    ? ((state.answers.length) / state.totalQuestions) * 100
    : 0;

  return {
    phase,
    state,
    currentQuestion,
    currentIndex,
    lastFeedback,
    progress,
    loadChallenge,
    submitAnswer,
    nextQuestion,
  };
}
