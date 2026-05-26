import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Check, CircleDashed } from "lucide-react";
import type { DecisionReadiness } from "@/lib/offer-comparison/types";

export function DecisionReadinessCard({ readiness }: { readiness: DecisionReadiness }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Decision Readiness</div>
          <div className="text-2xl font-semibold tabular-nums">{readiness.score}%</div>
        </div>
        <Progress value={readiness.score} className="h-2" />
        <ul className="space-y-1.5 mt-2">
          {readiness.factors.map((f) => (
            <li key={f.key} className="flex items-center gap-2 text-sm">
              {f.done ? (
                <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : (
                <CircleDashed className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className={f.done ? "" : "text-muted-foreground"}>{f.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">{f.weight}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
