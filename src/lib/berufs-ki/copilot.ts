import { supabase } from "@/integrations/supabase/client";

export type Severity = "high" | "medium" | "low";
export interface CopilotPriority {
  priority: number;
  kind: "inactivity" | "at_risk_competency" | "cohort_decline" | "graph_risk" | string;
  severity: Severity;
  title: string;
  count?: number;
  total?: number;
  delta?: number;
  avg_score?: number;
  avg_mastery?: number;
  learners_affected?: number;
  action: string;
  route: string;
}
export interface CopilotBrief {
  reason: "OK" | "NOT_AUTHORIZED";
  org_id: string;
  window_days: number;
  generated_at: string;
  priorities: CopilotPriority[];
  snapshot: {
    total_learners: number;
    best_intervention: { action_key: string; avg_outcome_score: number } | null;
    weakest_intervention: { action_key: string; avg_outcome_score: number } | null;
    avg_risk_reduction: number;
  };
}

export interface ExecutiveNarrativeBullet {
  kind: "headline" | "strength" | "risk" | "intervention_best" | "intervention_weak" | "trend" | string;
  text: string;
}
export interface ExecutiveNarrative {
  reason: "OK" | "NOT_AUTHORIZED";
  org_id: string;
  window_days: number;
  generated_at: string;
  bullets: ExecutiveNarrativeBullet[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc as any;

export async function getCopilotBrief(orgId: string, days = 7): Promise<CopilotBrief> {
  const { data, error } = await rpc("manager_copilot_get_brief", { _org_id: orgId, _days: days });
  if (error) throw new Error(error.message);
  return data as CopilotBrief;
}

export async function getExecutiveNarrative(orgId: string, days = 30): Promise<ExecutiveNarrative> {
  const { data, error } = await rpc("executive_get_narrative", { _org_id: orgId, _days: days });
  if (error) throw new Error(error.message);
  return data as ExecutiveNarrative;
}

export function severityClass(s: Severity): string {
  switch (s) {
    case "high":   return "bg-status-error-bg-subtle text-status-error-text border-status-error-border";
    case "medium": return "bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border";
    default:       return "bg-status-success-bg-subtle text-status-success-text border-status-success-border";
  }
}
