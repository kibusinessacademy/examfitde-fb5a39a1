/**
 * knowledge-graph/ssot-builder.ts — Builds graph nodes and edges from SSOT tables.
 *
 * Phase 1: learning_fields, competencies, question_blueprints + error_patterns
 * All nodes are provenance='ssot', derived deterministically.
 *
 * Key design:
 * - SSOT nodes use source_id (uuid) for real FK references
 * - Synthetic nodes (error_pattern) use source_key (text) for stable composite keys
 * - Batch operations with 200-row chunking (PostgREST limit compliance)
 */

import type { BuildResult } from "./types.ts";

type SB = any;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// ── Node Input types ────────────────────────────────────────────────────────

type NodeInput = {
  nodeType: string;
  sourceTable: string;
  sourceId?: string | null;
  sourceKey?: string | null;
  label: string;
  payload: Record<string, unknown>;
};

/** Stable ref key for nodeMap lookups */
function nodeRefKey(n: { sourceId?: string | null; sourceKey?: string | null }): string {
  if (n.sourceId) return n.sourceId;
  if (n.sourceKey) return `key:${n.sourceKey}`;
  throw new Error("NodeInput requires either sourceId or sourceKey");
}

// ── Batch Node Upsert ───────────────────────────────────────────────────────

async function batchUpsertNodes(
  sb: SB,
  nodes: NodeInput[],
): Promise<{ nodeMap: Map<string, string>; created: number; updated: number }> {
  if (!nodes.length) return { nodeMap: new Map(), created: 0, updated: 0 };

  const sourceTable = nodes[0].sourceTable;

  const nodesWithSourceId = nodes.filter((n) => !!n.sourceId);
  const nodesWithSourceKey = nodes.filter((n) => !n.sourceId && !!n.sourceKey);

  const existingBySourceId = new Map<string, string>();
  const existingBySourceKey = new Map<string, string>();

  // Lookup existing by source_id (200-row chunks per PostgREST limit)
  if (nodesWithSourceId.length) {
    const ids = [...new Set(nodesWithSourceId.map((n) => n.sourceId!))];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data } = await sb
        .from("knowledge_graph_nodes")
        .select("id, source_id")
        .eq("source_table", sourceTable)
        .in("source_id", chunk);
      for (const row of data || []) {
        if (row.source_id) existingBySourceId.set(row.source_id, row.id);
      }
    }
  }

  // Lookup existing by source_key (200-row chunks)
  if (nodesWithSourceKey.length) {
    const keys = [...new Set(nodesWithSourceKey.map((n) => n.sourceKey!))];
    for (let i = 0; i < keys.length; i += 200) {
      const chunk = keys.slice(i, i + 200);
      const { data } = await sb
        .from("knowledge_graph_nodes")
        .select("id, source_key")
        .eq("source_table", sourceTable)
        .in("source_key", chunk);
      for (const row of data || []) {
        if (row.source_key) existingBySourceKey.set(row.source_key, row.id);
      }
    }
  }

  const toInsert: NodeInput[] = [];
  const toUpdate: Array<NodeInput & { id: string }> = [];
  const nodeMap = new Map<string, string>();

  for (const n of nodes) {
    const existingId = n.sourceId
      ? existingBySourceId.get(n.sourceId)
      : existingBySourceKey.get(n.sourceKey!);

    if (existingId) {
      toUpdate.push({ ...n, id: existingId });
      nodeMap.set(nodeRefKey(n), existingId);
    } else {
      toInsert.push(n);
    }
  }

  let created = 0;
  let updated = 0;

  // Batch insert in chunks of 50
  for (let i = 0; i < toInsert.length; i += 50) {
    const chunk = toInsert.slice(i, i + 50);
    const { data: inserted, error } = await sb
      .from("knowledge_graph_nodes")
      .insert(
        chunk.map((n) => ({
          node_type: n.nodeType,
          source_table: n.sourceTable,
          source_id: n.sourceId ?? null,
          source_key: n.sourceKey ?? null,
          label: n.label,
          normalized_label: normalize(n.label),
          payload: n.payload,
          provenance: "ssot",
          confidence: 1.0,
          is_active: true,
        })),
      )
      .select("id, source_id, source_key");

    if (error) {
      if (error.code === "23505") {
        // Race condition fallback: refetch individually
        for (const n of chunk) {
          const q = sb
            .from("knowledge_graph_nodes")
            .select("id")
            .eq("source_table", n.sourceTable);
          const keyed = n.sourceId
            ? q.eq("source_id", n.sourceId)
            : q.eq("source_key", n.sourceKey!);
          const { data: retry } = await keyed.maybeSingle();
          if (retry?.id) nodeMap.set(nodeRefKey(n), retry.id);
        }
        continue;
      }
      console.error(`[kg] batch insert error: ${error.message}`);
      continue;
    }

    for (const row of inserted || []) {
      const key = row.source_id ?? `key:${row.source_key}`;
      nodeMap.set(key, row.id);
    }
    created += (inserted || []).length;
  }

  // Batch update existing in chunks of 50 (parallel within chunk)
  for (let i = 0; i < toUpdate.length; i += 50) {
    const chunk = toUpdate.slice(i, i + 50);
    const now = new Date().toISOString();
    await Promise.all(
      chunk.map((n) =>
        sb
          .from("knowledge_graph_nodes")
          .update({
            label: n.label,
            normalized_label: normalize(n.label),
            payload: n.payload,
            updated_at: now,
          })
          .eq("id", n.id),
      ),
    );
    updated += chunk.length;
  }

  return { nodeMap, created, updated };
}

// ── Batch Edge Insert ───────────────────────────────────────────────────────

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
        // Duplicates — try one-by-one
        for (const e of chunk) {
          const { error: sErr } = await sb
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
          if (sErr) skipped++;
          else created++;
        }
        continue;
      }
      console.error(`[kg] batch edge error: ${error.message}`);
      skipped += chunk.length;
      continue;
    }
    created += (data || []).length;
  }

  return { created, skipped };
}

// ── Main Builder ────────────────────────────────────────────────────────────

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

  // ── 2. Competencies (via learning_fields join — SSOT governance) ──
  const lfIds = lfs.map((l: any) => l.id);
  const { data: comps } = await sb
    .from("competencies")
    .select("id, title, code, description, learning_field_id, bloom_level, typical_misconceptions")
    .in("learning_field_id", lfIds);

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

  // Edges: competency belongs_to learning_field
  const belongsToEdges = [];
  for (const comp of comps || []) {
    const cId = compResult.nodeMap.get(comp.id);
    const lfId = lfResult.nodeMap.get(comp.learning_field_id);
    if (cId && lfId) {
      belongsToEdges.push({ fromNodeId: cId, toNodeId: lfId, edgeType: "belongs_to" });
    }
  }
  const btR = await batchInsertEdges(sb, belongsToEdges);
  result.edgesCreated += btR.created;
  result.edgesSkipped += btR.skipped;

  // ── 2b. Error patterns from typical_misconceptions ──
  const miscNodes: (NodeInput & { _compId: string })[] = [];
  for (const comp of comps || []) {
    if (comp.typical_misconceptions && Array.isArray(comp.typical_misconceptions)) {
      for (const misc of comp.typical_misconceptions) {
        const label = typeof misc === "string" ? misc : (misc as any)?.text || (misc as any)?.label || "";
        if (!label || label.length < 5) continue;
        miscNodes.push({
          nodeType: "error_pattern",
          sourceTable: "competencies",
          sourceId: null,
          sourceKey: `misc:${comp.id}:${normalize(label).slice(0, 80)}`,
          label,
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
    result.nodesUpdated += miscResult.updated;

    const miscEdges = [];
    for (const mn of miscNodes) {
      const errId = miscResult.nodeMap.get(nodeRefKey(mn));
      const compId = compResult.nodeMap.get(mn._compId);
      if (errId && compId) {
        miscEdges.push({ fromNodeId: errId, toNodeId: compId, edgeType: "causes_error" });
      }
    }
    const meR = await batchInsertEdges(sb, miscEdges);
    result.edgesCreated += meR.created;
    result.edgesSkipped += meR.skipped;
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

  // Edges: blueprint tested_by competency
  const testedByEdges = [];
  for (const bp of bps || []) {
    if (bp.competency_id) {
      const bpId = bpResult.nodeMap.get(bp.id);
      const cId = compResult.nodeMap.get(bp.competency_id);
      if (bpId && cId) {
        testedByEdges.push({ fromNodeId: bpId, toNodeId: cId, edgeType: "tested_by" });
      }
    }
  }
  const tbR = await batchInsertEdges(sb, testedByEdges);
  result.edgesCreated += tbR.created;
  result.edgesSkipped += tbR.skipped;

  // ── 3b. Error patterns from typical_errors ──
  const errNodes: (NodeInput & { _compId: string | null })[] = [];
  for (const bp of bps || []) {
    if (bp.typical_errors && Array.isArray(bp.typical_errors)) {
      for (const err of bp.typical_errors) {
        const label = typeof err === "string" ? err : (err as any)?.text || (err as any)?.label || "";
        if (!label || label.length < 5) continue;
        errNodes.push({
          nodeType: "error_pattern",
          sourceTable: "question_blueprints",
          sourceId: null,
          sourceKey: `err:${bp.id}:${normalize(label).slice(0, 80)}`,
          label,
          payload: { source_blueprint_id: bp.id },
          _compId: bp.competency_id ?? null,
        });
      }
    }
  }

  if (errNodes.length) {
    console.log(`[ssot-builder] ${errNodes.length} error patterns from blueprints`);
    const errResult = await batchUpsertNodes(sb, errNodes);
    result.nodesCreated += errResult.created;
    result.nodesUpdated += errResult.updated;

    const errEdges = [];
    for (const en of errNodes) {
      if (en._compId) {
        const errId = errResult.nodeMap.get(nodeRefKey(en));
        const compId = compResult.nodeMap.get(en._compId);
        if (errId && compId) {
          errEdges.push({ fromNodeId: errId, toNodeId: compId, edgeType: "causes_error" });
        }
      }
    }
    const eeR = await batchInsertEdges(sb, errEdges);
    result.edgesCreated += eeR.created;
    result.edgesSkipped += eeR.skipped;
  }

  return result;
}
