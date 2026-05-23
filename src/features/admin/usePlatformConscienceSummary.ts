import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PlatformConscienceP18 {
  open_drifts: number;
  blocked_findings: number;
  healed_count: number;
  rejected_count: number;
  escalated_count: number;
  total_count: number;
  last_entry_at: string | null;
  last_entry_drift_type: string | null;
  last_entry_status: string | null;
}

export interface PlatformConscienceGil {
  market_signals_total: number;
  internal_drift_signals: number;
  open_signals: number;
  critical_signals: number;
  last_signal_at: string | null;
  briefings_total: number;
  last_briefing_at: string | null;
  last_briefing_headline: string | null;
  open_recommendations: number;
}

export interface PlatformConscienceRuntime {
  ai_runs_total: number;
  ai_runs_failed_7d: number;
  ai_runs_succeeded_7d: number;
  ai_runs_running: number;
  last_run_at: string | null;
  policy_versions_total: number;
  policy_versions_active: number;
}

export interface PlatformConscienceSummary {
  p18: PlatformConscienceP18;
  gil: PlatformConscienceGil;
  runtime: PlatformConscienceRuntime;
  generated_at: string;
}

export function usePlatformConscienceSummary() {
  return useQuery<PlatformConscienceSummary>({
    queryKey: ["admin", "platform-conscience-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_platform_conscience_summary");
      if (error) throw error;
      return data as unknown as PlatformConscienceSummary;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
