import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, ShieldAlert, RotateCcw } from "lucide-react";
import {
  type AnswerValue,
  type RiskCheckDoc,
  evaluateRisk,
} from "@/lib/authority/risk-checks";

const LEVEL_BADGE: Record<"green" | "amber" | "red", { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  green: { label: "Risiko gering", cls: "status-bg-subtle-success text-foreground", Icon: CheckCircle2 },
  amber: { label: "Risiko erhöht", cls: "status-bg-subtle-warning text-foreground", Icon: AlertCircle },
  red: { label: "Hohes Risiko", cls: "status-bg-subtle-error text-foreground", Icon: ShieldAlert },
};

export function RiskCheckRunner({ check }: { check: RiskCheckDoc }) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitted, setSubmitted] = useState(false);
  const allAnswered = check.questions.every((q) => answers[q.id]);
  const result = useMemo(() => (submitted ? evaluateRisk(check, answers) : null), [check, answers, submitted]);

  const reset = () => {
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        {!submitted && (
          <>
            <ol className="space-y-4">
              {check.questions.map((q, i) => (
                <li key={q.id} className="space-y-2">
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-mono text-muted-foreground">{i + 1}.</span>
                    <div className="flex-1">
                      <div className="font-medium leading-snug">{q.label}</div>
                      {q.hint && <div className="text-xs text-muted-foreground mt-1">{q.hint}</div>}
                    </div>
                  </div>
                  <div className="flex gap-2 pl-7">
                    {(["yes", "no", "unknown"] as AnswerValue[]).map((val) => (
                      <Button
                        key={val}
                        size="sm"
                        variant={answers[q.id] === val ? "default" : "outline"}
                        onClick={() => setAnswers((p) => ({ ...p, [q.id]: val }))}
                      >
                        {val === "yes" ? "Ja" : val === "no" ? "Nein" : "Unklar"}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            <div className="pt-2">
              <Button onClick={() => setSubmitted(true)} disabled={!allAnswered} size="lg">
                Risiko bewerten
              </Button>
            </div>
          </>
        )}

        {submitted && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge className={LEVEL_BADGE[result.level].cls}>
                {(() => {
                  const I = LEVEL_BADGE[result.level].Icon;
                  return <I className="h-3.5 w-3.5 mr-1" />;
                })()}
                {LEVEL_BADGE[result.level].label}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Score: {result.score} / {result.maxScore}
              </span>
            </div>
            <div className="rounded-md border bg-muted/30 p-4 leading-relaxed">{result.recommendation}</div>
            <div className="text-xs text-muted-foreground">
              Hinweis: Dieser Check ersetzt keine Rechtsberatung. Rechtsgrundlage: {check.source}.
            </div>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4 mr-2" /> Neu starten
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
