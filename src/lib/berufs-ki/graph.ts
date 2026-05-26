import { supabase } from '@/integrations/supabase/client';

export type GraphSummary = {
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

export type GraphDriftReport = {
  edges_without_evidence: number;
  orphan_active_nodes: number;
  proposed_stale_7d: number;
  deprecated_with_active_edges: number;
  low_confidence_active_edges: number;
};

export type RebuildResult = {
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

export async function getBerufOSGraphSummary(): Promise<GraphSummary> {
  const { data, error } = await supabase.rpc('admin_get_berufos_graph_summary' as any);
  if (error) throw error;
  return data as unknown as GraphSummary;
}

export async function getBerufOSGraphDriftReport(): Promise<GraphDriftReport> {
  const { data, error } = await supabase.rpc('admin_get_berufos_graph_drift_report' as any);
  if (error) throw error;
  return data as unknown as GraphDriftReport;
}

export async function rebuildBerufOSGraph(
  scope: string = 'global',
  dryRun: boolean = true,
): Promise<RebuildResult> {
  const { data, error } = await supabase.rpc('admin_rebuild_berufos_graph' as any, {
    p_scope: scope,
    p_dry_run: dryRun,
  });
  if (error) throw error;
  return data as unknown as RebuildResult;
}

export async function activateProposedEdge(edgeId: string, reason?: string) {
  const { data, error } = await supabase.rpc('admin_activate_proposed_edge' as any, {
    p_edge_id: edgeId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function rejectProposedEdge(edgeId: string, reason?: string) {
  const { data, error } = await supabase.rpc('admin_reject_proposed_edge' as any, {
    p_edge_id: edgeId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function getNodeDetail(nodeId: string) {
  const { data, error } = await supabase.rpc('admin_get_berufos_graph_node_detail' as any, {
    p_node_id: nodeId,
  });
  if (error) throw error;
  return data;
}

export async function getLearnerSkillPath() {
  const { data, error } = await supabase.rpc('learner_get_skill_path' as any);
  if (error) throw error;
  return data;
}

export async function getManagerCompetencyRiskGraph() {
  const { data, error } = await supabase.rpc('manager_get_competency_risk_graph' as any);
  if (error) throw error;
  return data;
}
