import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PipelineHealthBreakdown {
  score: number;
  max: number;
  [key: string]: unknown;
}

export interface PipelineHealthScore {
  total_score: number;
  traffic_light: "green" | "yellow" | "red";
  breakdown: {
    queue_latency: PipelineHealthBreakdown;
    stuck_processing: PipelineHealthBreakdown;
    content_integrity: PipelineHealthBreakdown;
    step_progression: PipelineHealthBreakdown;
    error_mix: PipelineHealthBreakdown;
  };
  computed_at: string;
}

export interface QueueLatencyItem {
  job_type: string;
  pending_jobs: number;
  avg_wait_seconds: number;
  max_wait_seconds: number;
  p50_wait_seconds: number;
  p90_wait_seconds: number;
}

export interface StuckProcessingItem {
  job_type: string;
  stuck_jobs: number;
  avg_stale_seconds: number;
  max_stale_seconds: number;
}

export interface ContentIntegrityItem {
  package_id: string;
  title: string;
  priority: number;
  status: string;
  total_lessons: number;
  real_lessons: number;
  hollow_lessons: number;
  real_pct: number;
}

export interface StepFunnelItem {
  package_id: string;
  title: string;
  priority: number;
  step_key: string;
  status: string;
  step_updated_at: string;
  last_error: string | null;
}

export interface ErrorClassItem {
  job_type: string;
  error_class: string;
  failed_cnt: number;
}

export interface PipelineHealthData {
  score: PipelineHealthScore;
  queue_latency: QueueLatencyItem[];
  stuck_processing: StuckProcessingItem[];
  content_integrity: ContentIntegrityItem[];
  step_funnel: StepFunnelItem[];
  error_class: ErrorClassItem[];
}

export function usePipelineHealth() {
  return useQuery<PipelineHealthData>({
    queryKey: ["pipeline-health"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("pipeline-health");
      if (error) throw error;
      return data as PipelineHealthData;
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
