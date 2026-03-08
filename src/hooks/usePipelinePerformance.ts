import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function usePipelinePerformance() {
  return useQuery({
    queryKey: ["pipeline-performance-snapshot"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_pipeline_performance_snapshot");
      if (error) throw error;
      return data as {
        lessons_last_hour: number;
        lessons_last_12h: number;
        avg_lessons_per_hour_12h: number;
        cooldown_loss: Array<{
          provider: string;
          model: string;
          cooldown_events: number;
          cooldown_minutes_lost_12h: number;
        }>;
        provider_fail_rates: Array<{
          provider: string;
          model: string;
          total_jobs: number;
          failed_jobs: number;
          success_jobs: number;
          fail_rate_pct: number;
        }>;
        building_eta: Array<{
          package_id: string;
          title: string;
          build_progress: number;
          real_lessons: number;
          total_lessons: number;
          remaining_lessons: number;
          global_lessons_per_hour: number;
          eta_hours_content_only: number | null;
          updated_at: string;
        }>;
      };
    },
    refetchInterval: 15_000,
  });
}
