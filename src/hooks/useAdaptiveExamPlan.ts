/**
 * P-Completion 3 — useAdaptiveExamPlan.
 *
 * Bridge: Blueprint (vom Aufrufer übergeben, da pro Curriculum geladen) +
 * KnowledgeGraph (Kompetenz-Namen) + SystemConsciousness (Signals/Risks) +
 * Recovery-Plan → AdaptiveExamPlan (rein deterministisch).
 *
 * KEIN Backend-Write. KEIN Shadow-State. Reine Re-Komposition der SSOTs.
 */
import { useMemo } from "react";
import { useKnowledgeGraph } from "@/hooks/useKnowledgeGraph";
import { useSystemConsciousness } from "@/lib/system/SystemConsciousness";
import { resolveWeakKompetenzIds } from "@/lib/recommendations/weak-kompetenz-bridge";
import { useRecoveryPlan } from "@/hooks/useRecoveryPlan";
import { buildAdaptiveExamPlan } from "@/lib/exam/adaptiveEngine";
import type { AdaptiveExamPlan, BlueprintWeight, MasterySnapshot } from "@/lib/exam/types";

export interface UseAdaptiveExamPlanArgs {
  /** Blueprint-Total + Difficulty-Distribution (z.B. aus useExamSimulation). */
  totalQuestions: number;
  difficultyDistribution: { easy: number; medium: number; hard: number };
  /** Blueprint-Gewichte je Kompetenz. Wenn leer → Plan leer. */
  weights: ReadonlyArray<BlueprintWeight>;
  /** Optional. Defaults to 0.5 für jede Kompetenz wenn fehlt. */
  mastery?: ReadonlyArray<MasterySnapshot>;
  /** Optional. Default 0.15. */
  maxDrift?: number;
}

export function useAdaptiveExamPlan(args: UseAdaptiveExamPlanArgs): AdaptiveExamPlan {
  const graph = useKnowledgeGraph();
  const { risks, signals } = useSystemConsciousness();
  const recovery = useRecoveryPlan({ limit: 6 });

  return useMemo(() => {
    const risksArr = Object.values(risks);
    const weakIds = resolveWeakKompetenzIds({ graph, risks: risksArr, limit: 8 });
    const recoveryIds = recovery.recommendations.map((r) => r.competency_id);
    return buildAdaptiveExamPlan({
      blueprint: {
        total_questions: args.totalQuestions,
        difficulty_distribution: args.difficultyDistribution,
        weights: args.weights,
        max_drift: args.maxDrift,
      },
      mastery: args.mastery ?? [],
      weakKompetenzIds: weakIds,
      recoveryCompetencyIds: recoveryIds,
      signals: {
        structureStability: signals.structureStability,
        confidence: signals.confidence,
      },
    });
  }, [
    graph,
    risks,
    signals,
    recovery,
    args.totalQuestions,
    args.difficultyDistribution,
    args.weights,
    args.mastery,
    args.maxDrift,
  ]);
}
