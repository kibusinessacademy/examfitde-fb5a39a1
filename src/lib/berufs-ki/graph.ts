import { supabase } from "@/integrations/supabase/client";

export type GraphNodeType =
  | "workflow" | "competency" | "blueprint" | "learning_field"
  | "profession" | "role" | "industry" | "problem_type"
  | "document_type" | "risk" | "kpi" | "sop" | "ticket"
  | "ai_agent" | "workflow_chain";

export type GraphEdgeType =
  | "related_to" | "requires" | "improves" | "causes"
  | "derived_from" | "commonly_used_with" | "maps_to"
  | "belongs_to" | "extends" | "conflicts_with"
  | "part_of" | "supports";

export interface GraphNode {
  id: string;
  node_type: GraphNodeType;
  title: string;
  description: string | null;
  profession_id: string | null;
  source_system: string;
  source_ref_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface GraphEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: GraphEdgeType;
  confidence_score: number;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EvolutionCandidate {
  id: string;
  source_workflow_ids: string[];
  detected_pattern: string;
  pattern_type: string;
  suggested_improvements: Record<string, unknown>;
  quality_delta: number | null;
  confidence_score: number;
  governance_risk: "low" | "medium" | "high";
  status: "detected" | "under_review" | "approved" | "rejected" | "applied";
  created_at: string;
  metadata: Record<string, unknown>;
}

export const NODE_TYPES: GraphNodeType[] = [
  "workflow", "competency", "blueprint", "learning_field",
  "profession", "role", "industry", "problem_type",
  "document_type", "risk", "kpi", "sop", "ticket",
  "ai_agent", "workflow_chain",
];

export const EDGE_TYPES: GraphEdgeType[] = [
  "related_to", "requires", "improves", "causes",
  "derived_from", "commonly_used_with", "maps_to",
  "belongs_to", "extends", "conflicts_with",
  "part_of", "supports",
];

export async function fetchGraphSummary() {
  const { data, error } = await (supabase as any).rpc("admin_bki_graph_summary");
  if (error) throw error;
  return data as {
    totals: { total_nodes: number; total_edges: number; distinct_node_types: number; distinct_edge_types: number; pending_evolution_candidates: number };
    nodes_by_type: Record<string, number>;
    edges_by_type: Record<string, number>;
    top_hubs: Array<{ id: string; title: string; node_type: string; degree: number }>;
  };
}

export async function listGraphNodes(filter?: { node_type?: GraphNodeType; q?: string }) {
  let query = (supabase as any).from("berufs_ki_graph_nodes").select("*").order("created_at", { ascending: false }).limit(200);
  if (filter?.node_type) query = query.eq("node_type", filter.node_type);
  if (filter?.q) query = query.ilike("title", `%${filter.q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as GraphNode[];
}

export async function createGraphNode(args: {
  node_type: GraphNodeType; title: string; description?: string; metadata?: Record<string, unknown>;
}) {
  const { data, error } = await (supabase as any).rpc("admin_bki_create_node", {
    _node_type: args.node_type,
    _title: args.title,
    _description: args.description ?? null,
    _profession_id: null,
    _metadata: args.metadata ?? {},
  });
  if (error) throw error;
  return data as string;
}

export async function createGraphEdge(args: {
  from_node_id: string; to_node_id: string; edge_type: GraphEdgeType; confidence?: number;
}) {
  const { data, error } = await (supabase as any).rpc("admin_bki_create_edge", {
    _from: args.from_node_id,
    _to: args.to_node_id,
    _edge_type: args.edge_type,
    _confidence: args.confidence ?? 1.0,
    _metadata: {},
  });
  if (error) throw error;
  return data as string;
}

export async function deleteGraphEdge(edgeId: string) {
  const { error } = await (supabase as any).rpc("admin_bki_delete_edge", { _edge_id: edgeId });
  if (error) throw error;
}

export async function fetchNeighborhood(nodeId: string, depth = 1) {
  const { data, error } = await (supabase as any).rpc("admin_bki_neighborhood", { _node_id: nodeId, _depth: depth });
  if (error) throw error;
  return data as { nodes: GraphNode[]; edges: GraphEdge[] };
}

export async function detectEvolutionCandidates() {
  const { data, error } = await (supabase as any).rpc("admin_bki_evolution_detect");
  if (error) throw error;
  return data as { inserted: number; detected_at: string };
}

export async function listEvolutionCandidates(status?: string) {
  const { data, error } = await (supabase as any).rpc("admin_bki_evolution_list", { _status: status ?? null });
  if (error) throw error;
  return (data ?? []) as EvolutionCandidate[];
}

export async function decideEvolutionCandidate(id: string, decision: "approve" | "reject" | "review", notes?: string) {
  const { data, error } = await (supabase as any).rpc("admin_bki_evolution_decide", {
    _candidate_id: id, _decision: decision, _notes: notes ?? null,
  });
  if (error) throw error;
  return data as { id: string; status: string };
}

// ============================================================
// BerufOS Intelligence Graph Foundation (5-Layer)
// Extends existing berufs_ki_graph_* SSOT — no parallel system.
// ============================================================

export type BerufOSGraphSummary = {
  totals: {
    total_nodes: number;
    total_edges: number;
    distinct_node_types: number;
    distinct_edge_types: number;
    pending_evolution_candidates: number;
  } | null;
  nodes_by_type: Record<string, number> | null;
  nodes_by_status: Record<string, number> | null;
  edges_by_type: Record<string, number> | null;
  edges_by_status: Record<string, number> | null;
  orphan_count: number;
  proposed_count: number;
  evidence_count: number;
  latest_snapshot: {
    id: string;
    graph_scope: string;
    node_count: number;
    edge_count: number;
    checksum: string;
    generated_at: string;
  } | null;
};

export type BerufOSGraphDriftReport = {
  edges_without_evidence: number;
  orphan_active_nodes: number;
  proposed_stale_7d: number;
  deprecated_with_active_edges: number;
  low_confidence_active_edges: number;
};

export type BerufOSRebuildResult = {
  ok: boolean;
  dry_run: boolean;
  scope: string;
  node_count: number;
  edge_count: number;
  checksum: string;
  snapshot_id: string | null;
  inserted: {
    curricula: number;
    certifications: number;
    competencies: number;
    belongs_to_edges: number;
  };
};

export async function getBerufOSGraphSummary(): Promise<BerufOSGraphSummary> {
  const { data, error } = await (supabase as any).rpc("admin_get_berufos_graph_summary");
  if (error) throw error;
  return data as BerufOSGraphSummary;
}

export async function getBerufOSGraphDriftReport(): Promise<BerufOSGraphDriftReport> {
  const { data, error } = await (supabase as any).rpc("admin_get_berufos_graph_drift_report");
  if (error) throw error;
  return data as BerufOSGraphDriftReport;
}

export async function rebuildBerufOSGraph(
  scope: string = "global",
  dryRun: boolean = true,
): Promise<BerufOSRebuildResult> {
  const { data, error } = await (supabase as any).rpc("admin_rebuild_berufos_graph", {
    p_scope: scope,
    p_dry_run: dryRun,
  });
  if (error) throw error;
  return data as BerufOSRebuildResult;
}

export async function activateProposedEdge(edgeId: string, reason?: string) {
  const { data, error } = await (supabase as any).rpc("admin_activate_proposed_edge", {
    p_edge_id: edgeId, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function rejectProposedEdge(edgeId: string, reason?: string) {
  const { data, error } = await (supabase as any).rpc("admin_reject_proposed_edge", {
    p_edge_id: edgeId, p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function getBerufOSNodeDetail(nodeId: string) {
  const { data, error } = await (supabase as any).rpc("admin_get_berufos_graph_node_detail", {
    p_node_id: nodeId,
  });
  if (error) throw error;
  return data;
}

export async function getLearnerSkillPath() {
  const { data, error } = await (supabase as any).rpc("learner_get_skill_path");
  if (error) throw error;
  return data;
}

export async function getManagerCompetencyRiskGraph() {
  const { data, error } = await (supabase as any).rpc("manager_get_competency_risk_graph");
  if (error) throw error;
  return data;
}
