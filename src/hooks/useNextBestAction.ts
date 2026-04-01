import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface NextBestAction {
  action: 'ONBOARDING' | 'CRASH_COURSE' | 'WEAKNESS_TRAINING' | 'EXAM_SIMULATION' | 'EXAM_FINAL';
  headline: string;
  subline: string;
  cta: string;
  route: string;
  readiness_score: number;
  risk_level: 'low' | 'medium' | 'high';
  bottleneck: {
    id: string;
    title: string;
    field: string;
    score: number;
  } | null;
  intent: 'onboarding' | 'weakness_training' | 'exam_simulation' | 'exam_final';
}

export function useNextBestAction(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['next-best-action', user?.id, curriculumId],
    queryFn: async (): Promise<NextBestAction | null> => {
      if (!user || !curriculumId) return null;

      const { data, error } = await supabase.rpc(
        'get_next_best_action' as any,
        {
          p_user_id: user.id,
          p_curriculum_id: curriculumId,
        }
      );

      if (error) throw error;
      return data as unknown as NextBestAction;
    },
    enabled: !!user && !!curriculumId,
    staleTime: 1000 * 60 * 2,
  });
}
