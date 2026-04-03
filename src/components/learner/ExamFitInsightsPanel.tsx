import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useActiveRecommendations,
  useReadinessSnapshot,
  useTopGaps,
  useReadinessTrend,
} from "@/hooks/useExamfitInsights";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useTerminology } from "@/hooks/useProgramType";

function riskColor(risk?: string | null) {
  switch (risk) {
    case "exam_ready":
      return "text-emerald-500";
    case "on_track":
      return "text-sky-500";
    case "medium_risk":
      return "text-amber-500";
    case "high_risk":
      return "text-rose-500";
    default:
      return "text-muted-foreground";
  }
}

export function ExamFitInsightsPanel({ curriculumId }: { curriculumId: string }) {
  const { data: readiness, isLoading: readinessLoading } = useReadinessSnapshot(curriculumId);
  const { data: gaps, isLoading: gapsLoading } = useTopGaps(curriculumId);
  const { data: recs, isLoading: recsLoading } = useActiveRecommendations(curriculumId);
  const { data: trend } = useReadinessTrend(curriculumId);
  const { t, isAcademic } = useTerminology(curriculumId);

  function riskLabel(risk?: string | null) {
    switch (risk) {
      case "exam_ready":
        return t('examReady');
      case "on_track":
        return "Auf Kurs";
      case "medium_risk":
        return "Mittleres Risiko";
      case "high_risk":
        return "Hohes Risiko";
      default:
        return "Noch keine Daten";
    }
  }

  const trendDelta =
    trend && trend.length >= 2
      ? Math.round(trend[0].readiness_score - trend[1].readiness_score)
      : null;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className="rounded-2xl border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('examReadiness')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {readinessLoading ? (
            <div className="h-12 animate-pulse rounded bg-muted" />
          ) : readiness ? (
            <div className="space-y-1">
              <div className="text-3xl font-bold">
                {Math.round(readiness.readiness_score)}%
              </div>
              <p className={`text-sm font-medium ${riskColor(readiness.risk_level)}`}>
                {riskLabel(readiness.risk_level)}
              </p>
              <p className="text-xs text-muted-foreground">
                Vertrauen: {Math.round(readiness.confidence_score)}%
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Noch keine Readiness-Daten vorhanden.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Größte Lernlücken
          </CardTitle>
        </CardHeader>
        <CardContent>
          {gapsLoading ? (
            <div className="h-12 animate-pulse rounded bg-muted" />
          ) : gaps && gaps.length > 0 ? (
            <div className="space-y-2">
              {gaps.slice(0, 3).map((gap) => (
                <div key={gap.competency_id} className="border-b border-border pb-1.5 last:border-b-0">
                  <div className="text-sm font-medium truncate">{gap.competency_title}</div>
                  <div className="text-xs text-muted-foreground">
                    {gap.learning_field_code} · {Math.round(gap.accuracy_pct)}% Trefferquote
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Keine kritischen Lernlücken erkannt.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Nächste Empfehlung
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recsLoading ? (
            <div className="h-12 animate-pulse rounded bg-muted" />
          ) : recs && recs.length > 0 ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {recs[0].recommendation_type === "exam_sim"
                  ? t('examSimRec')
                  : recs[0].recommendation_type === "review"
                  ? "Wiederholung empfohlen"
                  : (recs[0].target_meta as Record<string, unknown>)?.competency_title as string ||
                    "Empfohlene Lernaktion"}
              </div>
              <p className="text-xs text-muted-foreground">{recs[0].reason_text}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aktuell keine Empfehlung vorhanden.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Letzte Entwicklung
          </CardTitle>
        </CardHeader>
        <CardContent>
          {trendDelta !== null ? (
            <div className="flex items-center gap-2">
              {trendDelta > 0 ? (
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              ) : trendDelta < 0 ? (
                <TrendingDown className="h-5 w-5 text-rose-500" />
              ) : (
                <Minus className="h-5 w-5 text-muted-foreground" />
              )}
              <span className="text-2xl font-bold">
                {trendDelta > 0 ? "+" : ""}
                {trendDelta}%
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Noch nicht genug Snapshots für eine Trendanalyse.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
