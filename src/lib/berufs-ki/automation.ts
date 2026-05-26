import { supabase } from "@/integrations/supabase/client";

export type AutomationRuleKey =
  | "risk_radar_alert"
  | "cohort_stagnation"
  | "recovery_low_impact"
  | "inactivity_14d"
  | "exam_readiness_drop";

export interface AutomationRule {
  id: string;
  rule_key: AutomationRuleKey;
  enabled: boolean;
  params: Record<string, unknown>;
  notify_channel: string;
  updated_at: string;
}

export interface AutomationListResponse {
  reason: "OK" | "NOT_AUTHORIZED";
  org_id: string;
  rules: AutomationRule[];
}

export interface AutomationEvalResponse {
  reason: "OK" | "NOT_AUTHORIZED";
  rules_evaluated: number;
  total_matches: number;
  runs: Array<{ rule_key: AutomationRuleKey; matched: number }>;
}

export const RULE_CATALOG: Array<{
  key: AutomationRuleKey;
  label: string;
  description: string;
  defaults: Record<string, unknown>;
}> = [
  { key: "risk_radar_alert",   label: "Risk-Radar Alert",         description: "Warnt bei kritischen Kompetenz-Clustern, schwacher Recovery oder hoher Prüfungsunsicherheit.", defaults: {} },
  { key: "cohort_stagnation",  label: "Cohort-Stagnation",        description: "Erkennt Cohorts mit Trend `decline` oder `stagnation`.", defaults: {} },
  { key: "recovery_low_impact",label: "Recovery-Wirkung niedrig", description: "Schlägt an, wenn die Ø Risk-Reduktion unter dem Schwellenwert liegt.", defaults: { min_risk_reduction: 15 } },
  { key: "inactivity_14d",     label: "Inaktivität (14 Tage)",    description: "Zählt Lerner ohne Aktivität seit 14 Tagen.", defaults: {} },
  { key: "exam_readiness_drop",label: "Prüfungs-Confidence niedrig", description: "Zählt Lerner mit geringer Prüfungsreife-Confidence.", defaults: {} },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc as any;

export async function listAutomationRules(orgId: string): Promise<AutomationListResponse> {
  const { data, error } = await rpc("automation_list_rules", { _org_id: orgId });
  if (error) throw new Error(error.message);
  return data as AutomationListResponse;
}

export async function upsertAutomationRule(
  orgId: string, ruleKey: AutomationRuleKey, enabled: boolean, params: Record<string, unknown> = {}
): Promise<{ reason: string; id?: string }> {
  const { data, error } = await rpc("automation_upsert_rule", {
    _org_id: orgId, _rule_key: ruleKey, _enabled: enabled, _params: params,
  });
  if (error) throw new Error(error.message);
  return data as { reason: string; id?: string };
}

export async function evaluateOrgAutomation(orgId: string, days = 7): Promise<AutomationEvalResponse> {
  const { data, error } = await rpc("automation_evaluate_org", { _org_id: orgId, _days: days });
  if (error) throw new Error(error.message);
  return data as AutomationEvalResponse;
}
