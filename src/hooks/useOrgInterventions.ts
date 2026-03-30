import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface OrgIntervention {
  id: string;
  org_id: string;
  user_id: string | null;
  display_name: string;
  product_id: string | null;
  product_title: string | null;
  intervention_type: string;
  trigger_type: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  recommendation_json: Record<string, unknown>;
  context_json: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
}

export interface OrgInterventionSummary {
  total_open: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  resolved_this_week: number;
  created_today: number;
}

export function useOrgInterventions(orgId?: string, status?: string, severity?: string) {
  return useQuery({
    queryKey: ['org-interventions', orgId, status, severity],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase.rpc('get_org_interventions' as any, {
        p_org_id: orgId,
        p_status: status ?? null,
        p_severity: severity ?? null,
      });
      if (error) throw error;
      return (data || []) as OrgIntervention[];
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

export function useOrgInterventionSummary(orgId?: string) {
  return useQuery({
    queryKey: ['org-intervention-summary', orgId],
    queryFn: async () => {
      if (!orgId) return null;
      const { data, error } = await supabase.rpc('get_org_intervention_summary' as any, {
        p_org_id: orgId,
      });
      if (error) throw error;
      return data as OrgInterventionSummary;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

export function useScanOrgInterventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orgId, productId }: { orgId: string; productId?: string }) => {
      const { data, error } = await supabase.rpc('scan_org_interventions' as any, {
        p_org_id: orgId,
        p_product_id: productId ?? null,
      });
      if (error) throw error;
      return data as { success: boolean; interventions_created: number };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['org-interventions', vars.orgId] });
      qc.invalidateQueries({ queryKey: ['org-intervention-summary', vars.orgId] });
    },
  });
}

export function useResolveIntervention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ interventionId, action, note }: { interventionId: string; action: string; note?: string }) => {
      const { data, error } = await supabase.rpc('resolve_org_intervention' as any, {
        p_intervention_id: interventionId,
        p_action: action,
        p_note: note ?? null,
      });
      if (error) throw error;
      return data as { success: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-interventions'] });
      qc.invalidateQueries({ queryKey: ['org-intervention-summary'] });
    },
  });
}
