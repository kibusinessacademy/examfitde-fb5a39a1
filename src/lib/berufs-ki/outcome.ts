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

// v2 Cut 2.1 — Business Intent Layer
export type BusinessIntentRiskLevel = "low" | "medium" | "high" | "critical";
export type BusinessIntentGovernanceLevel = "standard" | "sensitive" | "regulated" | "board_approval";

export interface BusinessIntent {
  id: string;
  intent_key: string;
  vertical_key: string;
  title: string;
  goal: string;
  target_kpi_json: Array<{ name: string; baseline?: number; target?: number; unit?: string }>;
  monetary_impact_eur: number | null;
  risk_level: BusinessIntentRiskLevel;
  governance_level: BusinessIntentGovernanceLevel;
  no_go_constraints: string[] | Record<string, unknown>[];
  target_audience: Record<string, unknown>;
  desired_transformation: string | null;
  is_active: boolean;
  linked_bundle_count: number;
  last_bundle_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterBusinessIntentInput {
  intent_key: string;
  vertical_key: string;
  title: string;
  goal: string;
  target_kpi?: unknown;
  monetary_impact_eur?: number | null;
  risk_level?: BusinessIntentRiskLevel;
  governance_level?: BusinessIntentGovernanceLevel;
  no_go_constraints?: unknown;
  target_audience?: unknown;
  desired_transformation?: string | null;
}

export async function listBusinessIntents(verticalKey?: string, activeOnly = true, limit = 200): Promise<BusinessIntent[]> {
  const { data, error } = await sb.rpc("admin_list_business_intents", {
    _vertical_key: verticalKey ?? null,
    _active_only: activeOnly,
    _limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as BusinessIntent[];
}

export async function registerBusinessIntent(input: RegisterBusinessIntentInput): Promise<{ intent_id: string; intent_key: string }> {
  const { data, error } = await sb.rpc("admin_register_business_intent", {
    _intent_key: input.intent_key,
    _vertical_key: input.vertical_key,
    _title: input.title,
    _goal: input.goal,
    _target_kpi: input.target_kpi ?? [],
    _monetary_impact_eur: input.monetary_impact_eur ?? null,
    _risk_level: input.risk_level ?? "medium",
    _governance_level: input.governance_level ?? "standard",
    _no_go_constraints: input.no_go_constraints ?? [],
    _target_audience: input.target_audience ?? {},
    _desired_transformation: input.desired_transformation ?? null,
  });
  if (error) throw error;
  return data as { intent_id: string; intent_key: string };
}

export async function linkBundleToIntent(bundleId: string, intentId: string) {
  const { data, error } = await sb.rpc("admin_link_bundle_to_intent", {
    _bundle_id: bundleId,
    _intent_id: intentId,
  });
  if (error) throw error;
  return data as { bundle_id: string; intent_id: string; intent_key: string };
}

// v2 Cut 2.2 — Persistent Intelligence Memory
export type IntelligenceMemoryKind =
  | "successful_pattern"
  | "quality_issue"
  | "risk_incident"
  | "conversion_learning"
  | "ux_learning"
  | "seo_learning"
  | "workflow_failure"
  | "security_pattern"
  | "architecture_decision";

export type IntelligenceMemoryStatus = "active" | "retired" | "superseded";

export interface IntelligenceMemoryEntry {
  id: string;
  memory_key: string;
  kind: IntelligenceMemoryKind;
  vertical_key: string | null;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  confidence: number;
  status: IntelligenceMemoryStatus;
  source_run_id: string | null;
  business_intent_id: string | null;
  bundle_id: string | null;
  tags: string[];
  recorded_by: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  created_at: string;
  updated_at: string;
  intent_title: string | null;
}

export interface RecordIntelligenceMemoryInput {
  memory_key: string;
  kind: IntelligenceMemoryKind;
  title: string;
  summary: string;
  vertical_key?: string | null;
  payload?: Record<string, unknown>;
  confidence?: number;
  source_run_id?: string | null;
  business_intent_id?: string | null;
  bundle_id?: string | null;
  tags?: string[];
}

export async function listIntelligenceMemory(filters: {
  kind?: IntelligenceMemoryKind | null;
  vertical_key?: string | null;
  status?: IntelligenceMemoryStatus | null;
  business_intent_id?: string | null;
  limit?: number;
} = {}): Promise<IntelligenceMemoryEntry[]> {
  const { data, error } = await sb.rpc("admin_list_intelligence_memory", {
    _kind: filters.kind ?? null,
    _vertical_key: filters.vertical_key ?? null,
    _status: filters.status ?? null,
    _business_intent_id: filters.business_intent_id ?? null,
    _limit: filters.limit ?? 200,
  });
  if (error) throw error;
  return (data ?? []) as IntelligenceMemoryEntry[];
}

export async function recordIntelligenceMemory(input: RecordIntelligenceMemoryInput): Promise<string> {
  const { data, error } = await sb.rpc("admin_record_intelligence_memory", {
    _memory_key: input.memory_key,
    _kind: input.kind,
    _title: input.title,
    _summary: input.summary,
    _vertical_key: input.vertical_key ?? null,
    _payload: input.payload ?? {},
    _confidence: input.confidence ?? 0.5,
    _source_run_id: input.source_run_id ?? null,
    _business_intent_id: input.business_intent_id ?? null,
    _bundle_id: input.bundle_id ?? null,
    _tags: input.tags ?? [],
  });
  if (error) throw error;
  return data as string;
}

export async function retireIntelligenceMemory(memoryId: string, reason: string): Promise<boolean> {
  const { data, error } = await sb.rpc("admin_retire_intelligence_memory", {
    _memory_id: memoryId,
    _reason: reason,
  });
  if (error) throw error;
  return data as boolean;
}

export async function classifyIntelligenceMemory(
  memoryId: string,
  newStatus: IntelligenceMemoryStatus,
  supersededBy?: string | null,
): Promise<boolean> {
  const { data, error } = await sb.rpc("admin_classify_intelligence_memory", {
    _memory_id: memoryId,
    _new_status: newStatus,
    _superseded_by: supersededBy ?? null,
  });
  if (error) throw error;
  return data as boolean;
}

