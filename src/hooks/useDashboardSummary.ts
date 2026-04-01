import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface DashboardEnrollment {
  course_id: string;
  enrolled_at: string;
  last_accessed_at: string | null;
  completed_at: string | null;
  curriculum_id: string | null;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  estimated_duration: number | null;
  total_lessons: number;
  completed_lessons: number;
}

export interface DashboardSummary {
  enrollments: DashboardEnrollment[];
  active_curriculum_id: string | null;
}

export function useDashboardSummary() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['dashboard-summary', user?.id],
    queryFn: async (): Promise<DashboardSummary> => {
      if (!user) return { enrollments: [], active_curriculum_id: null };

      const { data, error } = await supabase.rpc(
        'get_dashboard_summary' as any,
        { p_user_id: user.id }
      );

      if (error) throw error;
      const result = data as unknown as DashboardSummary;
      return {
        enrollments: result?.enrollments || [],
        active_curriculum_id: result?.active_curriculum_id || null,
      };
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 2,
  });
}
