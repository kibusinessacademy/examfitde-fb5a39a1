import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SSOTHealthMetrics {
  ghostSuccesses: number;
  jobStepDrifts: number;
  processingLeaks: number;
  newHardFails: number;
  hardFailsByStep: { step_key: string; count: number }[];
  queuedWithoutJobs: number;
}

export function useSSOTHealthMetrics() {
  return useQuery({
    queryKey: ['ssot-health-metrics'],
    queryFn: async (): Promise<SSOTHealthMetrics> => {
      const [ghostRes, driftRes, processingRes, hardFailRes, queuedRes] = await Promise.all([
        // 1. Ghost successes: meta.ok=true but status not done/skipped
        supabase.rpc('fn_ssot_ghost_success_count' as any),

        // 2. Job/Step drift: completed jobs but step not done (24h)
        supabase.rpc('fn_ssot_job_step_drift_count' as any),

        // 3. Processing leaks > 15 min
        supabase.rpc('fn_ssot_processing_leak_count' as any),

        // 4. HARD_FAIL steps
        supabase.rpc('fn_ssot_hard_fail_summary' as any),

        // 5. Queued without active jobs (building packages only)
        supabase.rpc('fn_ssot_queued_without_jobs_count' as any),
      ]);

      const hardFails = (hardFailRes.data ?? []) as { step_key: string; cnt: number }[];
      const totalHardFails = hardFails.reduce((s, r) => s + (r.cnt ?? 0), 0);

      return {
        ghostSuccesses: (ghostRes.data as number) ?? 0,
        jobStepDrifts: (driftRes.data as number) ?? 0,
        processingLeaks: (processingRes.data as number) ?? 0,
        newHardFails: totalHardFails,
        hardFailsByStep: hardFails.map(r => ({ step_key: r.step_key, count: r.cnt })),
        queuedWithoutJobs: (queuedRes.data as number) ?? 0,
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
