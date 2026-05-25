/**
 * P-Completion 1 — Learner Recommendation Context hook.
 *
 * Wires SystemConsciousness (risks) + KnowledgeGraph (kompetenzen) +
 * (optional) account package context into a single ready-to-use
 * input for `<RecommendationStrip />`.
 *
 * Pure derivation — no DB writes, no AI.
 */

import { useMemo } from "react";
import { useSystemConsciousness } from "@/lib/system/SystemConsciousness";
import { useKnowledgeGraph } from "@/hooks/useKnowledgeGraph";
import { resolveWeakKompetenzIds } from "@/lib/recommendations/weak-kompetenz-bridge";
import type { KnowledgeGraphSnapshot } from "@/lib/semantic/types";

export interface LearnerRecommendationContext {
  graph: KnowledgeGraphSnapshot;
  weakKompetenzIds: ReadonlyArray<string>;
  examForm?: "schriftlich" | "muendlich" | "praktisch" | "fachgespraech";
  daysToExam: number | null;
  hasWeaknesses: boolean;
}

export function useLearnerRecommendationContext(opts?: {
  examForm?: "schriftlich" | "muendlich" | "praktisch" | "fachgespraech";
  daysToExam?: number | null;
  limit?: number;
}): LearnerRecommendationContext {
  const graph = useKnowledgeGraph();
  const { risks } = useSystemConsciousness();

  const risksArray = useMemo(() => Object.values(risks), [risks]);
  const weakKompetenzIds = useMemo(
    () => resolveWeakKompetenzIds({ graph, risks: risksArray, limit: opts?.limit ?? 6 }),
    [graph, risksArray, opts?.limit],
  );

  const snapshot = useMemo(() => graph.toSnapshot(), [graph]);

  return {
    graph: snapshot,
    weakKompetenzIds,
    examForm: opts?.examForm,
    daysToExam: opts?.daysToExam ?? null,
    hasWeaknesses: weakKompetenzIds.length > 0,
  };
}
