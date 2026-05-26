import { supabase } from "@/integrations/supabase/client";

/**
 * BerufOS Graph Activation Layer — client SSOT.
 * Mirrors the 5 deterministic RPCs that turn berufs_ki_graph_* into
 * productive decision logic. NO new graph structure here.
 */

export type ActivationReason =
  | "OK"
  | "NO_LEARNER_STATE"
  | "GRAPH_NOT_POPULATED"
  | "NO_GRAPH_LINKED_WEAK_COMPETENCIES"
  | "NO_GRAPH_LINKED_WORKFLOWS"
  | "NO_GRAPH_NODE_FOR_SCOPE"
  | "NO_GRAPH_EVIDENCE"
  | "NO_CERTIFICATION_NODE"
  | "NO_GRAPH_LINKED_COMPETENCIES"
  | "NO_AT_RISK_COMPETENCIES_IN_WINDOW";

export interface NextBestSkillAction {
  competency_id: string;
  competency_title: string;
  mastery_score: number;
  via_edge: string;
  action_node_id: string;
  action_type: "lesson" | "recovery_action" | "workflow" | "blueprint" | string;
  action_title: string;
  action_description: string | null;
  edge_confidence: number;
}

export interface TutorGraphContext {
  reason: ActivationReason;
  scope: string;
  node_id: string | null;
  chain: Array<{
    edge_id: string;
    edge_type: string;
    confidence: number;
    neighbor_id: string;
    neighbor_type: string;
    neighbor_title: string;
  }>;
  evidence: Array<{
    id: string;
    edge_id: string;
    evidence_type: string;
    source_table: string | null;
    confidence: number;
  }>;
}

export interface WorkflowRecommendation {
  workflow_node_id: string;
  workflow_id: string | null;
  workflow_title: string;
  workflow_description: string | null;
  via_edge: string;
  edge_confidence: number;
  mastery_score: number;
}

export interface ManagerRiskExplanation {
  competency_id: string;
  competency_title: string | null;
  learners_affected: number;
  avg_mastery: number;
  suggested_actions: Array<{
    action_id: string;
    title: string;
    edge_type: string;
    confidence: number;
  }>;
}

export interface ExamFitBridgeItem {
  comp_node_id: string;
  competency_id: string | null;
  title: string;
  mastery: number;
  readiness: number;
  gap: number;
  suggested_blueprints: Array<{
    blueprint_node: string;
    blueprint_id: string | null;
    title: string;
    edge_type: string;
  }>;
}

type Envelope<T> = { reason: ActivationReason; items: T[]; returned: number };

export async function getNextBestSkillActions(limit = 5): Promise<Envelope<NextBestSkillAction>> {
  const { data, error } = await (supabase as any).rpc("learner_get_next_best_skill_actions", { p_limit: limit });
  if (error) throw error;
  return data as Envelope<NextBestSkillAction>;
}

export async function getTutorGraphContext(args: { competencyId?: string; lessonId?: string }): Promise<TutorGraphContext> {
  const { data, error } = await (supabase as any).rpc("tutor_get_graph_context", {
    p_competency_id: args.competencyId ?? null,
    p_lesson_id: args.lessonId ?? null,
  });
  if (error) throw error;
  return data as TutorGraphContext;
}

export async function getGraphWorkflowRecommendations(limit = 5): Promise<Envelope<WorkflowRecommendation>> {
  const { data, error } = await (supabase as any).rpc("learner_get_graph_workflow_recommendations", { p_limit: limit });
  if (error) throw error;
  return data as Envelope<WorkflowRecommendation>;
}

export async function getManagerRiskExplanations(windowDays = 30): Promise<Envelope<ManagerRiskExplanation>> {
  const { data, error } = await (supabase as any).rpc("manager_get_graph_risk_explanations", { p_window_days: windowDays });
  if (error) throw error;
  return data as Envelope<ManagerRiskExplanation>;
}

export async function getExamFitGraphBridge(certificationId: string): Promise<Envelope<ExamFitBridgeItem>> {
  const { data, error } = await (supabase as any).rpc("learner_get_examfit_graph_bridge", { p_certification_id: certificationId });
  if (error) throw error;
  return data as Envelope<ExamFitBridgeItem>;
}

export function describeReason(r: ActivationReason): string {
  switch (r) {
    case "OK": return "Graph-Evidenz verfügbar";
    case "NO_LEARNER_STATE": return "Noch keine Lerndaten — beginne mit einer Lektion oder Übung.";
    case "GRAPH_NOT_POPULATED": return "Intelligence-Graph noch nicht aufgebaut.";
    case "NO_GRAPH_LINKED_WEAK_COMPETENCIES": return "Keine schwachen Kompetenzen mit Graph-Verknüpfung gefunden.";
    case "NO_GRAPH_LINKED_WORKFLOWS": return "Keine Workflows mit passender Skill-Verknüpfung.";
    case "NO_GRAPH_NODE_FOR_SCOPE": return "Kein Graph-Knoten für diesen Kontext gefunden.";
    case "NO_GRAPH_EVIDENCE": return "Keine Graph-Evidenz vorhanden — Antwort blockiert.";
    case "NO_CERTIFICATION_NODE": return "Zertifizierung ist noch nicht im Graph verankert.";
    case "NO_GRAPH_LINKED_COMPETENCIES": return "Zertifizierung hat keine Graph-verknüpften Kompetenzen.";
    case "NO_AT_RISK_COMPETENCIES_IN_WINDOW": return "Keine Risiko-Kompetenzen im Zeitfenster.";
    default: return r;
  }
}
