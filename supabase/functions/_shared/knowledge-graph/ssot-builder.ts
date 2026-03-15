/**
 * knowledge-graph/ssot-builder.ts — Builds graph nodes and edges from SSOT tables.
 *
 * Phase 1: learning_fields, competencies, question_blueprints
 * All nodes are provenance='ssot', derived deterministically.
 *
 * Optimized: Uses batch fetch + batch insert (no onConflict needed).
 */

import type { BuildResult } from "./types.ts";

type SB = any;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Batch upsert nodes by checking existing first, then inserting new / updating old.
 * Returns map of sourceId → node.id
 */
async function batchUpsertNodes(
  sb: SB,
  sourceTable: string,
  nodes: Array<{
    nodeType: string;
    sourceId: string;
    label: string;
    payload: Record<string, unknown>;
  }>,
): Promise<{ nodeMap: Map<string, string>; created: number; updated: number }> {
  if (!nodes.length) return { nodeMap: new Map(), created: 0, updated: 0 };

  // Fetch all existing nodes for this source_table
  const { data: existing } = await sb
    .from("knowledge_graph_nodes")
    .select("id, source_id")
    .eq("source_table", sourceTable)
    .in("source_id", nodes.map((n) => n.sourceId));

  const existingMap = new Map<string, string>();
  for (const e of existing || []) {
    existingMap.set(e.source_id, e.id);
  }

  const nodeMap = new Map<string, string>();
  let created = 0;
  let updated = 0;

  // Separate new vs existing
  const toInsert = nodes.filter((n) => !existingMap.has(n.sourceId));
  const toUpdate = nodes.filter((n) => existingMap.has(n.sourceId));

  // Batch insert new nodes in chunks of 50
  for (let i = 0; i < toInsert.length; i += 50) {
    const chunk = toInsert.slice(i, i + 50);
    const { data: inserted, error } = await sb
      .from("knowledge_graph_nodes")
      .insert(
        chunk.map((n) => ({
          node_type: n.nodeType,
          source_table: sourceTable,
          source_id: n.sourceId,
          label: n.label,
          normalized_label: normalize(n.label),
          payload: n.payload,
          provenance: "ssot",
          confidence: 1.0,
          is_active: true,
        })),
      )
      .select("id, source_id");

    if (error) {
      // Handle individual constraint violations by falling back to sequential
      if (error.code === "23505") {
        for (const n of chunk) {
          const { data: retry } = await sb
            .from("knowledge_graph_nodes")
            .select("id")
            .eq("source_table", sourceTable)
            .eq("source_id", n.sourceId)
            .maybeSingle();
          if (retry) nodeMap.set(n.sourceId, retry.id);
        }
        continue;
      }
      console.error(`Batch insert error: ${error.message}`);
      continue;
    }
    for (const row of inserted || []) {
      nodeMap.set(row.source_id, row.id);
    }
    created += (inserted || []).length;
  }

  // Batch update existing (label/payload) in chunks
  for (let i = 0; i < toUpdate.length; i += 50) {
    const chunk = toUpdate.slice(i, i + 50);
    const now = new Date().toISOString();
    // Parallel updates within chunk
    await Promise.all(
      chunk.map((n) => {
        const id = existingMap.get(n.sourceId)!;
        nodeMap.set(n.sourceId, id);
        return sb
          .from("knowledge_graph_nodes")
          .update({
            label: n.label,
            normalized_label: normalize(n.label),
            payload: n.payload,
            updated_at: now,
          })
          .eq("id", id);
      }),
    );
    updated += chunk.length;
  }

  return { nodeMap, created, updated };
}

/**
 * Batch insert edges, skipping duplicates via constraint.
 */
async function batchInsertEdges(
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
      .insert(
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
      )
      .select("id");

    if (error) {
      if (error.code === "23505") {
        // Duplicate constraint — try one-by-one
        for (const e of chunk) {
          const { error: singleErr } = await sb
            .from("knowledge_graph_edges")
            .insert({
              from_node_id: e.fromNodeId,
              to_node_id: e.toNodeId,
              edge_type: e.edgeType,
              weight: e.weight ?? null,
              payload: e.payload ?? {},
              provenance: "ssot",
              confidence: 1.0,
              is_active: true,
            });
          if (singleErr) skipped++;
          else created++;
        }
        continue;
      }
      console.error(`Batch edge error: ${error.message}`);
      skipped += chunk.length;
      continue;
    }
    created += (data || []).length;
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
    "learning_fields",
    lfs.map((lf: any) => ({
      nodeType: "learning_field",
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
    "competencies",
    (comps || []).map((c: any) => ({
      nodeType: "competency",
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
  const btResult = await batchInsertEdges(sb, belongsToEdges);
  result.edgesCreated += btResult.created;
  result.edgesSkipped += btResult.skipped;

  // ── 3. Question Blueprints ──
  const { data: bps } = await sb
    .from("question_blueprints")
    .select("id, name, canonical_statement, competency_id, learning_field_id, typical_errors")
    .eq("curriculum_id", curriculumId)
    .neq("status", "deprecated");

  console.log(`[ssot-builder] ${(bps || []).length} blueprints`);

  const bpResult = await batchUpsertNodes(
    sb,
    "question_blueprints",
    (bps || []).map((bp: any) => ({
      nodeType: "blueprint",
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
  const tbResult = await batchInsertEdges(sb, testedByEdges);
  result.edgesCreated += tbResult.created;
  result.edgesSkipped += tbResult.skipped;

  // Note: error_pattern nodes from typical_misconceptions/typical_errors
  // are deferred to Phase 2 (AI Enrichment) since they require text-based
  // composite source_ids which don't fit the uuid source_id column.

  return result;
}
