import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface CompetencyProgress {
  competency_id: string;
  curriculum_id: string;
  mastery_level: 'not_mastered' | 'partial' | 'mastered';
  score: number;
  attempts: number;
  last_updated: string;
}

export interface WeaknessEntry {
  user_id: string;
  curriculum_id: string;
  competency_id: string;
  competency_title: string;
  learning_field_title: string;
  sort_order: number;
  mastery_level: 'not_mastered' | 'partial';
  score: number;
  attempts: number;
  last_updated: string;
}

export interface ReadinessResult {
  readiness_score: number;
  risk_level: 'low' | 'medium' | 'high';
  mastery_pct: number;
  last_sim_score: number | null;
  mastered: number;
  partial: number;
  weak: number;
  total: number;
  persisted: boolean;
}

// ── Mastery progress for a curriculum ──
export function useMasteryProgress(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['mastery-progress', user?.id, curriculumId],
    queryFn: async () => {
      if (!user || !curriculumId) return [];

      const { data, error } = await supabase
        .from('user_competency_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculumId);

      if (error) throw error;
      return (data || []) as CompetencyProgress[];
    },
    enabled: !!user && !!curriculumId,
    staleTime: 30_000,
  });
}

// ── Weakness map (not-mastered + partial) ──
export function useWeaknessMap(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['weakness-map', user?.id, curriculumId],
    queryFn: async () => {
      if (!user || !curriculumId) return [];

      const { data, error } = await supabase
        .from('v_user_weakness_map' as any)
        .select('*')
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculumId);

      if (error) throw error;
      return (data || []) as unknown as WeaknessEntry[];
    },
    enabled: !!user && !!curriculumId,
    staleTime: 30_000,
  });
}

// ── Readiness score ──
export function useReadiness(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['readiness', user?.id, curriculumId],
    queryFn: async () => {
      if (!user || !curriculumId) return null;

      const { data, error } = await supabase
        .rpc('compute_readiness' as any, {
          p_user_id: user.id,
          p_curriculum_id: curriculumId,
        });

      if (error) throw error;
      return data as ReadinessResult;
    },
    enabled: !!user && !!curriculumId,
    staleTime: 60_000,
  });
}

// ── Update mastery from MiniCheck result ──
export function useUpdateMastery() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      competencyId,
      curriculumId,
      score,
    }: {
      competencyId: string;
      curriculumId: string;
      score: number;
    }) => {
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .rpc('update_mastery_from_minicheck' as any, {
          p_user_id: user.id,
          p_competency_id: competencyId,
          p_curriculum_id: curriculumId,
          p_score: score,
        });

      if (error) throw error;
      return data as {
        competency_id: string;
        old_level: string;
        new_level: string;
        score: number;
        level_changed: boolean;
      };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['mastery-progress', user?.id, variables.curriculumId] });
      queryClient.invalidateQueries({ queryKey: ['weakness-map', user?.id, variables.curriculumId] });
      queryClient.invalidateQueries({ queryKey: ['readiness', user?.id, variables.curriculumId] });
    },
  });
}

// ── Get adaptive exam questions ──
export function useAdaptiveExamQuestions(curriculumId?: string, limit = 40) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['adaptive-exam-questions', user?.id, curriculumId, limit],
    queryFn: async () => {
      if (!user || !curriculumId) return [];

      const { data, error } = await supabase
        .rpc('get_adaptive_exam_questions' as any, {
          p_user_id: user.id,
          p_curriculum_id: curriculumId,
          p_limit: limit,
        });

      if (error) throw error;
      return (data || []) as Array<{
        question_id: string;
        competency_id: string;
        difficulty: string;
        mastery_level: string;
        selection_weight: number;
      }>;
    },
    enabled: !!user && !!curriculumId,
    staleTime: 0, // Always fresh for exams
  });
}
