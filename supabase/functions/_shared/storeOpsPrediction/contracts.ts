/**
 * STORE.OPS.PREDICTION.OS.1 — Pure contracts.
 *
 * Hard rules:
 *  - No DB. No HTTP. No clock. No RNG. No fetch.
 *  - Read-only prediction over existing StoreOps SSOT data.
 *  - NEVER publishes, submits, rolls out, approves, or mutates policies/gates.
 *  - Deterministic, explainable, immutable outputs.
 */

export type PredictionRiskLevel = "low" | "medium" | "high" | "critical";

export type PredictionRiskKind =
  | "technical"
  | "governance"
  | "operational"
  | "data_quality"
  | "capacity";

export const FORBIDDEN_PREDICTION_ACTIONS = [
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
  finished_at_reference?: string | null;
}

export interface BatchItemSnapshot {
  batch_id: string;
  manifest_id: string;
  action_type: string;
  status: string;
  blocker_codes: string[];
  duration_seconds?: number | null;
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
  risk_level: PredictionRiskLevel;
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
  duration_seconds?: number | null;
}

export interface IntelligenceRunSnapshot {
  run_id: string;
  risk_total: number;
  risk_level: PredictionRiskLevel;
  confidence_score: number;
  evaluated_at_reference: string;
}

export interface IntelligenceFindingSnapshot {
  run_id: string;
  kind: string;
  key: string;
  value_numeric: number | null;
}

/** A planned operation we want predictions for. */
export interface PlannedOperation {
  /** Stable key for the planned op, e.g. `batch:upcoming` or `autopilot:safe_execute`. */
  operation_key: string;
  /** Allow-listed action types we intend to run (no publish/submit/rollout). */
  planned_action_types: string[];
  /** Expected manifest count (size). */
  expected_manifest_count: number;
  /** Optional mode hint (autopilot mode etc.). */
  mode?: string | null;
}

export interface PredictionInput {
  run_id: string;
  evaluated_at_reference: string;
  planned: PlannedOperation;
  batches: BatchSnapshot[];
  batch_items: BatchItemSnapshot[];
  kpi_history: KpiHistorySnapshot[];
  autopilot_runs: AutopilotRunSnapshot[];
  autopilot_actions: AutopilotActionSnapshot[];
  intelligence_runs: IntelligenceRunSnapshot[];
  intelligence_findings: IntelligenceFindingSnapshot[];
}

export interface ActionBaseline {
  action_type: string;
  observed_total: number;
  observed_succeeded: number;
  observed_failed: number;
  observed_blocked: number;
  success_rate: number;
  failure_rate: number;
  block_rate: number;
  average_duration_seconds: number | null;
  duration_sample_count: number;
}

export interface BlockerForecastEntry {
  blocker_code: string;
  historical_occurrences: number;
  historical_rate: number;
  expected_occurrences: number;
}

export interface RejectionForecastEntry {
  reason: string;
  historical_occurrences: number;
  expected_occurrences: number;
}

export interface ManualInterventionForecast {
  historical_rate: number;
  expected_count: number;
  sample_size: number;
}

export interface QueueLoadForecast {
  expected_action_count: number;
  average_recent_batch_load: number;
  load_factor: number; // ratio vs average recent batch
}

export interface DurationForecast {
  expected_total_seconds: number;
  per_action: { action_type: string; expected_seconds: number; sample_size: number }[];
  sample_size: number;
}

export interface OutcomeForecast {
  success_probability: number; // 0..1
  expected_failures: number;
  expected_blocked: number;
  expected_succeeded: number;
  baseline_used: "action_baseline" | "global_baseline" | "no_data";
}

export interface RiskComponent {
  kind: PredictionRiskKind;
  score: number; // 0..100
  level: PredictionRiskLevel;
  rationale: string;
  signals: string[];
}

export interface RiskBreakdown {
  technical: number;
  governance: number;
  operational: number;
  data_quality: number;
  capacity: number;
  total: number;
  level: PredictionRiskLevel;
  components: RiskComponent[];
}

export interface ConfidenceBreakdown {
  sample_size: number;
  pattern_consistency: number;
  data_quality: number;
  repeatability: number;
  historical_stability: number;
  score: number; // 0..1
}

export interface SimilarRunRef {
  source: "batch" | "autopilot_run" | "intelligence_run";
  ref_id: string;
  similarity_score: number; // 0..1
  matched_on: string[];
}

export interface InfluenceFactor {
  key: string;
  weight: number; // 0..1
  direction: "increases_risk" | "reduces_risk" | "neutral";
  explanation: string;
}

export interface ExplainabilityBlock {
  used_data: string[];
  similar_runs: SimilarRunRef[];
  detected_patterns: string[];
  influence_factors: InfluenceFactor[];
  rationale: string;
}

export type PredictionFindingKind =
  | "outcome"
  | "expected_blocker"
  | "expected_rejection"
  | "expected_duration"
  | "queue_load"
  | "manual_intervention_forecast"
  | "risk_component"
  | "influence_factor"
  | "similar_run"
  | "warning";

export interface PredictionFinding {
  kind: PredictionFindingKind;
  key: string;
  value_numeric: number | null;
  value_text: string | null;
  detail: Record<string, unknown>;
}

export interface PredictionProjection {
  run_id: string;
  evaluated_at_reference: string;
  operation_key: string;
  outcome: OutcomeForecast;
  duration: DurationForecast;
  queue_load: QueueLoadForecast;
  manual_intervention: ManualInterventionForecast;
  blockers: BlockerForecastEntry[];
  rejections: RejectionForecastEntry[];
  action_baselines: ActionBaseline[];
  risk: RiskBreakdown;
  confidence: ConfidenceBreakdown;
  explainability: ExplainabilityBlock;
  findings: PredictionFinding[];
  warnings: string[];
}
