import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface OpsHealthSummary {
  health_score: number;
  traffic_light: 'green' | 'yellow' | 'red';
  failed_total: number;
  failed_1h: number;
  failed_24h: number;
  pending_total: number;
  processing_total: number;
  stuck_jobs: number;
  total_packages: number;
  active_builds: number;
  failed_packages: number;
  integrity_issues: number;
  live_packages: number;
  daily_autofix_cost: number;
  active_autofix: number;
  frozen_autofix: number;
  heals_24h: number;
  heals_success_24h: number;
  heals_failed_24h: number;
  auto_heal_allowed: boolean;
}

export interface RootCause {
  code: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  recommended_action: string;
  action_type: string;
  risk: 'low' | 'medium' | 'high';
  auto_healable: boolean;
  params?: Record<string, unknown>;
}

export interface HealAction {
  action_type: string;
  target_id: string;
  target_type: string;
  params: Record<string, unknown>;
  description: string;
}

export interface DiagnosisResult {
  ok: boolean;
  health_score: number;
  traffic_light: 'green' | 'yellow' | 'red';
  auto_heal_allowed: boolean;
  incident_mode: boolean;
  incident_activated_at: string | null;
  root_causes: RootCause[];
  recommended_actions: HealAction[];
  cooldown_status: Record<string, { cooling: boolean; resumesAt: string | null }>;
  stats: {
    failed_1h: number;
    stuck_jobs: number;
    failed_packages: number;
    daily_cost: number;
    active_autofix: number;
    frozen_autofix: number;
  };
}

export interface HealEffectiveness {
  action_type: string;
  total_runs: number;
  successes: number;
  failures: number;
  skipped: number;
  success_rate: number;
  avg_duration_ms: number;
  followup_improved: number;
  followup_no_change: number;
  followup_regressed: number;
  avg_score_delta: number;
}

export function useOpsHealthSummary() {
  return useQuery({
    queryKey: ['ops-health-summary'],
    queryFn: async (): Promise<OpsHealthSummary | null> => {
      const { data, error } = await (supabase as any)
        .from('ops_health_summary')
        .select('*')
        .single();
      if (error) {
        console.error('Error fetching ops health summary:', error);
        return null;
      }
      return data;
    },
    refetchInterval: 10000,
  });
}

export function useOpsDiagnosis() {
  return useQuery({
    queryKey: ['ops-diagnosis'],
    queryFn: async (): Promise<DiagnosisResult | null> => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ops-auto-healer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ mode: 'diagnose' }),
      });
      if (!res.ok) throw new Error('Diagnosis failed');
      return res.json();
    },
    refetchInterval: 30000,
  });
}

export function useAutoHealLog() {
  return useQuery({
    queryKey: ['auto-heal-log'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('auto_heal_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 15000,
  });
}

export function useHealEffectiveness() {
  return useQuery({
    queryKey: ['heal-effectiveness'],
    queryFn: async (): Promise<HealEffectiveness[]> => {
      const { data, error } = await (supabase as any)
        .from('ops_heal_effectiveness')
        .select('*');
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60000,
  });
}

export function useHealAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      mode: 'heal' | 'heal_single' | 'incident_on' | 'incident_off';
      action_type?: string;
      package_id?: string;
      params?: Record<string, unknown>;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ops-auto-healer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          ...params,
          trigger_source: 'manual',
        }),
      });
      if (!res.ok) throw new Error('Heal action failed');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success('Auto-Heal Aktion ausgeführt');
      } else {
        toast.error(data.reason || 'Auto-Heal nicht möglich');
      }
      queryClient.invalidateQueries({ queryKey: ['ops-diagnosis'] });
      queryClient.invalidateQueries({ queryKey: ['ops-health-summary'] });
      queryClient.invalidateQueries({ queryKey: ['auto-heal-log'] });
      queryClient.invalidateQueries({ queryKey: ['heal-effectiveness'] });
    },
    onError: (e: Error) => {
      toast.error(`Fehler: ${e.message}`);
    },
  });
}
