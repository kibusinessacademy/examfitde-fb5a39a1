/**
 * Berufs-KI SSOT — Types.
 *
 * Berufs-KI ist die eigenständige AI-Workflow-Produktlinie neben dem
 * Prüfungs-Kern von ExamFit. Keine Prompt-Sammlung — strukturierte,
 * berufsspezifische Workflows mit klarem Input/Output-Vertrag.
 */

export type WorkflowCategory =
  | "kommunikation"
  | "analyse"
  | "dokumentation"
  | "organisation"
  | "fach"
  | "lernhilfe";

export type WorkflowTier = "free" | "pro" | "business";
export type WorkflowClass = "official" | "community_verified" | "blueprint_materialized" | "experimental";
export type TargetRole = "azubi" | "fachkraft" | "ausbilder" | "teamleiter";
export type RiskLevel = "low" | "medium" | "high";
export type ComplianceLevel = "standard" | "sensitive" | "regulated";

export interface WorkflowField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  required?: boolean;
  placeholder?: string;
  options?: string[];
  help?: string;
}

export interface WorkflowInputSchema {
  fields: WorkflowField[];
}

export interface WorkflowOutputSchema {
  sections: string[];
}

export interface WorkflowDefinition {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: WorkflowCategory;
  subcategory: string | null;
  curriculum_id: string | null;
  learning_field_id: string | null;
  competency_id: string | null;
  blueprint_id: string | null;
  competency_ids: string[];
  target_roles: TargetRole[];
  tier_required: WorkflowTier;
  input_schema: WorkflowInputSchema;
  output_schema: WorkflowOutputSchema;
  model_recommendation: string;
  compliance_level: ComplianceLevel;
  risk_level: RiskLevel;
  is_active: boolean;
  version: number;
  workflow_class?: WorkflowClass;
}

export interface WorkflowRunQuality {
  coverage_pct: number | null;
  completion_status: "complete" | "partial" | "empty" | "unknown";
  sections_detected: string[];
  sections_missing: string[];
  quality_score: number;
}

export interface WorkflowRunResult {
  run_id: string;
  workflow: { slug: string; title: string; output_schema: WorkflowOutputSchema };
  output_text: string;
  model_used: string;
  latency_ms: number;
  quality?: WorkflowRunQuality;
  version_at_run?: number;
}

export interface WorkflowRunError {
  error: string;
  message?: string;
  reason?: string;
  tier_required?: WorkflowTier;
  missing?: Array<{ key: string; label?: string }>;
}

export interface AdminWorkflowSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: WorkflowCategory;
  tier_required: WorkflowTier;
  risk_level: RiskLevel;
  curriculum_id: string | null;
  competency_id: string | null;
  learning_field_id: string | null;
  blueprint_id: string | null;
  is_active: boolean;
  version: number;
  runs_total: number;
  runs_24h: number;
  ok_rate: number;
  last_run_at: string | null;
  updated_at: string;
}

export interface AdminQualityRow {
  workflow_id: string;
  slug: string;
  title: string;
  category: WorkflowCategory;
  tier_required: WorkflowTier;
  is_active: boolean;
  version: number;
  runs_window: number;
  ok_runs: number;
  error_runs: number;
  blocked_runs: number;
  rate_limited_runs: number;
  ok_rate: number;
  error_rate: number;
  avg_latency_ms: number;
  avg_coverage_pct: number;
  helpful_count: number;
  partial_count: number;
  unhelpful_count: number;
  rating_score: number | null;
  lock_blocked: number;
  lock_conversions: number;
  last_run_at: string | null;
}
