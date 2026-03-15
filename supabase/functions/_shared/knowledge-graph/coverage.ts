/**
 * knowledge-graph/coverage.ts — Coverage analysis using the knowledge graph.
 *
 * Identifies which concepts/competencies are well-covered by exam questions
 * and which have gaps, enabling deficit-based generation on graph level.
 */

type SB = any;

export interface CoverageEntry {
  nodeId: string;
  nodeType: string;
  label: string;
  questionCount: number;
  blueprintCount: number;
  coverageScore: number; // 0-1
}

/**
 * Get coverage analysis for a curriculum's knowledge graph.
 * Checks how many exam_questions exist per competency node.
 */
export async function getGraphCoverage(
  sb: SB,
  curriculumId: string,
): Promise<CoverageEntry[]> {
  // Get all competency nodes for this curriculum
  const { data: compNodes } = await sb
    .from("knowledge_graph_nodes")
    .select("id, label, source_id, payload")
    .eq("node_type", "competency")
    .eq("is_active", true);

  if (!compNodes?.length) return [];

  // Get question counts per competency
  const sourceIds = compNodes.map((n: any) => n.source_id).filter(Boolean);
  const { data: qCounts } = await sb
    .from("exam_questions")
    .select("competency_id")
    .in("competency_id", sourceIds)
    .neq("status", "rejected");

  // Count per competency
  const countMap = new Map<string, number>();
  for (const q of qCounts || []) {
    countMap.set(q.competency_id, (countMap.get(q.competency_id) || 0) + 1);
  }

  // Get blueprint counts per competency
  const { data: bpCounts } = await sb
    .from("question_blueprints")
    .select("competency_id")
    .in("competency_id", sourceIds)
    .neq("status", "deprecated");

  const bpMap = new Map<string, number>();
  for (const bp of bpCounts || []) {
    if (bp.competency_id) {
      bpMap.set(bp.competency_id, (bpMap.get(bp.competency_id) || 0) + 1);
    }
  }

  // Build coverage entries
  const maxCount = Math.max(...Array.from(countMap.values()), 1);

  return compNodes.map((node: any) => {
    const qCount = countMap.get(node.source_id) || 0;
    const bpCount = bpMap.get(node.source_id) || 0;
    return {
      nodeId: node.id,
      nodeType: "competency",
      label: node.label,
      questionCount: qCount,
      blueprintCount: bpCount,
      coverageScore: Math.min(qCount / maxCount, 1),
    };
  }).sort((a: CoverageEntry, b: CoverageEntry) => a.coverageScore - b.coverageScore);
}
