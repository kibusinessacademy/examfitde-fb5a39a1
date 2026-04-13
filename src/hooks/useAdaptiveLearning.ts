import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

// Types for adaptive learning system
export interface LearnerDiagnostic {
  id: string;
  user_id: string;
  curriculum_id: string;
  completed_at: string | null;
  results: DiagnosticResult[];
  exam_date: string | null;
  weekly_time_minutes: number;
  focus_areas: string[] | null;
  recommended_path: 'course_first' | 'exam_trainer' | 'mixed' | null;
  estimated_readiness_date: string | null;
}

export interface DiagnosticResult {
  competency_id: string;
  competency_title?: string;
  score: number;
  level: 'weak' | 'partial' | 'strong';
}

export interface ReadinessScore {
  overall_readiness: number;
  predicted_exam_score: number;
  weak_areas: { competency_id: string; title: string; score: number }[];
  strong_areas: { competency_id: string; title: string; score: number }[];
  trend: 'improving' | 'stable' | 'declining';
  days_until_ready: number;
}

export interface AdaptiveRecommendation {
  action: 'DIAGNOSTIC' | 'COURSE' | 'SIMULATION' | 'ORAL_TRAINER' | 'WEAKNESS_MODE' | 'CONTINUE';
  reason: string;
  route: string;
  priority: 'high' | 'medium' | 'low';
  weak_count?: number;
  days_until_exam?: number;
}

// Hook to fetch learner's diagnostic data
export function useLearnerDiagnostic(curriculumId?: string) {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['learner-diagnostic', user?.id, curriculumId],
    queryFn: async (): Promise<LearnerDiagnostic | null> => {
      if (!user || !curriculumId) return null;
      
      const { data, error } = await supabase
        .from('learner_diagnostics')
        .select('*')
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculumId)
        .maybeSingle();
      
      if (error) throw error;
      if (!data) return null;
      
      return {
        ...data,
        results: (data.results as unknown as DiagnosticResult[]) || [],
        recommended_path: data.recommended_path as LearnerDiagnostic['recommended_path'],
      };
    },
    enabled: !!user && !!curriculumId,
  });
}

// Hook to check if user needs diagnostic test
export function useNeedsDiagnostic(curriculumId?: string) {
  const { data: diagnostic, isLoading } = useLearnerDiagnostic(curriculumId);
  
  return {
    needsDiagnostic: !isLoading && !diagnostic,
    isLoading,
    diagnostic,
  };
}

// Hook to save diagnostic results
export function useSaveDiagnostic() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (data: {
      curriculumId: string;
      results: DiagnosticResult[];
      examDate?: Date;
      weeklyTimeMinutes?: number;
      focusAreas?: string[];
    }) => {
      if (!user) throw new Error('Not authenticated');
      
      // Calculate recommended path based on results
      const avgScore = data.results.reduce((sum, r) => sum + r.score, 0) / data.results.length;
      const weakCount = data.results.filter(r => r.level === 'weak').length;
      
      let recommendedPath: 'course_first' | 'exam_trainer' | 'mixed' = 'mixed';
      if (weakCount > data.results.length * 0.5) {
        recommendedPath = 'course_first';
      } else if (avgScore > 70) {
        recommendedPath = 'exam_trainer';
      }
      
      const { data: result, error } = await supabase
        .from('learner_diagnostics')
        .upsert({
          user_id: user.id,
          curriculum_id: data.curriculumId,
          results: JSON.parse(JSON.stringify(data.results)),
          exam_date: data.examDate?.toISOString().split('T')[0] || null,
          weekly_time_minutes: data.weeklyTimeMinutes || 300,
          focus_areas: data.focusAreas || [],
          recommended_path: recommendedPath,
          completed_at: new Date().toISOString(),
        }, { onConflict: 'user_id,curriculum_id' })
        .select()
        .single();
      
      if (error) throw error;
      return result;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['learner-diagnostic', user?.id, variables.curriculumId] });
      queryClient.invalidateQueries({ queryKey: ['adaptive-recommendation'] });
      toast.success('Diagnosetest abgeschlossen');
    },
    onError: (error) => {
      toast.error('Fehler beim Speichern', { description: String(error) });
    },
  });
}

// Hook to get readiness score
export function useReadinessScore(curriculumId?: string) {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['readiness-score', user?.id, curriculumId],
    queryFn: async (): Promise<ReadinessScore | null> => {
      if (!user || !curriculumId) return null;
      
      // v2: adds confidence_level + recommendation
      const { data, error } = await supabase
        .rpc('calculate_readiness_score_v2' as any, {
          p_user_id: user.id,
          p_curriculum_id: curriculumId,
        });
      
      if (error) throw error;
      if (!data || data.length === 0) return null;
      
      const result = data[0] as Record<string, unknown>;
      return {
        overall_readiness: Number(result.overall_readiness) || 0,
        predicted_exam_score: Number(result.predicted_exam_score) || 0,
        weak_areas: (result.weak_areas as { competency_id: string; title: string; score: number }[]) || [],
        strong_areas: (result.strong_areas as { competency_id: string; title: string; score: number }[]) || [],
        trend: (result.trend as 'improving' | 'stable' | 'declining') || 'stable',
        days_until_ready: Number(result.days_until_ready) || 30,
      };
    },
    enabled: !!user && !!curriculumId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Hook to get adaptive recommendation
export function useAdaptiveRecommendation(curriculumId?: string) {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['adaptive-recommendation', user?.id, curriculumId],
    queryFn: async (): Promise<AdaptiveRecommendation | null> => {
      if (!user || !curriculumId) return null;
      
      const { data, error } = await supabase
        .rpc('get_adaptive_recommendation', {
          p_user_id: user.id,
          p_curriculum_id: curriculumId,
        });
      
      if (error) throw error;
      return data as unknown as AdaptiveRecommendation;
    },
    enabled: !!user && !!curriculumId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

// Hook to start weakness mode exam
export function useStartWeaknessExam() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (blueprintId: string) => {
      const { data, error } = await supabase
        .rpc('start_weakness_exam_session', {
          p_blueprint_id: blueprintId,
        });
      
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-exam-session'] });
      toast.success('Schwächenmodus gestartet');
    },
    onError: (error) => {
      toast.error('Fehler beim Starten', { description: String(error) });
    },
  });
}
