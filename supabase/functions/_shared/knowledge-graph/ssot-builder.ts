/**
 * knowledge-graph/ssot-builder.ts — Builds graph nodes and edges from SSOT tables.
 *
 * Phase 1: learning_fields, competencies, question_blueprints
 * All nodes are provenance='ssot', derived deterministically.
 *
 * Optimized: Uses batch upserts instead of sequential individual calls.
 */

import type { BuildResult } from "./types.ts";

type SB = any;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Batch upsert nodes. Returns a map of sourceKey → node id.
 */
async function batchUpsertNodes(
  sb: SB,
  nodes: Array<{
    nodeType: string;
    sourceTable: string;
    sourceId: string;
    label: string;
    payload: Record<string, unknown>;
  }>,
): Promise<{ nodeMap: Map<string, string>; created: number; updated: number }> {
  if (!nodes.length) return { nodeMap: new Map(), created: 0, updated: 0 };

  const sourceKeys = nodes.map((n) => n.sourceId);
  const sourceTable = nodes[0].sourceTable;

  // Fetch all existing nodes for this source_table in one query
  const { data: existing } = await sb
    .from("knowledge_graph_nodes")
    .select("id, source_id")
    .eq("source_table", sourceTable)
    .in("source_id", sourceKeys);

  const existingMap = new Map<string, string>();
  for (const e of existing || []) {
    existingMap.set(e.source_id, e.id);
  }

  // Split into inserts and updates
  const toInsert = [];
  const toUpdate = [];
  for (const n of nodes) {
    const existingId = existingMap.get(n.sourceId);
    if (existingId) {
      toUpdate.push({ id: existingId, ...n });
    } else {
      toInsert.push(n);
    }
  }

  let created = 0;
  let updated = 0;
  const nodeMap = new Map<string, string>();

  // Batch insert new nodes (chunks of 50)
  for (let i = 0; i < toInsert.length; i += 50) {
    const chunk = toInsert.slice(i, i + 50);
    const { data: inserted, error } = await sb
      .from("knowledge_graph_nodes")
      .upsert(
        chunk.map((n) => ({
          node_type: n.nodeType,
          source_table: n.sourceTable,
          source_id: n.sourceId,
          label: n.label,
          normalized_label: normalize(n.label),
          payload: n.payload,
          provenance: "ssot",
          confidence: 1.0,
          is_active: true,
        })),
        { onConflict: "source_table,source_id", ignoreDuplicates: false },
      )
      .select("id, source_id");

    if (error) {
      console.error(`Batch insert error: ${error.message}`);
      continue;
    }
    for (const row of inserted || []) {
      nodeMap.set(row.source_id, row.id);
    }
    created += (inserted || []).length;
  }

  // Batch update existing nodes (chunks of 50)
  for (let i = 0; i < toUpdate.length; i += 50) {
    const chunk = toUpdate.slice(i, i + 50);
    for (const n of chunk) {
      await sb
        .from("knowledge_graph_nodes")
        .update({
          label: n.label,
          normalized_label: normalize(n.label),
          payload: n.payload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", n.id);
      nodeMap.set(n.sourceId, n.id);
    }
    updated += chunk.length;
  }

  return { nodeMap, created, updated };
}

/**
 * Batch upsert edges. Skips duplicates via onConflict.
 */
async function batchUpsertEdges(
  sb: SB,
  edges: Array<{
    fromNodeId: string;
    toNodeId: string;
    edgeType: string;
    weight?: number | null;
    payload?: Record<string, unknown>;
  }>,
): Promise<{ created: number; skipped: number }> {
  if (!edges.length) return { created: 0, skipped: 0 };

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < edges.length; i += 50) {
    const chunk = edges.slice(i, i + 50);
    const { data, error } = await sb
      .from("knowledge_graph_edges")
      .upsert(
        chunk.map((e) => ({
          from_node_id: e.fromNodeId,
          to_node_id: e.toNodeId,
          edge_type: e.edgeType,
          weight: e.weight ?? null,
          payload: e.payload ?? {},
          provenance: "ssot",
          confidence: 1.0,
          is_active: true,
        })),
        { onConflict: "from_node_id,to_node_id,edge_type", ignoreDuplicates: true },
      )
      .select("id");

    if (error) {
      console.error(`Batch edge error: ${error.message}`);
      skipped += chunk.length;
      continue;
    }
    created += (data || []).length;
    skipped += chunk.length - (data || []).length;
  }

  return { created, skipped };
}

/**
 * Build the full SSOT graph for a curriculum.
 */
export async function buildSSOTGraph(
  sb: SB,
  curriculumId: string,
): Promise<BuildResult> {
  const result: BuildResult = {
    nodesCreated: 0,
    nodesUpdated: 0,
    edgesCreated: 0,
    edgesSkipped: 0,
    errors: [],
  };

  // ── 1. Learning Fields ──
  const { data: lfs } = await sb
    .from("learning_fields")
    .select("id, title, code, description, curriculum_id")
    .eq("curriculum_id", curriculumId);

  if (!lfs?.length) {
    result.errors.push("No learning_fields found for curriculum");
    return result;
  }

  console.log(`[ssot-builder] ${lfs.length} learning fields`);

  const lfResult = await batchUpsertNodes(
    sb,
    lfs.map((lf: any) => ({
      nodeType: "learning_field",
      sourceTable: "learning_fields",
      sourceId: lf.id,
      label: lf.title,
      payload: { code: lf.code, description: lf.description, curriculum_id: lf.curriculum_id },
    })),
  );
  result.nodesCreated += lfResult.created;
  result.nodesUpdated += lfResult.updated;
  const lfNodeMap = lfResult.nodeMap;

  // ── 2. Competencies (via learning_fields join — SSOT governance) ──
  const { data: comps } = await sb
    .from("competencies")
    .select("id, title, code, description, learning_field_id, bloom_level, typical_misconceptions")
    .in("learning_field_id", lfs.map((l: any) => l.id));

  console.log(`[ssot-builder] ${(comps || []).length} competencies`);

  const compResult = await batchUpsertNodes(
    sb,
    (comps || []).map((c: any) => ({
      nodeType: "competency",
      sourceTable: "competencies",
      sourceId: c.id,
      label: c.title,
      payload: { code: c.code, description: c.description, bloom_level: c.bloom_level },
    })),
  );
  result.nodesCreated += compResult.created;
  result.nodesUpdated += compResult.updated;
  const compNodeMap = compResult.nodeMap;

  // Edges: competency belongs_to learning_field
  const belongsToEdges = [];
  for (const comp of comps || []) {
    const compNodeId = compNodeMap.get(comp.id);
    const lfNodeId = lfNodeMap.get(comp.learning_field_id);
    if (compNodeId && lfNodeId) {
      belongsToEdges.push({ fromNodeId: compNodeId, toNodeId: lfNodeId, edgeType: "belongs_to" });
    }
  }
  const btResult = await batchUpsertEdges(sb, belongsToEdges);
  result.edgesCreated += btResult.created;
  result.edgesSkipped += btResult.skipped;

  // Error patterns from typical_misconceptions
  const miscNodes = [];
  for (const comp of comps || []) {
    if (comp.typical_misconceptions && Array.isArray(comp.typical_misconceptions)) {
      for (const misc of comp.typical_misconceptions) {
        const miscLabel = typeof misc === "string" ? misc : (misc as any)?.text || (misc as any)?.label || "";
        if (!miscLabel || miscLabel.length < 5) continue;
        miscNodes.push({
          nodeType: "error_pattern",
          sourceTable: "competencies",
          sourceId: `${comp.id}_misc_${normalize(miscLabel).slice(0, 40)}`,
          label: miscLabel,
          payload: { source_competency_id: comp.id },
          _compId: comp.id,
        });
      }
    }
  }

  if (miscNodes.length) {
    console.log(`[ssot-builder] ${miscNodes.length} error patterns from misconceptions`);
    const miscResult = await batchUpsertNodes(sb, miscNodes);
    result.nodesCreated += miscResult.created;

    const miscEdges = [];
    for (const mn of miscNodes) {
      const errNodeId = miscResult.nodeMap.get(mn.sourceId);
      const compNodeId = compNodeMap.get(mn._compId);
      if (errNodeId && compNodeId) {
        miscEdges.push({ fromNodeId: errNodeId, toNodeId: compNodeId, edgeType: "causes_error" });
      }
    }
    const meResult = await batchUpsertEdges(sb, miscEdges);
    result.edgesCreated += meResult.created;
    result.edgesSkipped += meResult.skipped;
  }

  // ── 3. Question Blueprints ──
  const { data: bps } = await sb
    .from("question_blueprints")
    .select("id, name, canonical_statement, competency_id, learning_field_id, typical_errors")
    .eq("curriculum_id", curriculumId)
    .neq("status", "deprecated");

  console.log(`[ssot-builder] ${(bps || []).length} blueprints`);

  const bpResult = await batchUpsertNodes(
    sb,
    (bps || []).map((bp: any) => ({
      nodeType: "blueprint",
      sourceTable: "question_blueprints",
      sourceId: bp.id,
      label: bp.name,
      payload: { canonical_statement: bp.canonical_statement },
    })),
  );
  result.nodesCreated += bpResult.created;
  result.nodesUpdated += bpResult.updated;
  const bpNodeMap = bpResult.nodeMap;

  // Edges: blueprint tested_by competency
  const testedByEdges = [];
  for (const bp of bps || []) {
    if (bp.competency_id) {
      const bpNodeId = bpNodeMap.get(bp.id);
      const compNodeId = compNodeMap.get(bp.competency_id);
      if (bpNodeId && compNodeId) {
        testedByEdges.push({ fromNodeId: bpNodeId, toNodeId: compNodeId, edgeType: "tested_by" });
      }
    }
  }
  const tbResult = await batchUpsertEdges(sb, testedByEdges);
  result.edgesCreated += tbResult.created;
  result.edgesSkipped += tbResult.skipped;

  // Error patterns from typical_errors
  const errNodes = [];
  for (const bp of bps || []) {
    if (bp.typical_errors && Array.isArray(bp.typical_errors)) {
      for (const err of bp.typical_errors) {
        const errLabel = typeof err === "string" ? err : (err as any)?.text || (err as any)?.label || "";
        if (!errLabel || errLabel.length < 5) continue;
        errNodes.push({
          nodeType: "error_pattern",
          sourceTable: "question_blueprints",
          sourceId: `${bp.id}_err_${normalize(errLabel).slice(0, 40)}`,
          label: errLabel,
          payload: { source_blueprint_id: bp.id },
          _compId: bp.competency_id,
        });
      }
    }
  }

  if (errNodes.length) {
    console.log(`[ssot-builder] ${errNodes.length} error patterns from blueprints`);
    const errResult = await batchUpsertNodes(sb, errNodes);
    result.nodesCreated += errResult.created;

    const errEdges = [];
    for (const en of errNodes) {
      if (en._compId) {
        const errNodeId = errResult.nodeMap.get(en.sourceId);
        const compNodeId = compNodeMap.get(en._compId);
        if (errNodeId && compNodeId) {
          errEdges.push({ fromNodeId: errNodeId, toNodeId: compNodeId, edgeType: "causes_error" });
        }
      }
    }
    const eeResult = await batchUpsertEdges(sb, errEdges);
    result.edgesCreated += eeResult.created;
    result.edgesSkipped += eeResult.skipped;
  }

  return result;
}
