/**
 * Berufs-KI Outcome Engine (BK-Act-3) — Client API.
 *
 * Outcomes sind deterministisch im Backend berechnet (workflow_outcomes).
 * Niemals client-seitige Score-Berechnung.
 */
import { supabase } from "@/integrations/supabase/client";

export type OutcomeType =
  | "risk_insight"
  | "competency_gain"
  | "communication_efficiency"
  | "documentation_efficiency"
  | "operations_efficiency"
  | "general_impact";

export interface WorkflowOutcome {
  id: string;
  run_id: string;
  workflow_id: string;
  user_id: string | null;
  outcome_type: OutcomeType;
  outcome_score: number;
  confidence: number;
  estimated_time_saved_min: number;
  risk_reduction_pct: number | null;
  competency_impact_pct: number | null;
  business_impact_label: string | null;
  learner_impact_label: string | null;
  recommended_next_action_key: string | null;
  recommended_next_action_label: string | null;
  recommended_next_action_target: string | null;
  computed_factors: Record<string, unknown>;
  computed_at: string;
}

export interface OutcomeImpactSummary {
  window_days: number;
  total_outcomes: number;
  minutes_saved: number;
  avg_outcome_score: number | null;
  avg_risk_reduction_pct: number | null;
  avg_competency_impact_pct: number | null;
  by_outcome_type: Array<{ outcome_type: OutcomeType; runs: number; avg_score: number }>;
}

const OUTCOME_LABELS: Record<OutcomeType, string> = {
  risk_insight: "Risiko-Einsicht",
  competency_gain: "Kompetenz-Gewinn",
  communication_efficiency: "Kommunikations-Effizienz",
  documentation_efficiency: "Dokumentations-Effizienz",
  operations_efficiency: "Organisations-Effizienz",
  general_impact: "Ergebnis",
};

export function outcomeTypeLabel(t: OutcomeType): string {
  return OUTCOME_LABELS[t] ?? "Ergebnis";
}

export async function fetchWorkflowOutcome(runId: string): Promise<WorkflowOutcome | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("learner_get_workflow_outcome", { _run_id: runId });
  if (error) throw error;
  if (!data || (data as { error?: string }).error) return null;
  return data as WorkflowOutcome;
}

export async function fetchOutcomeImpactSummary(days = 30): Promise<OutcomeImpactSummary | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("learner_get_outcome_impact_summary", { _days: days });
  if (error) throw error;
  if (!data || (data as { error?: string }).error) return null;
  return data as OutcomeImpactSummary;
}
