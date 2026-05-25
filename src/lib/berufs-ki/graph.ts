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
  const { data, error } = await supabase.rpc("admin_bki_graph_summary" as never);
  if (error) throw error;
  return data as {
    totals: { total_nodes: number; total_edges: number; distinct_node_types: number; distinct_edge_types: number; pending_evolution_candidates: number };
    nodes_by_type: Record<string, number>;
    edges_by_type: Record<string, number>;
    top_hubs: Array<{ id: string; title: string; node_type: string; degree: number }>;
  };
}

export async function listGraphNodes(filter?: { node_type?: GraphNodeType; q?: string }) {
  let query = supabase.from("berufs_ki_graph_nodes" as never).select("*").order("created_at", { ascending: false }).limit(200);
  if (filter?.node_type) query = query.eq("node_type", filter.node_type);
  if (filter?.q) query = query.ilike("title", `%${filter.q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as GraphNode[];
}

export async function createGraphNode(args: {
  node_type: GraphNodeType; title: string; description?: string; metadata?: Record<string, unknown>;
}) {
  const { data, error } = await supabase.rpc("admin_bki_create_node" as never, {
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
  const { data, error } = await supabase.rpc("admin_bki_create_edge" as never, {
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
  const { error } = await supabase.rpc("admin_bki_delete_edge" as never, { _edge_id: edgeId });
  if (error) throw error;
}

export async function fetchNeighborhood(nodeId: string, depth = 1) {
  const { data, error } = await supabase.rpc("admin_bki_neighborhood" as never, { _node_id: nodeId, _depth: depth });
  if (error) throw error;
  return data as { nodes: GraphNode[]; edges: GraphEdge[] };
}

export async function detectEvolutionCandidates() {
  const { data, error } = await supabase.rpc("admin_bki_evolution_detect" as never);
  if (error) throw error;
  return data as { inserted: number; detected_at: string };
}

export async function listEvolutionCandidates(status?: string) {
  const { data, error } = await supabase.rpc("admin_bki_evolution_list" as never, { _status: status ?? null });
  if (error) throw error;
  return (data ?? []) as EvolutionCandidate[];
}

export async function decideEvolutionCandidate(id: string, decision: "approve" | "reject" | "review", notes?: string) {
  const { data, error } = await supabase.rpc("admin_bki_evolution_decide" as never, {
    _candidate_id: id, _decision: decision, _notes: notes ?? null,
  });
  if (error) throw error;
  return data as { id: string; status: string };
}
