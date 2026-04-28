import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTerminology } from "@/hooks/useProgramType";

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
  curriculumId?: string;
}

type RiskTone = {
  label: string;
  icon: typeof ShieldCheck;
  text: string;
  bg: string;
  border: string;
  progress: string;
};

export function ReadinessCard({ readiness, isLoading, className, curriculumId }: ReadinessCardProps) {
  const { t } = useTerminology(curriculumId);

  const riskConfig: Record<"low" | "medium" | "high", RiskTone> = {
    low: {
      label: t("examReadyFull"),
      icon: ShieldCheck,
      text: "text-success",
      bg: "bg-success-bg-subtle",
      border: "border-success-border",
      progress: "[&>div]:bg-success",
    },
    medium: {
      label: t("almostReady"),
      icon: Shield,
      text: "text-warning",
      bg: "bg-warning-bg-subtle",
      border: "border-warning-border",
      progress: "[&>div]:bg-warning",
    },
    high: {
      label: "Erhöhter Trainingsbedarf",
      icon: ShieldAlert,
      text: "text-destructive",
      bg: "bg-destructive-bg-subtle",
      border: "border-destructive-border",
      progress: "[&>div]:bg-destructive",
    },
  };

  if (isLoading) {
    return (
      <Card variant="raised" className={className}>
        <CardContent className="p-6">
          <div className="h-32 animate-pulse rounded-lg bg-surface-sunken" />
        </CardContent>
      </Card>
    );
  }

  if (!readiness) {
    return (
      <Card variant="raised" className={className}>
        <CardContent className="p-6 text-center">
          <p className="text-sm text-text-secondary">{t("noMasteryData")}</p>
        </CardContent>
      </Card>
    );
  }

  const config = riskConfig[readiness.risk_level];
  const StatusIcon = config.icon;

  return (
    <Card variant="raised" className={cn(config.border, className)}>
      <CardHeader className={cn("pb-3 rounded-t-lg", config.bg)}>
        <CardTitle className="flex items-center gap-2 text-base font-display text-text-primary">
          <StatusIcon className={cn("h-5 w-5", config.text)} />
          {t("examReadiness")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-4xl font-display font-bold text-text-primary tabular-nums">
              {Math.round(readiness.readiness_score)}%
            </div>
            <div className={cn("text-sm font-medium mt-0.5", config.text)}>{config.label}</div>
          </div>
          <div className="text-right text-sm text-text-secondary space-y-0.5">
            <div>
              Mastery: <span className="tabular-nums text-text-primary">{Math.round(readiness.mastery_pct)}%</span>
            </div>
            <div>
              Letzte Sim:{" "}
              <span className="tabular-nums text-text-primary">
                {readiness.last_sim_score != null ? `${Math.round(readiness.last_sim_score)}%` : "–"}
              </span>
            </div>
          </div>
        </div>

        <Progress value={readiness.readiness_score} className={cn("h-2", config.progress)} />

        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Mastered", value: readiness.mastered, color: "text-success" },
            { label: "Partial", value: readiness.partial, color: "text-warning" },
            { label: "Schwach", value: readiness.weak, color: "text-destructive" },
            { label: "Gesamt", value: readiness.total, color: "text-text-primary" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border-subtle bg-surface-sunken p-2.5 text-center"
            >
              <div className="text-xs text-text-tertiary">{stat.label}</div>
              <div className={cn("text-lg font-semibold tabular-nums", stat.color)}>{stat.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
