import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface OrgPerformanceRow {
  user_id: string;
  display_name: string;
  product_id: string;
  product_title: string | null;
  readiness_score: number;
  risk_level: string;
  mastery_pct: number;
  progress_pct: number;
  last_exam_score: number;
  last_activity_at: string | null;
  inactive_days: number;
  seat_status: string;
}

export interface OrgPerformanceSummary {
  total_learners: number;
  avg_readiness: number;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  inactive_count: number;
  not_started_count: number;
  avg_progress: number;
  avg_exam_score: number | null;
}

export function useOrgPerformanceDashboard(orgId?: string, productId?: string) {
  return useQuery({
    queryKey: ['org-performance-dashboard', orgId, productId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase.rpc('get_org_performance_dashboard' as any, {
        p_org_id: orgId,
        p_product_id: productId ?? null,
      });
      if (error) throw error;
      return (data || []) as OrgPerformanceRow[];
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export function useOrgPerformanceSummary(orgId?: string, productId?: string) {
  return useQuery({
    queryKey: ['org-performance-summary', orgId, productId],
    queryFn: async () => {
      if (!orgId) return null;
      const { data, error } = await supabase.rpc('get_org_performance_summary' as any, {
        p_org_id: orgId,
        p_product_id: productId ?? null,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as OrgPerformanceSummary;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });
}
