/**
 * P-Completion 3 — AdaptiveExamPlanCard.
 *
 * Reines Anzeige-Element. Macht den AdaptiveExamPlan auf der Pre-Exam-Surface
 * transparent: Kompetenz-Verteilung (Drift), Re-Test-Block, Konformität.
 * Schreibt nichts. Triggert nichts.
 */
import type { AdaptiveExamPlan } from "@/lib/exam/types";
import { Sparkles, Target, RefreshCw, Shield } from "lucide-react";

export interface AdaptiveExamPlanCardProps {
  plan: AdaptiveExamPlan;
  className?: string;
}

const KIND_LABEL: Record<string, string> = {
  blueprint_core: "Blueprint-Kern",
  weakness_focus: "Schwächefokus",
  retest: "Re-Test",
  stability_anchor: "Stabilitätsanker",
};

export function AdaptiveExamPlanCard({ plan, className = "" }: AdaptiveExamPlanCardProps) {
  if (plan.slots.length === 0) return null;

  const conformityPct = Math.round(plan.blueprint_conformity * 100);
  const driftCount = plan.competency_distribution.filter((d) => Math.abs(d.delta) > 0.005).length;

  return (
    <section
      className={`rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur ${className}`}
      aria-label="Adaptive Prüfungsplanung"
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-card/70 text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
            Adaptive Prüfungsplanung
          </div>
          <div className="text-sm font-semibold text-foreground">
            {plan.slots.length} Aufgaben · Konformität {conformityPct}%
          </div>
        </div>
        {plan.retest_block_size > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary">
            <RefreshCw className="h-3 w-3" aria-hidden />
            {plan.retest_block_size}× Re-Test
          </span>
        )}
      </header>

      <p className="text-xs text-muted-foreground">{plan.rationale}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded-lg border border-border/40 bg-background/40 p-2">
          <div className="uppercase tracking-wider text-muted-foreground">Easy</div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">
            {plan.difficulty_distribution.easy}
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/40 p-2">
          <div className="uppercase tracking-wider text-muted-foreground">Medium</div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">
            {plan.difficulty_distribution.medium}
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/40 p-2">
          <div className="uppercase tracking-wider text-muted-foreground">Hard</div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">
            {plan.difficulty_distribution.hard}
          </div>
        </div>
      </div>

      {driftCount > 0 && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Target className="h-3 w-3" aria-hidden /> Verschiebungen
          </div>
          {plan.competency_distribution
            .filter((d) => Math.abs(d.delta) > 0.005)
            .slice(0, 4)
            .map((d) => {
              const up = d.delta > 0;
              return (
                <div
                  key={d.competency_id}
                  className="flex items-center justify-between rounded-md border border-border/40 bg-background/30 px-2 py-1 text-xs"
                >
                  <span className="truncate text-foreground/90">{d.competency_key}</span>
                  <span
                    className={
                      up
                        ? "font-medium text-primary"
                        : "font-medium text-muted-foreground"
                    }
                  >
                    {up ? "+" : ""}
                    {(d.delta * 100).toFixed(0)}% · {d.slot_count}×
                  </span>
                </div>
              );
            })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Shield className="h-3 w-3" aria-hidden />
        Blueprint-konform · keine freien Fragen · SSOT-gebunden
      </div>

      <div className="mt-3 grid grid-cols-6 gap-1" aria-hidden>
        {plan.slots.map((s) => (
          <div
            key={s.position}
            title={`${s.position}. ${s.competency_key} · ${s.difficulty} · ${KIND_LABEL[s.kind] ?? s.kind}`}
            className={`h-1.5 rounded-full ${
              s.kind === "retest"
                ? "bg-primary"
                : s.kind === "weakness_focus"
                ? "bg-destructive/60"
                : s.kind === "stability_anchor"
                ? "bg-emerald-400/60"
                : "bg-border"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
