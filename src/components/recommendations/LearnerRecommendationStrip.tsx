/**
 * P-Completion 1 — Learner Recommendation Strip wrapper.
 *
 * Drop-in surface for /app pages. Resolves the learner's weak Kompetenzen
 * from SystemConsciousness + KnowledgeGraph and renders the deterministic
 * RecommendationStrip. Silent when no real weaknesses can be derived —
 * never shows hardcoded demo recs.
 */

import { RecommendationStrip } from "./RecommendationStrip";
import { useLearnerRecommendationContext } from "@/hooks/useLearnerRecommendationContext";

interface Props {
  sourceEntityKind: string;
  sourceEntitySlug: string;
  examForm?: "schriftlich" | "muendlich" | "praktisch" | "fachgespraech";
  daysToExam?: number | null;
  limit?: number;
  persona?: string | null;
  packageId?: string | null;
}

export function LearnerRecommendationStrip({
  sourceEntityKind,
  sourceEntitySlug,
  examForm,
  daysToExam,
  limit = 3,
  persona,
  packageId,
}: Props) {
  const ctx = useLearnerRecommendationContext({ examForm, daysToExam, limit });
  if (!ctx.hasWeaknesses) return null;
  return (
    <RecommendationStrip
      graph={ctx.graph}
      weakKompetenzIds={ctx.weakKompetenzIds}
      examForm={ctx.examForm}
      daysToExam={ctx.daysToExam}
      limit={limit}
      sourceEntityKind={sourceEntityKind}
      sourceEntitySlug={sourceEntitySlug}
      persona={persona}
      packageId={packageId}
    />
  );
}
