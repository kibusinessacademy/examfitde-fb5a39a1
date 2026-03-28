import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

type ReadinessData = {
  readiness_score: number;
  risk_level: "low" | "medium" | "high";
  mastery_pct: number;
  last_sim_score: number | null;
  mastered: number;
  partial: number;
  weak: number;
  total: number;
};

interface ReadinessCardProps {
  readiness: ReadinessData | null;
  isLoading?: boolean;
  className?: string;
}

const riskConfig = {
  low: {
    label: "Prüfungsreif",
    icon: ShieldCheck,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    progressColor: "[&>div]:bg-emerald-500",
  },
  medium: {
    label: "Fast prüfungsreif",
    icon: Shield,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    progressColor: "[&>div]:bg-amber-500",
  },
  high: {
    label: "Erhöhter Trainingsbedarf",
    icon: ShieldAlert,
    color: "text-rose-500",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/20",
    progressColor: "[&>div]:bg-rose-500",
  },
};

export function ReadinessCard({ readiness, isLoading, className }: ReadinessCardProps) {
  if (isLoading) {
    return (
      <Card className={cn("border-border", className)}>
        <CardContent className="p-6">
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (!readiness) {
    return (
      <Card className={cn("border-border", className)}>
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Noch keine Mastery-Daten vorhanden. Absolviere Lektionen, um deine Prüfungsreife zu sehen.
          </p>
        </CardContent>
      </Card>
    );
  }

  const config = riskConfig[readiness.risk_level];
  const StatusIcon = config.icon;

  return (
    <Card className={cn("border-border", config.borderColor, className)}>
      <CardHeader className={cn("pb-3", config.bgColor)}>
        <CardTitle className="flex items-center gap-2 text-base font-display">
          <StatusIcon className={cn("h-5 w-5", config.color)} />
          Prüfungsreife
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {/* Main score */}
        <div className="flex items-end justify-between">
          <div>
            <div className="text-4xl font-display font-bold">
              {Math.round(readiness.readiness_score)}%
            </div>
            <div className={cn("text-sm font-medium mt-0.5", config.color)}>
              {config.label}
            </div>
          </div>
          <div className="text-right text-sm text-muted-foreground space-y-0.5">
            <div>Mastery: {Math.round(readiness.mastery_pct)}%</div>
            <div>
              Letzte Sim:{" "}
              {readiness.last_sim_score != null
                ? `${Math.round(readiness.last_sim_score)}%`
                : "–"}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <Progress
          value={readiness.readiness_score}
          className={cn("h-2", config.progressColor)}
        />

        {/* Competency stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Mastered", value: readiness.mastered, color: "text-emerald-500" },
            { label: "Partial", value: readiness.partial, color: "text-amber-500" },
            { label: "Schwach", value: readiness.weak, color: "text-rose-500" },
            { label: "Gesamt", value: readiness.total, color: "text-foreground" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border p-2.5 text-center"
            >
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className={cn("text-lg font-semibold", stat.color)}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
