import { Target, AlertTriangle, TrendingUp, Compass } from "lucide-react";

interface Props {
  /** Readiness score 0..100 (read-only — caller passes from examiner). */
  readinessScore?: number;
  /** Risk label (low|medium|high). */
  riskLevel?: "low" | "medium" | "high";
  /** Top weak competency label. */
  weakestCompetency?: string;
  /** Trend hint ("steigend" | "fallend" | "stabil"). */
  trend?: "steigend" | "fallend" | "stabil";
  /** Next best action label. */
  nextAction?: string;
  className?: string;
}

const RISK_LABEL: Record<NonNullable<Props["riskLevel"]>, string> = {
  low: "Geringes Risiko",
  medium: "Mittleres Risiko",
  high: "Erhöhtes Risiko",
};

/**
 * Premium Confidence UX — fünf Antworten auf einen Blick:
 *  Wo stehe ich? · Wie gefährdet? · Größtes Risiko? · Was bringt am meisten? · Trend?
 *
 * Pure presentation — values stammen von Caller (Examiner-Handover-Contract).
 */
export function ConfidenceStatusStrip({
  readinessScore,
  riskLevel,
  weakestCompetency,
  trend = "stabil",
  nextAction,
  className,
}: Props) {
  return (
    <section
      className={
        "grid grid-cols-2 gap-3 rounded-2xl border border-border bg-surface-subtle p-4 sm:grid-cols-4 " +
        (className ?? "")
      }
      aria-label="Prüfungsreife auf einen Blick"
      data-confidence-strip
    >
      <div className="flex items-start gap-2">
        <Target className="mt-0.5 h-4 w-4 text-petrol-600" aria-hidden />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Prüfungsreife
          </p>
          <p className="text-base font-bold tabular-nums text-foreground">
            {readinessScore != null ? `${Math.round(readinessScore)} / 100` : "—"}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <AlertTriangle
          className={
            "mt-0.5 h-4 w-4 " +
            (riskLevel === "high"
              ? "text-rose-500"
              : riskLevel === "medium"
                ? "text-amber-500"
                : "text-mint-600")
          }
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Risiko
          </p>
          <p className="truncate text-sm font-medium text-foreground">
            {riskLevel ? RISK_LABEL[riskLevel] : "—"}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <Compass className="mt-0.5 h-4 w-4 text-petrol-600" aria-hidden />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Größte Lücke
          </p>
          <p className="truncate text-sm font-medium text-foreground">
            {weakestCompetency ?? "—"}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <TrendingUp className="mt-0.5 h-4 w-4 text-mint-600" aria-hidden />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Trend
          </p>
          <p className="truncate text-sm font-medium text-foreground">
            {nextAction ?? trend}
          </p>
        </div>
      </div>
    </section>
  );
}
