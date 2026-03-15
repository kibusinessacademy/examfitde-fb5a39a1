/**
 * knowledge-graph/query.ts — Query helpers for fetching graph context.
 *
 * Used by generators to enrich prompts with graph signals.
 */

import type { GraphContext } from "./types.ts";

type SB = any; // SupabaseClient

/**
 * Fetch graph context for a competency node.
 * Returns related concepts, contrast concepts, common errors, and learning field.
 */
export async function getGraphContextForCompetency(
  sb: SB,
  competencyId: string,
): Promise<GraphContext | null> {
  // Find the competency node
  const { data: compNode } = await sb
    .from("knowledge_graph_nodes")
    .select("id, label")
    .eq("source_table", "competencies")
    .eq("source_id", competencyId)
    .eq("is_active", true)
    .maybeSingle();

  if (!compNode) return null;

  // Get all edges from this node
  const { data: outEdges } = await sb
    .from("knowledge_graph_edges")
    .select("edge_type, to_node_id, knowledge_graph_nodes!knowledge_graph_edges_to_node_id_fkey(label, node_type)")
    .eq("from_node_id", compNode.id)
    .eq("is_active", true);

  // Get all edges to this node
  const { data: inEdges } = await sb
    .from("knowledge_graph_edges")
    .select("edge_type, from_node_id, knowledge_graph_nodes!knowledge_graph_edges_from_node_id_fkey(label, node_type)")
    .eq("to_node_id", compNode.id)
    .eq("is_active", true);

  const related: string[] = [];
  const contrast: string[] = [];
  const errors: string[] = [];
  let lfLabel = "";

  for (const e of outEdges || []) {
    const targetLabel = (e as any).knowledge_graph_nodes?.label || "";
    switch (e.edge_type) {
      case "belongs_to":
        if ((e as any).knowledge_graph_nodes?.node_type === "learning_field") lfLabel = targetLabel;
        break;
      case "relates_to":
        related.push(targetLabel);
        break;
      case "confused_with":
        contrast.push(targetLabel);
        break;
      case "causes_error":
        errors.push(targetLabel);
        break;
    }
  }

  for (const e of inEdges || []) {
    const sourceLabel = (e as any).knowledge_graph_nodes?.label || "";
    switch (e.edge_type) {
      case "confused_with":
        if (!contrast.includes(sourceLabel)) contrast.push(sourceLabel);
        break;
      case "causes_error":
        if (!errors.includes(sourceLabel)) errors.push(sourceLabel);
        break;
      case "relates_to":
        if (!related.includes(sourceLabel)) related.push(sourceLabel);
        break;
    }
  }

  return {
    core_competency: compNode.label,
    related_concepts: related.slice(0, 10),
    contrast_concepts: contrast.slice(0, 5),
    common_errors: errors.slice(0, 5),
    learning_field: lfLabel,
  };
}

/**
 * Fetch graph context for a blueprint node.
 */
export async function getGraphContextForBlueprint(
  sb: SB,
  blueprintId: string,
): Promise<GraphContext | null> {
  // Find the blueprint node
  const { data: bpNode } = await sb
    .from("knowledge_graph_nodes")
    .select("id, label")
    .eq("source_table", "question_blueprints")
    .eq("source_id", blueprintId)
    .eq("is_active", true)
    .maybeSingle();

  if (!bpNode) return null;

  // Get tested_by edge → competency
  const { data: testedBy } = await sb
    .from("knowledge_graph_edges")
    .select("to_node_id")
    .eq("from_node_id", bpNode.id)
    .eq("edge_type", "tested_by")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!testedBy?.to_node_id) {
    return {
      core_competency: "",
      related_concepts: [],
      contrast_concepts: [],
      common_errors: [],
      learning_field: "",
      blueprint_name: bpNode.label,
    };
  }

  // Get the competency's source_id to delegate
  const { data: compNode } = await sb
    .from("knowledge_graph_nodes")
    .select("source_id")
    .eq("id", testedBy.to_node_id)
    .maybeSingle();

  if (!compNode?.source_id) return null;

  const ctx = await getGraphContextForCompetency(sb, compNode.source_id);
  if (ctx) ctx.blueprint_name = bpNode.label;
  return ctx;
}
