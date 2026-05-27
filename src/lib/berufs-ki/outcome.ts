import { supabase } from "@/integrations/supabase/client";

const sb = supabase as unknown as {
  rpc: (n: string, a?: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
  functions: { invoke: (n: string, opt: { body: unknown }) => Promise<{ data: unknown; error: { message: string } | null }> };
};

export type OutcomeReviewStatus =
  | "proposed" | "in_review" | "approved" | "rejected" | "applied" | "rolled_back";

export type BundleRiskTier = "LOW" | "MEDIUM" | "HIGH";

export interface OutcomeBundleSummary {
  id: string; outcome_goal: string; vertical_key: string;
  review_status: OutcomeReviewStatus;
  confidence: number | null; completeness_pct: number;
  agent_team: string[]; created_at: string; updated_at: string;
  is_demo?: boolean; risk_tier?: BundleRiskTier;
}

export interface OutcomeControlCenter {
  bundles: { total: number; proposed: number; in_review: number; approved: number;
    applied: number; rejected: number; rolled_back: number;
    avg_confidence: number | null; avg_completeness: number | null };
  verticals: { total: number; active: number };
  agent_team: Array<{ slug: string; name: string; category: string;
    runs_24h: number; requires_approval: boolean; is_active: boolean }>;
}

export interface BundleKpiMetric {
  metric_name: string; unit: string | null;
  baseline: number | null; target: number | null;
  delta: number | null; delta_pct: number | null;
  confidence: number | null; horizon: string | null;
}

export interface BundleDecisionEntry {
  bundle_id: string;
  action_type: string;
  decision: string;
  actor_id: string | null;
  reason: string | null;
  result_status: string | null;
  created_at: string;
}

export async function fetchOutcomeControlCenter(): Promise<OutcomeControlCenter> {
  const { data, error } = await sb.rpc("admin_outcome_control_center");
  if (error) throw error;
  return data as OutcomeControlCenter;
}

export async function listOutcomeBundles(vertical?: string, status?: OutcomeReviewStatus, limit = 100) {
  const { data, error } = await sb.rpc("admin_list_outcome_bundles", {
    _vertical: vertical ?? null, _status: status ?? null, _limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as OutcomeBundleSummary[];
}

export async function getOutcomeBundle(bundleId: string) {
  const { data, error } = await sb.rpc("admin_get_outcome_bundle", { _bundle_id: bundleId });
  if (error) throw error;
  return data as { bundle: Record<string, unknown>; vertical: Record<string, unknown>; artifacts: unknown[] };
}

export async function decideOutcomeBundle(bundleId: string, decision: "approve" | "reject" | "apply" | "rollback" | "in_review", reason: string) {
  const { data, error } = await sb.rpc("admin_decide_outcome_bundle", {
    _bundle_id: bundleId, _decision: decision, _reason: reason,
  });
  if (error) throw error;
  return data as { id: string; status: OutcomeReviewStatus };
}

export async function runOutcomeAgentTeam(input: {
  outcome_goal: string; vertical_key: string;
  agent_team?: string[]; context?: Record<string, unknown>; curriculum_id?: string;
}) {
  const { data, error } = await sb.functions.invoke("berufs-agent-outcome-run", { body: input });
  if (error) throw error;
  return data as { bundle_id: string; review_status: OutcomeReviewStatus; completeness_pct: number; confidence: number | null; agent_team: string[] };
}

// v1.1 — Premium Depth Layer
export async function getBundleKpiImpact(bundleId: string) {
  const { data, error } = await sb.rpc("admin_get_bundle_kpi_impact", { _bundle_id: bundleId });
  if (error) throw error;
  return data as { bundle_id: string; vertical_key: string; metrics: BundleKpiMetric[]; benchmarks: unknown[] };
}

export async function getBundleDecisionHistory(bundleId: string) {
  const { data, error } = await sb.rpc("admin_get_bundle_decision_history", { _bundle_id: bundleId });
  if (error) throw error;
  return (data ?? []) as BundleDecisionEntry[];
}

export async function getAgentVerticalMatrix() {
  const { data, error } = await sb.rpc("admin_get_agent_vertical_matrix");
  if (error) throw error;
  return data as {
    agents: Array<{ slug: string; name: string; category: string }>;
    verticals: Array<{ industry_key: string; name: string }>;
    cells: Array<{ agent_slug: string; vertical_key: string; bundle_count: number;
      avg_completeness: number | null; approved_count: number; high_risk_count: number; last_run_at: string | null }>;
  };
}

export async function exportOutcomeBundle(bundleId: string) {
  const { data, error } = await sb.functions.invoke("berufs-agent-outcome-export", { body: { bundle_id: bundleId } });
  if (error) throw error;
  return data as { markdown: string; filename: string; byte_size: number };
}
