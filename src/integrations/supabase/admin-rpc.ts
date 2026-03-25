import { supabase } from "@/integrations/supabase/client";
import type {
  AdminControlTowerResponse,
  DashboardResponse,
  OpsJobItem,
  PackageRiskItem,
  ProviderHealthItem,
  RevenueOverview,
} from "@/components/admin/lib/admin-types";

async function callEdge<T>(fnName: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fnName, {
    body,
  });
  if (error) throw error;
  return data as T;
}

export const adminRpc = {
  controlTowerOverview: () =>
    callEdge<AdminControlTowerResponse>("admin-control-tower", { action: "overview" }),

  opsQueueOverview: () =>
    callEdge<OpsJobItem[]>("admin-control-tower", { action: "ops_queue" }),

  providerHealth: () =>
    callEdge<ProviderHealthItem[]>("admin-control-tower", { action: "provider_health" }),

  packageRiskBoard: () =>
    callEdge<PackageRiskItem[]>("admin-control-tower", { action: "package_risk" }),

  revenueOverview: () =>
    callEdge<RevenueOverview>("admin-control-tower", { action: "revenue" }),

  dashboard: () =>
    callEdge<DashboardResponse>("admin-control-tower", { action: "dashboard" }),

  executiveKpis: () =>
    callEdge<Record<string, unknown>>("admin-control-tower", { action: "executive_kpis" }),

  examPoolAudit: () =>
    callEdge<{
      packages: Array<{
        package_id: string;
        package_title: string | null;
        step_status: string;
        last_error: string | null;
        step_updated_at: string;
        diagnosis: string;
        total: number;
        draft: number;
        review: number;
        approved: number;
        tier1_passed: number;
      }>;
      guard_events: Array<{
        id: string;
        action_type: string;
        target_id: string | null;
        result_status: string;
        result_detail: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }>;
    }>("admin-control-tower", { action: "exam_pool_audit" }),

  trapCoverageAudit: () =>
    callEdge<{
      packages: Array<{
        package_id: string;
        title: string | null;
        status: string;
        approved_total: number;
        missing_trap: number;
        coverage_pct: number;
        risk: 'critical' | 'high' | 'medium' | 'ok';
      }>;
      global: { total: number; missing: number; coverage_pct: number };
    }>("admin-control-tower", { action: "trap_coverage_audit" }),

  trapQualityAudit: () =>
    callEdge<{
      generated_at: string;
      global: { packages_total: number; packages_warn: number; packages_hard_fail: number };
      packages: Array<{
        package_id: string;
        title: string | null;
        curriculum_id: string;
        track: string;
        profile: string;
        resolved_from: string;
        approved_total: number;
        actual_counts: Record<string, number>;
        actual_pct: Record<string, number>;
        details: Array<{
          trap_type: string;
          actual_pct: number;
          target_pct: number;
          signal: 'ok' | 'warn' | 'hard_fail';
          reason?: string;
        }>;
        anomaly_flags: string[];
        overall: 'ok' | 'warn' | 'hard_fail' | 'insufficient_sample';
        rebalance_recommended: boolean;
        recommended_focus: string[];
      }>;
    }>("admin-control-tower", { action: "trap_quality_audit" }),

  triggerExamRebalance: (packageId: string) =>
    callEdge<{ ok: boolean; actions: Array<{ type: string; detail: string; affected_count: number }> }>(
      "package-exam-rebalance",
      { package_id: packageId },
    ),
};
