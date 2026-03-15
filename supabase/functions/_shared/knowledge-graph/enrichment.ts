/**
 * knowledge-graph/enrichment.ts — Helpers for AI-enriched node/edge insertion.
 *
 * Phase 2: Inserts nodes with provenance='ai_enriched' and stable source_keys.
 * Fully idempotent — skips existing nodes by source_key lookup.
 */

type SB = any;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface EnrichmentError {
  label: string;
  confidence: number;
}

export interface EnrichmentResult {
  competencyId: string;
  nodesCreated: number;
  edgesCreated: number;
  skipped: number;
}

/**
 * Insert AI-enriched error_pattern nodes for a competency.
 * - source_key = `ai_err:<competencyId>:<normalized_label_80>`
 * - provenance = 'ai_enriched'
 * - Edges: error_pattern --causes_error--> competency
 */
export async function insertEnrichedErrors(
  sb: SB,
  competencyId: string,
  competencyNodeId: string,
  errors: EnrichmentError[],
): Promise<EnrichmentResult> {
  const result: EnrichmentResult = {
    competencyId,
    nodesCreated: 0,
    edgesCreated: 0,
    skipped: 0,
  };

  if (!errors.length) return result;

  // Build source_keys for dedup check
  const sourceKeys = errors.map((e) =>
    `ai_err:${competencyId}:${normalize(e.label).slice(0, 80)}`
  );

  // Check existing
  const { data: existing } = await sb
    .from("knowledge_graph_nodes")
    .select("id, source_key")
    .eq("source_table", "competencies")
    .in("source_key", sourceKeys);

  const existingKeys = new Set((existing || []).map((r: any) => r.source_key));

  const toInsert = errors.filter(
    (e) => !existingKeys.has(`ai_err:${competencyId}:${normalize(e.label).slice(0, 80)}`)
  );

  result.skipped = errors.length - toInsert.length;

  if (!toInsert.length) return result;

  // Insert new nodes
  const rows = toInsert.map((e) => ({
    node_type: "error_pattern",
    source_table: "competencies",
    source_id: null,
    source_key: `ai_err:${competencyId}:${normalize(e.label).slice(0, 80)}`,
    label: e.label,
    normalized_label: normalize(e.label),
    payload: { source_competency_id: competencyId, ai_confidence: e.confidence },
    provenance: "ai_enriched",
    confidence: e.confidence,
    is_active: true,
  }));

  const { data: inserted, error } = await sb
    .from("knowledge_graph_nodes")
    .insert(rows)
    .select("id");

  if (error) {
    console.error(`[kg-enrich] insert error: ${error.message}`);
    return result;
  }

  result.nodesCreated = (inserted || []).length;

  // Insert edges: error_pattern --causes_error--> competency
  if (inserted?.length) {
    const edges = inserted.map((n: any) => ({
      from_node_id: n.id,
      to_node_id: competencyNodeId,
      edge_type: "causes_error",
      weight: null,
      payload: {},
      provenance: "ai_enriched",
      confidence: 0.8,
      is_active: true,
    }));

    const { data: edgeData, error: edgeErr } = await sb
      .from("knowledge_graph_edges")
      .insert(edges)
      .select("id");

    if (edgeErr) {
      console.error(`[kg-enrich] edge insert error: ${edgeErr.message}`);
    } else {
      result.edgesCreated = (edgeData || []).length;
    }
  }

  return result;
}

/**
 * Find competencies that need error enrichment.
 * Returns competencies with fewer than `minErrors` error_pattern edges.
 */
export async function findCompetenciesNeedingErrors(
  sb: SB,
  curriculumId: string,
  minErrors: number = 3,
): Promise<Array<{ nodeId: string; sourceId: string; label: string; errorCount: number }>> {
  // Get LF ids -> comp source_ids (SSOT governance: competencies has no curriculum_id)
  const { data: lfs } = await sb
    .from("learning_fields")
    .select("id")
    .eq("curriculum_id", curriculumId);

  if (!lfs?.length) return [];

  const { data: comps } = await sb
    .from("competencies")
    .select("id, title")
    .in("learning_field_id", lfs.map((l: any) => l.id));

  if (!comps?.length) return [];

  // Get competency nodes
  const compIds = comps.map((c: any) => c.id);
  const { data: compNodes } = await sb
    .from("knowledge_graph_nodes")
    .select("id, source_id, label")
    .eq("node_type", "competency")
    .eq("is_active", true)
    .in("source_id", compIds);

  if (!compNodes?.length) return [];

  // Count error_pattern edges per competency node
  const nodeIds = compNodes.map((n: any) => n.id);
  const { data: edges } = await sb
    .from("knowledge_graph_edges")
    .select("to_node_id")
    .eq("edge_type", "causes_error")
    .eq("is_active", true)
    .in("to_node_id", nodeIds);

  const countMap = new Map<string, number>();
  for (const e of edges || []) {
    countMap.set(e.to_node_id, (countMap.get(e.to_node_id) || 0) + 1);
  }

  return compNodes
    .map((n: any) => ({
      nodeId: n.id,
      sourceId: n.source_id,
      label: n.label,
      errorCount: countMap.get(n.id) || 0,
    }))
    .filter((c: any) => c.errorCount < minErrors)
    .sort((a: any, b: any) => a.errorCount - b.errorCount);
}
