import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { GilAgentKind } from '@/lib/gil/contracts';

// RPC types are regenerated post-migration; we use `any` casts here while the
// generated supabase types catch up. All RPCs are admin-gated server-side.
const rpc = supabase.rpc as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;

export interface GilOverview {
  competitors_total: number;
  signals_24h: number;
  signals_critical_open: number;
  insights_open: number;
  insights_by_agent: Record<string, number>;
  briefings_total: number;
  last_briefing_at: string | null;
  generated_at: string;
}

export function useGilOverview() {
  return useQuery<GilOverview>({
    queryKey: ['gil', 'overview'],
    queryFn: async () => {
      const { data, error } = await rpc('admin_get_growth_intelligence_overview');
      if (error) throw error;
      return data as GilOverview;
    },
    refetchInterval: 60_000,
  });
}

export function useGilBriefings(limit = 10) {
  return useQuery({
    queryKey: ['gil', 'briefings', limit],
    queryFn: async () => {
      const { data, error } = await rpc('admin_get_growth_briefings', { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useGilSignals(limit = 50, severity?: string) {
  return useQuery({
    queryKey: ['gil', 'signals', limit, severity ?? 'all'],
    queryFn: async () => {
      const { data, error } = await rpc('admin_get_market_signals', {
        p_limit: limit,
        p_severity: severity ?? null,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useGilCompetitors() {
  return useQuery({
    queryKey: ['gil', 'competitors'],
    queryFn: async () => {
      const { data, error } = await rpc('admin_get_competitor_profiles');
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useGilInsights(agentKind?: GilAgentKind, limit = 50) {
  return useQuery({
    queryKey: ['gil', 'insights', agentKind ?? 'all', limit],
    queryFn: async () => {
      const { data, error } = await rpc('admin_get_agent_insights', {
        p_agent_kind: agentKind ?? null,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useTriggerExecutiveBriefing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ reason, dryRun }: { reason: string; dryRun?: boolean }) => {
      const { error: auditErr } = await rpc('admin_run_executive_briefing', {
        p_reason: reason,
        p_dry_run: dryRun ?? false,
      });
      if (auditErr) throw auditErr;
      const { data, error } = await supabase.functions.invoke('executive-agent', {
        body: { reason, dry_run: dryRun ?? false },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gil'] });
    },
  });
}
