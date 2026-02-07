import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface DashboardStats {
  courses_completed: number;
  questions_answered: number;
  success_rate: number;
  streak: number;
}

const defaultStats: DashboardStats = {
  courses_completed: 0,
  questions_answered: 0,
  success_rate: 0,
  streak: 0,
};

export function useDashboardStats() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['dashboard-stats', user?.id],
    queryFn: async (): Promise<DashboardStats> => {
      if (!user) return defaultStats;

      const { data, error } = await supabase.rpc('get_user_dashboard_stats');

      if (error) {
        console.error('Error fetching dashboard stats:', error);
        return defaultStats;
      }

      return (data as unknown as DashboardStats) ?? defaultStats;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: true,
  });
}
