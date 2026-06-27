/**
 * STORE.OPS.INTELLIGENCE.OS.1 — Pure Contracts
 *
 * Hard rules:
 *  - No DB. No HTTP. No clock. No RNG. No fetch.
 *  - Read-only analysis over existing StoreOps snapshots.
 *  - NEVER publishes, submits, rolls out, approves, or mutates policies/gates.
 *  - Deterministic, explainable, immutable outputs.
 */

export type IntelligenceRiskLevel = "low" | "medium" | "high" | "critical";

export type IntelligenceRecommendationCode =
  | "RUN_SIMULATION_FIRST"
  | "REDUCE_BATCH_SIZE"
  | "ENABLE_MAINTENANCE_MODE"
  | "RECALCULATE_KPI"
  | "RISK_ACCEPTABLE"
  | "START_MANUAL_REVIEW"
  | "DISABLE_AUTOPILOT"
  | "RETRY_FAILED_ACTIONS"
  | "INVESTIGATE_RECURRING_BLOCKER"
  | "NO_ACTION_REQUIRED";

export const ALLOWED_RECOMMENDATIONS: readonly IntelligenceRecommendationCode[] = [
  "RUN_SIMULATION_FIRST",
  "REDUCE_BATCH_SIZE",
  "ENABLE_MAINTENANCE_MODE",
  "RECALCULATE_KPI",
  "RISK_ACCEPTABLE",
  "START_MANUAL_REVIEW",
  "DISABLE_AUTOPILOT",
  "RETRY_FAILED_ACTIONS",
  "INVESTIGATE_RECURRING_BLOCKER",
  "NO_ACTION_REQUIRED",
] as const;

export const FORBIDDEN_RECOMMENDATIONS = [
  "publish",
  "submit_for_review",
  "production_rollout",
  "approve",
  "bypass_review",
  "modify_policy",
  "modify_gate",
  "extend_autopilot",
] as const;

export interface BatchSnapshot {
  batch_id: string;
  state: string;
  total: number;
  succeeded: number;
  failed: number;
  blocked: number;
  skipped: number;
  created_at_reference: string;
}

export interface BatchItemSnapshot {
  batch_id: string;
  manifest_id: string;
  action_type: string;
  status: string;
  blocker_codes: string[];
}

export interface KpiHistorySnapshot {
  snapshot_id: string;
  health_score: number;
  blocked_count: number;
  rejected_count: number;
  build_success_rate: number;
  top_rejection_reasons: string[];
  top_blockers: string[];
  created_at_reference: string;
}

export interface AutopilotRunSnapshot {
  run_id: string;
  mode: string;
  state: string;
  risk_score: number;
  risk_level: IntelligenceRiskLevel;
  safe_count: number;
  manual_count: number;
  blocked_count: number;
  succeeded: number;
  failed: number;
  evaluated_at_reference: string;
}

export interface AutopilotActionSnapshot {
  run_id: string;
  manifest_id: string;
  action_type: string;
  status: string;
  blocker_codes: string[];
}

export interface IntelligenceInput {
  run_id: string;
  evaluated_at_reference: string;
  batches: BatchSnapshot[];
  batch_items: BatchItemSnapshot[];
  kpi_history: KpiHistorySnapshot[];
  autopilot_runs: AutopilotRunSnapshot[];
  autopilot_actions: AutopilotActionSnapshot[];
}

export interface FrequencyEntry {
  key: string;
  count: number;
  share: number;
}

export interface ActionSuccessStat {
  action_type: string;
  total: number;
  succeeded: number;
  failed: number;
  blocked: number;
  success_rate: number;
}

export interface ModeSuccessStat {
  mode: string;
  total: number;
  succeeded: number;
  failed: number;
  success_rate: number;
}

export interface BlockerCluster {
  cluster_key: string;
  blocker_codes: string[];
  occurrences: number;
  affected_manifest_count: number;
  affected_action_types: string[];
}

export interface TrendDelta {
  metric: string;
  previous: number;
  current: number;
  delta: number;
  direction: "up" | "down" | "flat";
}

export interface RiskBreakdown {
  technical: number;
  governance: number;
  operational: number;
  total: number;
  level: IntelligenceRiskLevel;
}

export interface ConfidenceBreakdown {
  sample_size: number;
  repeatability: number;
  success_rate: number;
  consistency: number;
  score: number; // 0..1
}

export interface IntelligenceRecommendation {
  code: IntelligenceRecommendationCode;
  title: string;
  rationale: string;
  used_data: string[];
  detected_patterns: string[];
  risk: RiskBreakdown;
  confidence: ConfidenceBreakdown;
}

export type FindingKind =
  | "top_blocker"
  | "top_failure"
  | "top_rejection"
  | "manual_intervention"
  | "risk_pattern"
  | "action_success"
  | "mode_success"
  | "trend"
  | "blocker_cluster"
  | "recommendation";

export interface IntelligenceFinding {
  kind: FindingKind;
  key: string;
  value_numeric: number | null;
  value_text: string | null;
  detail: Record<string, unknown>;
}

export interface IntelligenceProjection {
  run_id: string;
  evaluated_at_reference: string;
  top_blockers: FrequencyEntry[];
  top_failures: FrequencyEntry[];
  top_rejections: FrequencyEntry[];
  manual_interventions: FrequencyEntry[];
  recurring_risk_patterns: FrequencyEntry[];
  action_success: ActionSuccessStat[];
  mode_success: ModeSuccessStat[];
  average_batch_runtime_seconds: number | null;
  trend: TrendDelta[];
  blocker_clusters: BlockerCluster[];
  risk: RiskBreakdown;
  confidence: ConfidenceBreakdown;
  recommendations: IntelligenceRecommendation[];
  findings: IntelligenceFinding[];
  warnings: string[];
}
