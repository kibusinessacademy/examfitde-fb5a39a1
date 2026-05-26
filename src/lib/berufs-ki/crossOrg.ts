/**
 * BK-Act-5.2 — Cross-Org Intelligence (Client API).
 *
 * Alle Werte sind deterministisch in den manager_*-RPCs aggregiert.
 * Niemals client-seitige Berechnung. Niemals direkte Table-Reads.
 */
import { supabase } from "@/integrations/supabase/client";

export type Band = "green" | "amber" | "red" | "no_data";
export type Trend = "improvement" | "decline" | "stagnation" | "unknown";

export interface SiteAggregate {
  site_id: string; name: string; city: string | null; region?: string | null;
  learners: number; active_learners?: number; activity_pct?: number;
  avg_score: number; avg_confidence?: number; avg_risk_reduction?: number;
  runs: number; band: Band;
}
export interface DepartmentAggregate {
  department_id: string; name: string; learners: number;
  avg_score: number; runs: number; band: Band;
}
export interface CohortAggregate {
  cohort_id: string; name: string; profession_key: string | null;
  training_year: number | null; learners: number;
  avg_score: number; runs: number; band: Band;
}
export interface CrossOrgReadiness {
  org_id: string; window_days: number;
  sites: SiteAggregate[]; departments: DepartmentAggregate[]; cohorts: CohortAggregate[];
}

export interface SiteComparison {
  org_id: string; window_days: number; rows: SiteAggregate[];
}

export interface CohortTrendRow {
  cohort_id: string; name: string; profession_key: string | null; training_year: number | null;
  avg_score: number; avg_score_prev: number; delta: number;
  avg_confidence: number; active_learners: number; runs: number;
  trend: Trend; band: Band;
}
export interface CohortTrends { org_id: string; window_days: number; rows: CohortTrendRow[] }

export interface RecoveryAggregate {
  site_id?: string; cohort_id?: string; name: string;
  avg_risk_reduction: number; avg_competency_impact: number;
  sample_size: number; band: Band;
}
export interface RecoveryEffectiveness {
  org_id: string; window_days: number;
  total: { avg_risk_reduction: number; avg_competency_impact: number; avg_confidence: number; sample_size: number; learners: number };
  by_site: RecoveryAggregate[]; by_cohort: RecoveryAggregate[];
}

export interface InterventionImpactRow {
  action_key: string; sample_size: number; learners: number;
  avg_outcome_score: number; avg_confidence: number; avg_risk_reduction: number;
  band: Exclude<Band, "no_data">;
}
export interface InterventionImpact { org_id: string; window_days: number; rows: InterventionImpactRow[] }

export interface ClusterRiskRow {
  outcome_type: string; sample_size: number; learners: number;
  avg_score: number; low_share_pct: number; band: Exclude<Band, "no_data">;
}
export interface ClusterRisk { org_id: string; window_days: number; rows: ClusterRiskRow[] }

export interface OrgQuality {
  org_id: string; window_days: number;
  org_training_quality_score: number; band: Exclude<Band, "no_data">;
  breakdown: Array<{ key: string; label: string; value: number; weight_pct: number }>;
  total_learners: number; active_learners: number;
  insights: {
    top_site: { site_id: string; name: string; avg_score: number } | null;
    critical_cohort: { cohort_id: string; name: string; avg_score: number } | null;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc as any;
async function call<T>(name: string, args: Record<string, unknown>): Promise<T | { error: string }> {
  const { data, error } = await rpc(name, args);
  if (error) return { error: error.message };
  return (data ?? { error: "no_data" }) as T;
}

export const crossOrg = {
  readiness: (org: string, days = 30) => call<CrossOrgReadiness>("manager_get_cross_org_readiness", { _org_id: org, _days: days }),
  siteComparison: (org: string, days = 30) => call<SiteComparison>("manager_get_site_comparison", { _org_id: org, _days: days }),
  cohortTrends: (org: string, days = 30) => call<CohortTrends>("manager_get_cohort_trends", { _org_id: org, _days: days }),
  recovery: (org: string, days = 30) => call<RecoveryEffectiveness>("manager_get_recovery_effectiveness", { _org_id: org, _days: days }),
  interventions: (org: string, days = 30) => call<InterventionImpact>("manager_get_intervention_impact", { _org_id: org, _days: days }),
  clusterRisk: (org: string, days = 30) => call<ClusterRisk>("manager_get_competency_cluster_risk", { _org_id: org, _days: days }),
  orgQuality: (org: string, days = 30) => call<OrgQuality>("manager_get_org_training_quality", { _org_id: org, _days: days }),
};

export function bandClass(band: Band | undefined): string {
  switch (band) {
    case "green": return "bg-status-success-bg-subtle text-status-success-text border-status-success-border";
    case "amber": return "bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border";
    case "red":   return "bg-status-error-bg-subtle text-status-error-text border-status-error-border";
    default:      return "bg-muted text-muted-foreground border-border";
  }
}

export function trendLabel(t: Trend): string {
  switch (t) {
    case "improvement": return "Verbesserung";
    case "decline":     return "Rückgang";
    case "stagnation":  return "Stagnation";
    default:            return "Keine Daten";
  }
}

export const INTERVENTION_LABELS: Record<string, string> = {
  open_recovery_plan: "Recovery-Plan öffnen",
  practice_drill: "Übungs-Drill",
  explain_again: "Erklärung wiederholen",
  oral_training: "Mündliche Übung",
  competency_review: "Kompetenz-Review",
  minicheck_recovery: "Minicheck-Recovery",
};
export function interventionLabel(key: string): string {
  return INTERVENTION_LABELS[key] ?? key.replace(/_/g, " ");
}
