/**
 * Berufs-KI Outcome Card (BK-Act-3).
 *
 * Macht das deterministisch berechnete WorkflowOutcome sichtbar:
 * Score · Confidence · Zeitersparnis · Risiko↓ · Kompetenz↑ · Next Action.
 */
import { Link } from "react-router-dom";
import { Sparkles, Clock, ShieldCheck, TrendingUp, ArrowRight, Gauge } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { outcomeTypeLabel } from "@/lib/berufs-ki/outcomes";
import { useWorkflowOutcome } from "@/hooks/useWorkflowOutcome";

interface Props {
  runId: string;
}

export function WorkflowOutcomeCard({ runId }: Props) {
  const { data, isLoading } = useWorkflowOutcome(runId);

  if (isLoading && !data) {
    return (
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Ergebniswirkung wird berechnet…
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const score = Math.round(data.outcome_score);
  const confPct = Math.round(data.confidence * 100);
  const hasRisk = data.risk_reduction_pct != null && data.risk_reduction_pct > 0;
  const hasComp = data.competency_impact_pct != null && data.competency_impact_pct > 0;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Ergebniswirkung</span>
          <Badge variant="secondary" className="text-[10px]">{outcomeTypeLabel(data.outcome_type)}</Badge>
          <Badge variant="outline" className="ml-auto text-[10px]">Confidence {confPct}%</Badge>
        </div>

        {data.learner_impact_label && (
          <p className="text-sm font-medium leading-snug">{data.learner_impact_label}</p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric icon={<Gauge className="h-4 w-4" />} value={`${score}/100`} label="Outcome-Score" highlight />
          <Metric
            icon={<Clock className="h-4 w-4" />}
            value={`${data.estimated_time_saved_min} Min`}
            label="Zeitersparnis"
          />
          {hasRisk && (
            <Metric
              icon={<ShieldCheck className="h-4 w-4" />}
              value={`-${data.risk_reduction_pct!.toFixed(0)} pp`}
              label="Risiko reduziert"
            />
          )}
          {hasComp && (
            <Metric
              icon={<TrendingUp className="h-4 w-4" />}
              value={`+${data.competency_impact_pct!.toFixed(0)} pp`}
              label="Kompetenz gestärkt"
            />
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Ergebnisqualität</span>
            <span>{score}%</span>
          </div>
          <Progress value={score} className="h-1.5" aria-label="Outcome-Score" />
        </div>

        {data.business_impact_label && (
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
            <span className="font-medium">Betriebliche Wirkung:</span> {data.business_impact_label}
          </div>
        )}

        {data.recommended_next_action_label && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div className="text-xs">
              <div className="font-semibold text-foreground">Empfohlener nächster Schritt</div>
              <div className="text-muted-foreground">{data.recommended_next_action_label}</div>
            </div>
            {data.recommended_next_action_target ? (
              <Button asChild size="sm">
                <Link to={data.recommended_next_action_target}>
                  Öffnen <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  icon,
  value,
  label,
  highlight,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-primary/40 bg-primary/5" : "bg-card"}`}>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <div className={`mt-1 text-sm font-semibold ${highlight ? "text-primary" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
