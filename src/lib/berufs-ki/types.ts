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
}

export interface WorkflowRunResult {
  run_id: string;
  workflow: { slug: string; title: string; output_schema: WorkflowOutputSchema };
  output_text: string;
  model_used: string;
  latency_ms: number;
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
