import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface WeakCompetency {
  competency_id: string;
  title: string;
  code: string;
  score: number;
  status: string;
}

export interface ExamReadiness {
  overall_readiness: number;
  mastery_score: number;
  simulation_score: number;
  readiness_level: 'ready' | 'almost_ready' | 'not_ready';
  total_competencies: number;
  mastered_count: number;
  partial_count: number;
  not_mastered_count: number;
  weak_competencies: WeakCompetency[];
  strong_competencies: { competency_id: string; title: string; code: string; score: number }[];
  simulation_allowed: boolean;
  simulation_blocked_reason: string | null;
  active_weakness_count: number;
  last_simulation_score: number;
}

export function useExamReadiness(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['exam-readiness', user?.id, curriculumId],
    queryFn: async (): Promise<ExamReadiness | null> => {
      if (!user || !curriculumId) return null;

      const { data, error } = await supabase.rpc('calculate_exam_readiness', {
        p_user_id: user.id,
        p_curriculum_id: curriculumId,
      });

      if (error) throw error;
      return data as unknown as ExamReadiness;
    },
    enabled: !!user && !!curriculumId,
    staleTime: 1000 * 60 * 2,
  });
}

export interface SimulationGate {
  allowed: boolean;
  readiness_level: string;
  blocked_reason: string | null;
  not_mastered_count: number;
  active_weakness_count: number;
  weak_competencies: WeakCompetency[];
}

export function useSimulationGate(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['simulation-gate', user?.id, curriculumId],
    queryFn: async (): Promise<SimulationGate | null> => {
      if (!user || !curriculumId) return null;

      const { data, error } = await supabase.rpc('check_simulation_gate', {
        p_user_id: user.id,
        p_curriculum_id: curriculumId,
      });

      if (error) throw error;
      return data as unknown as SimulationGate;
    },
    enabled: !!user && !!curriculumId,
    staleTime: 1000 * 60 * 1,
  });
}

export function useWeaknessAssignments(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['weakness-assignments', user?.id, curriculumId],
    queryFn: async () => {
      if (!user || !curriculumId) return [];

      const { data, error } = await supabase
        .from('weakness_assignments')
        .select(`
          *,
          competency:competencies(id, title, code)
        `)
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculumId)
        .in('status', ['active', 'training'])
        .order('assigned_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!curriculumId,
  });
}
