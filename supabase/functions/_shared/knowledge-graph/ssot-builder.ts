/**
 * knowledge-graph/ssot-builder.ts — Builds graph nodes and edges from SSOT tables.
 *
 * Phase 1: learning_fields, competencies, question_blueprints
 * All nodes are provenance='ssot', derived deterministically.
 */

import type { BuildResult } from "./types.ts";

type SB = any;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Upsert a node by source_table + source_id. Returns the node ID.
 */
async function upsertNode(
  sb: SB,
  nodeType: string,
  sourceTable: string,
  sourceId: string,
  label: string,
  payload: Record<string, unknown> = {},
): Promise<{ id: string; created: boolean }> {
  // Check existing
  const { data: existing } = await sb
    .from("knowledge_graph_nodes")
    .select("id")
    .eq("source_table", sourceTable)
    .eq("source_id", sourceId)
    .maybeSingle();

  if (existing) {
    // Update label if changed
    await sb.from("knowledge_graph_nodes").update({
      label,
      normalized_label: normalize(label),
      payload,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    return { id: existing.id, created: false };
  }

  const { data: inserted, error } = await sb
    .from("knowledge_graph_nodes")
    .insert({
      node_type: nodeType,
      source_table: sourceTable,
      source_id: sourceId,
      label,
      normalized_label: normalize(label),
      payload,
      provenance: "ssot",
      confidence: 1.0,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    // Unique constraint → already exists (race condition)
    if (error.code === "23505") {
      const { data: retry } = await sb
        .from("knowledge_graph_nodes")
        .select("id")
        .eq("source_table", sourceTable)
        .eq("source_id", sourceId)
        .single();
      return { id: retry.id, created: false };
    }
    throw new Error(`Node insert failed: ${error.message}`);
  }

  return { id: inserted.id, created: true };
}

/**
 * Upsert an edge by from/to/type. Returns created status.
 */
async function upsertEdge(
  sb: SB,
  fromNodeId: string,
  toNodeId: string,
  edgeType: string,
  weight: number | null = null,
  payload: Record<string, unknown> = {},
): Promise<boolean> {
  const { error } = await sb
    .from("knowledge_graph_edges")
    .insert({
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      edge_type: edgeType,
      weight,
      payload,
      provenance: "ssot",
      confidence: 1.0,
      is_active: true,
    });

  if (error) {
    if (error.code === "23505") return false; // Already exists
    throw new Error(`Edge insert failed: ${error.message}`);
  }
  return true;
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

  const lfNodeMap = new Map<string, string>(); // lf.id → node.id

  for (const lf of lfs || []) {
    try {
      const { id, created } = await upsertNode(sb, "learning_field", "learning_fields", lf.id, lf.title, {
        code: lf.code,
        description: lf.description,
        curriculum_id: lf.curriculum_id,
      });
      lfNodeMap.set(lf.id, id);
      if (created) result.nodesCreated++; else result.nodesUpdated++;
    } catch (e) {
      result.errors.push(`LF ${lf.id}: ${(e as Error).message}`);
    }
  }

  // ── 2. Competencies ──
  const { data: comps } = await sb
    .from("competencies")
    .select("id, title, code, description, learning_field_id, bloom_level, typical_misconceptions")
    .in("learning_field_id", lfs?.map((l: any) => l.id) || []);

  const compNodeMap = new Map<string, string>(); // comp.id → node.id

  for (const comp of comps || []) {
    try {
      const { id, created } = await upsertNode(sb, "competency", "competencies", comp.id, comp.title, {
        code: comp.code,
        description: comp.description,
        bloom_level: comp.bloom_level,
      });
      compNodeMap.set(comp.id, id);
      if (created) result.nodesCreated++; else result.nodesUpdated++;

      // Edge: competency belongs_to learning_field
      const lfNodeId = lfNodeMap.get(comp.learning_field_id);
      if (lfNodeId) {
        const edgeCreated = await upsertEdge(sb, id, lfNodeId, "belongs_to");
        if (edgeCreated) result.edgesCreated++; else result.edgesSkipped++;
      }

      // Extract error_pattern nodes from typical_misconceptions
      if (comp.typical_misconceptions && Array.isArray(comp.typical_misconceptions)) {
        for (const misc of comp.typical_misconceptions) {
          const miscLabel = typeof misc === "string" ? misc : (misc as any)?.text || (misc as any)?.label || "";
          if (!miscLabel || miscLabel.length < 5) continue;

          try {
            const { id: errNodeId, created: errCreated } = await upsertNode(
              sb, "error_pattern", "competencies", `${comp.id}_misc_${normalize(miscLabel).slice(0, 40)}`,
              miscLabel, { source_competency_id: comp.id },
            );
            if (errCreated) result.nodesCreated++;

            const errEdge = await upsertEdge(sb, errNodeId, id, "causes_error");
            if (errEdge) result.edgesCreated++; else result.edgesSkipped++;
          } catch {
            // Skip individual misconception errors
          }
        }
      }
    } catch (e) {
      result.errors.push(`Comp ${comp.id}: ${(e as Error).message}`);
    }
  }

  // ── 3. Question Blueprints ──
  const { data: bps } = await sb
    .from("question_blueprints")
    .select("id, name, canonical_statement, competency_id, learning_field_id, typical_errors")
    .eq("curriculum_id", curriculumId)
    .neq("status", "deprecated");

  for (const bp of bps || []) {
    try {
      const { id, created } = await upsertNode(sb, "blueprint", "question_blueprints", bp.id, bp.name, {
        canonical_statement: bp.canonical_statement,
      });
      if (created) result.nodesCreated++; else result.nodesUpdated++;

      // Edge: blueprint tested_by competency
      if (bp.competency_id) {
        const compNodeId = compNodeMap.get(bp.competency_id);
        if (compNodeId) {
          const edgeCreated = await upsertEdge(sb, id, compNodeId, "tested_by");
          if (edgeCreated) result.edgesCreated++; else result.edgesSkipped++;
        }
      }

      // Extract error patterns from typical_errors
      if (bp.typical_errors && Array.isArray(bp.typical_errors)) {
        for (const err of bp.typical_errors) {
          const errLabel = typeof err === "string" ? err : (err as any)?.text || (err as any)?.label || "";
          if (!errLabel || errLabel.length < 5) continue;

          try {
            const { id: errNodeId, created: errCreated } = await upsertNode(
              sb, "error_pattern", "question_blueprints", `${bp.id}_err_${normalize(errLabel).slice(0, 40)}`,
              errLabel, { source_blueprint_id: bp.id },
            );
            if (errCreated) result.nodesCreated++;

            // Link error to blueprint's competency
            if (bp.competency_id) {
              const compNodeId = compNodeMap.get(bp.competency_id);
              if (compNodeId) {
                const errEdge = await upsertEdge(sb, errNodeId, compNodeId, "causes_error");
                if (errEdge) result.edgesCreated++; else result.edgesSkipped++;
              }
            }
          } catch {
            // Skip individual error pattern failures
          }
        }
      }
    } catch (e) {
      result.errors.push(`BP ${bp.id}: ${(e as Error).message}`);
    }
  }

  return result;
}
