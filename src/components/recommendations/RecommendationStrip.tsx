/**
 * W1 Cut 3b — Semantic Recommendation Strip.
 *
 * Renders deterministic, exam-focused recommendations derived from the
 * KnowledgeGraph + (optional) weak competency set. Every item carries
 * machine-readable evidence and fires governed telemetry on render+click.
 *
 * NEVER renders "users also bought" / collaborative-filter copy.
 */

import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import {
  recommendForWeaknesses,
  type Recommendation,
} from "@/lib/recommendations";
import { WEAKNESS_CLUSTER_LABEL } from "@/lib/recommendations/weakness-clusters";
import {
  recordRecommendationView,
  recordRecommendationClick,
} from "@/lib/intent/decision-telemetry";
import type { KnowledgeGraphSnapshot } from "@/lib/semantic/types";

interface Props {
  graph: KnowledgeGraphSnapshot;
  weakKompetenzIds: ReadonlyArray<string>;
  examForm?: "schriftlich" | "muendlich" | "praktisch" | "fachgespraech";
  daysToExam?: number | null;
  limit?: number;
  sourceEntityKind: string;
  sourceEntitySlug: string;
  persona?: string | null;
  packageId?: string | null;
  /** Default true; tests pass false. */
  telemetryEnabled?: boolean;
}

export function RecommendationStrip({
  graph,
  weakKompetenzIds,
  examForm,
  daysToExam,
  limit = 3,
  sourceEntityKind,
  sourceEntitySlug,
  persona,
  packageId,
  telemetryEnabled = true,
}: Props) {
  const recs = useMemo<ReadonlyArray<Recommendation>>(() => {
    return recommendForWeaknesses(graph, {
      weak_kompetenz_ids: weakKompetenzIds,
      exam_form: examForm,
      days_to_exam: daysToExam,
      limit,
    });
  }, [graph, weakKompetenzIds, examForm, daysToExam, limit]);

  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || recs.length === 0 || !telemetryEnabled) return;
    firedRef.current = true;
    for (const r of recs) {
      recordRecommendationView({
        recommendation_id: r.id,
        source_entity_kind: sourceEntityKind,
        source_entity_slug: sourceEntitySlug,
        recommendation_reason: r.evidence.recommendation_reason,
        semantic_similarity_score: r.evidence.semantic_similarity_score,
        competency_overlap: r.evidence.competency_overlap,
        exam_relevance: r.evidence.exam_relevance,
        weakness_relation: r.evidence.weakness_relation,
        persona,
        package_id: packageId,
      });
    }
  }, [recs, sourceEntityKind, sourceEntitySlug, persona, packageId, telemetryEnabled]);

  if (recs.length === 0) return null;

  const handleClick = (r: Recommendation) => {
    if (!telemetryEnabled) return;
    recordRecommendationClick({
      recommendation_id: r.id,
      source_entity_kind: sourceEntityKind,
      source_entity_slug: sourceEntitySlug,
      recommendation_reason: r.evidence.recommendation_reason,
      semantic_similarity_score: r.evidence.semantic_similarity_score,
      competency_overlap: r.evidence.competency_overlap,
      exam_relevance: r.evidence.exam_relevance,
      weakness_relation: r.evidence.weakness_relation,
      persona,
      package_id: packageId,
    });
  };

  return (
    <section
      aria-labelledby="rec-strip-headline"
      className="mt-10 rounded-2xl border border-border bg-card p-5 sm:p-7"
      data-rec-source-kind={sourceEntityKind}
      data-rec-source-slug={sourceEntitySlug}
    >
      <header className="mb-4">
        <h3
          id="rec-strip-headline"
          className="text-base font-semibold text-foreground sm:text-lg"
        >
          Azubis mit ähnlichen Schwächen trainieren häufig zuerst:
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Empfehlungen entstehen prüfungsnah und kompetenzbasiert — keine
          „andere Nutzer haben gekauft“-Logik.
        </p>
      </header>
      <ul className="space-y-3">
        {recs.map((r) => (
          <li key={r.id}>
            <Link
              to={r.href ?? "#"}
              onClick={() => handleClick(r)}
              className="group flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-background p-3 transition hover:border-primary/40 hover:bg-accent/30"
              data-rec-id={r.id}
              data-rec-reason={r.evidence.recommendation_reason}
              data-rec-relevance={r.evidence.exam_relevance}
              data-rec-relation={r.evidence.weakness_relation}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {r.title}
                </div>
                {r.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {r.description}
                  </p>
                ) : null}
                {r.evidence.weakness_clusters.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.evidence.weakness_clusters.map((c) => (
                      <span
                        key={c}
                        className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {WEAKNESS_CLUSTER_LABEL[c]}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <ArrowRight
                className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
