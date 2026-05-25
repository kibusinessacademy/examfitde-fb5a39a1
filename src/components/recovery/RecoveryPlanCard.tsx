/**
 * P-Completion 2 — Recovery Plan Card.
 *
 * Per-Kompetenz Karte mit deterministischen Recovery-Actions.
 * Telemetry (view + click) läuft über das bestehende SSOT
 * `recordRecommendationView/Click` (recommendation_id="recovery:<uuid>").
 * Kein neues event_type, keine Edge-Function-Änderung.
 */

import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Sparkles, Brain, MessageCircle, Timer } from "lucide-react";
import { useRecoveryPlan } from "@/hooks/useRecoveryPlan";
import {
  recordRecommendationView,
  recordRecommendationClick,
} from "@/lib/intent/decision-telemetry";
import type {
  RecoveryAction,
  RecoveryRecommendation,
  RecoverySeverity,
} from "@/lib/recovery/types";

interface Props {
  sourceEntityKind: string;
  sourceEntitySlug: string;
  persona?: string | null;
  packageId?: string | null;
  limit?: number;
}

const SEVERITY_LABEL: Record<RecoverySeverity, string> = {
  high: "Kritisch",
  medium: "Beobachten",
  low: "Stabilisieren",
};

const SEVERITY_TONE: Record<RecoverySeverity, string> = {
  high: "bg-status-bg-subtle-error text-status-fg-error border-status-border-error",
  medium: "bg-status-bg-subtle-warning text-status-fg-warning border-status-border-warning",
  low: "bg-status-bg-subtle-info text-status-fg-info border-status-border-info",
};

const ACTION_ICON: Record<RecoveryAction["path_type"], typeof Brain> = {
  explain_again: MessageCircle,
  practice_drill: Sparkles,
  exam_trap_training: ShieldCheck,
  confidence_recovery: Brain,
};

export function RecoveryPlanCard({
  sourceEntityKind,
  sourceEntitySlug,
  persona,
  packageId,
  limit = 4,
}: Props) {
  const plan = useRecoveryPlan({ limit });
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current || plan.recommendations.length === 0) return;
    firedRef.current = true;
    for (const r of plan.recommendations) {
      recordRecommendationView({
        recommendation_id: r.id,
        source_entity_kind: sourceEntityKind,
        source_entity_slug: sourceEntitySlug,
        recommendation_reason: r.recovery_reason,
        semantic_similarity_score: r.mastery_target_delta,
        competency_overlap: r.weakness_sources.length,
        exam_relevance: r.severity === "high" ? "high" : r.severity === "medium" ? "medium" : "low",
        weakness_relation: "direct",
        persona,
        package_id: packageId,
      });
    }
  }, [plan.recommendations, sourceEntityKind, sourceEntitySlug, persona, packageId]);

  if (plan.recommendations.length === 0) return null;

  const handleClick = (r: RecoveryRecommendation, a: RecoveryAction) => {
    recordRecommendationClick({
      recommendation_id: `${r.id}#${a.path_type}`,
      source_entity_kind: sourceEntityKind,
      source_entity_slug: sourceEntitySlug,
      recommendation_reason: `${r.recovery_reason}|${a.path_type}`,
      semantic_similarity_score: r.mastery_target_delta,
      competency_overlap: r.weakness_sources.length,
      exam_relevance: r.severity === "high" ? "high" : r.severity === "medium" ? "medium" : "low",
      weakness_relation: "direct",
      persona,
      package_id: packageId,
    });
  };

  return (
    <section
      aria-labelledby="recovery-plan-headline"
      className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-7"
      data-recovery-source-kind={sourceEntityKind}
      data-recovery-source-slug={sourceEntitySlug}
    >
      <header className="mb-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Recovery-Plan
        </div>
        <h3 id="recovery-plan-headline" className="mt-1 text-base font-semibold text-foreground sm:text-lg">
          Wir bringen dich zurück in einen sicheren Prüfungszustand.
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{plan.reflection}</p>
      </header>

      <ul className="space-y-4">
        {plan.recommendations.map((r) => (
          <li
            key={r.id}
            className="rounded-xl border border-border/60 bg-background p-4"
            data-rec-id={r.id}
            data-rec-severity={r.severity}
            data-rec-reason={r.recovery_reason}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {r.competency_name}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${SEVERITY_TONE[r.severity]}`}>
                    {SEVERITY_LABEL[r.severity]}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Timer className="h-3 w-3" aria-hidden />
                    Re-Test in {r.retry_after_hours}h
                  </span>
                  <span>+{Math.round(r.mastery_target_delta * 100)}% Ziel-Mastery</span>
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {r.actions.map((a) => {
                const Icon = ACTION_ICON[a.path_type];
                return (
                  <Link
                    key={a.path_type}
                    to={a.to}
                    onClick={() => handleClick(r, a)}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm text-foreground transition hover:border-primary/40 hover:bg-accent/30"
                    data-rec-action={a.path_type}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{a.label}</span>
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {a.est_minutes} min
                      <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
                    </span>
                  </Link>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
