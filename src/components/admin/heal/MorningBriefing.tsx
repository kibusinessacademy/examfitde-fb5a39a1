import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMorningBriefing } from "./hooks";
import {
  AlertTriangle,
  CheckCircle2,
  Hammer,
  Rocket,
  ShieldAlert,
  Activity,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Tile {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: "default" | "warn" | "critical" | "ok" | "info";
  hint?: string;
}

const TONE_CLASS: Record<Tile["tone"], string> = {
  default: "text-foreground",
  warn: "text-amber-500",
  critical: "text-destructive",
  ok: "text-emerald-500",
  info: "text-primary",
};

export function MorningBriefing() {
  const { data, isLoading, error } = useMorningBriefing();

  if (isLoading) {
    return (
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-4 text-sm text-destructive">
          Briefing nicht verfügbar
        </CardContent>
      </Card>
    );
  }

  const tiles: Tile[] = [
    {
      label: "Neu blockiert (24h)",
      value: data.newly_blocked_count,
      icon: ShieldAlert,
      tone: data.newly_blocked_count > 0 ? "warn" : "ok",
    },
    {
      label: "Neu published (24h)",
      value: data.newly_published_count,
      icon: Rocket,
      tone: "ok",
    },
    {
      label: "Repairs completed (24h)",
      value: data.completed_repairs_24h,
      icon: Hammer,
      tone: "info",
      hint: "Operativer Proxy, nicht semantisch geheilt",
    },
    {
      label: "Failed Jobs (24h)",
      value: data.failed_jobs_24h,
      icon: AlertTriangle,
      tone: data.failed_jobs_24h > 10 ? "critical" : "warn",
    },
    {
      label: "Quality-No-Progress",
      value: data.quality_no_progress_blocks,
      icon: ShieldAlert,
      tone: data.quality_no_progress_blocks > 0 ? "warn" : "ok",
    },
    {
      label: "Kritische Aktionen",
      value: data.critical_actions_pending,
      icon: Sparkles,
      tone: data.critical_actions_pending > 0 ? "critical" : "ok",
    },
    {
      label: "Publish-Ready",
      value: data.publish_ready_count,
      icon: CheckCircle2,
      tone: "ok",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Card key={t.label} className="overflow-hidden">
              <CardHeader className="p-3 pb-1">
                <CardTitle className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span className="truncate">{t.label}</span>
                  <Icon className={`h-4 w-4 shrink-0 ${TONE_CLASS[t.tone]}`} />
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className={`text-2xl font-semibold ${TONE_CLASS[t.tone]}`}>
                  {t.value}
                </div>
                {t.hint && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {t.hint}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        <span>
          WIP aktiv: <strong className="text-foreground">{data.wip_active}</strong>
          {" — "}
          WIP-Kapazität:{" "}
          <span className="italic">
            {data.wip_capacity ?? "n/a (keine SSOT-Quelle)"}
          </span>
        </span>
      </div>
    </div>
  );
}
