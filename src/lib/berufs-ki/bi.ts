/**
 * Berufs-KI Business Intelligence Layer (BK-Act-4) — Client API.
 *
 * Alle Aggregate kommen aus deterministischen Manager-RPCs.
 * Niemals client-seitige KPI-Berechnung.
 */
import { supabase } from "@/integrations/supabase/client";

export type RiskBand = "green" | "amber" | "red" | "no_data";

export interface HeatmapCell {
  avg_score: number;
  avg_confidence: number;
  runs: number;
  band: Exclude<RiskBand, "no_data">;
}
export interface HeatmapRow {
  user_id: string;
  overall_score: number | null;
  overall_band: RiskBand;
  total_runs: number;
  cells: Record<string, HeatmapCell | undefined>;
}
export interface TeamReadinessHeatmap {
  org_id: string;
  window_days: number;
  columns: string[];
  rows: HeatmapRow[];
  learner_count: number;
}

export interface RiskDimension { key: string; label: string; value: number; total: number }
export interface RiskRadar {
  org_id: string;
  window_days: number;
  total_learners: number;
  dimensions: RiskDimension[];
}

export interface TeamAiImpact {
  org_id: string;
  window_days: number;
  workflows_run: number;
  minutes_saved: number;
  hours_saved: number;
  analyses_automated: number;
  documents_assisted: number;
  communications_assisted: number;
  risk_signals_detected: number;
  active_learners: number;
}

export interface InterventionRecommendation {
  key: string;
  title: string;
  detail: string;
  action_key: string;
  action_label: string;
  action_target: string | null;
  severity: "high" | "medium" | "low";
}
export interface InterventionRecommendations {
  org_id: string;
  window_days: number;
  recommendations: InterventionRecommendation[];
}

export interface TrainingQualityScore {
  org_id: string;
  window_days: number;
  training_quality_score: number;
  band: Exclude<RiskBand, "no_data">;
  total_learners: number;
  active_learners: number;
  breakdown: Array<{ key: string; label: string; value: number; weight_pct: number }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc as any;

async function call<T>(name: string, args: Record<string, unknown>): Promise<T | { error: string }> {
  const { data, error } = await rpc(name, args);
  if (error) return { error: error.message };
  return (data ?? { error: "no_data" }) as T | { error: string };
}

export const managerBI = {
  heatmap: (org_id: string, days = 30) =>
    call<TeamReadinessHeatmap>("manager_get_team_readiness_heatmap", { _org_id: org_id, _days: days }),
  riskRadar: (org_id: string, days = 30) =>
    call<RiskRadar>("manager_get_risk_radar", { _org_id: org_id, _days: days }),
  aiImpact: (org_id: string, days = 30) =>
    call<TeamAiImpact>("manager_get_team_ai_impact", { _org_id: org_id, _days: days }),
  interventions: (org_id: string, days = 30) =>
    call<InterventionRecommendations>("manager_get_intervention_recommendations", { _org_id: org_id, _days: days }),
  qualityScore: (org_id: string, days = 30) =>
    call<TrainingQualityScore>("manager_get_training_quality_score", { _org_id: org_id, _days: days }),
};

export const OUTCOME_TYPE_SHORT: Record<string, string> = {
  risk_insight: "Risiko",
  competency_gain: "Kompetenz",
  communication_efficiency: "Kommunikation",
  documentation_efficiency: "Dokumentation",
  operations_efficiency: "Organisation",
  general_impact: "Allgemein",
};

export function bandClass(band: RiskBand | undefined): string {
  switch (band) {
    case "green": return "bg-status-success-bg-subtle text-status-success-text border-status-success-border";
    case "amber": return "bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border";
    case "red":   return "bg-status-error-bg-subtle text-status-error-text border-status-error-border";
    default:      return "bg-muted text-muted-foreground border-border";
  }
}
