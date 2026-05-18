import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, AlertTriangle, ShieldCheck } from "lucide-react";
import { planActivationNudge, type ActivationStage } from "@/features/activation/planActivationNudge";

type Assurance = {
  window_hours: number;
  totals_by_stage: Partial<Record<ActivationStage, number>>;
  total_grants: number;
  stale_count: number;
  first_value_count: number;
  first_value_rate_pct: number | null;
  median_minutes_to_first_value: number | null;
  items: Array<{
    grant_id: string;
    package_id: string | null;
    package_key: string | null;
    track: string | null;
    learner_ref: string;
    current_stage: ActivationStage;
    missing_next_step: string;
    blocked_reason: string | null;
    is_stale_activation: boolean;
    minutes_since_grant: number | null;
    minutes_to_first_value: number | null;
    paid_at: string;
  }>;
  generated_at: string;
};

const WINDOWS = [
  { value: 24, label: "24h" },
  { value: 48, label: "48h" },
  { value: 168, label: "7d" },
  { value: 720, label: "30d" },
];

const STAGES: ActivationStage[] = [
  "grant_created",
  "welcome_seen",
  "first_minicheck_started",
  "first_minicheck_completed",
  "aha_completed",
  "lernplan_started",
];

function fmtMins(m: number | null) {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m < 60) return `${Math.round(m)}min`;
  if (m < 1440) return `${(m / 60).toFixed(1)}h`;
  return `${(m / 1440).toFixed(1)}d`;
}

export function ActivationAssuranceCard() {
  const [windowHours, setWindowHours] = useState(48);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "activation-assurance", windowHours],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_activation_assurance" as any,
        { _window_hours: windowHours },
      );
      if (error) throw error;
      return data as unknown as Assurance;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Activation Assurance (Cut 1c)</CardTitle>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Pro Grant: aktuelle Stage, Blocked-Reason, Stale-Detection, First-Value-Rate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
            <TabsList className="h-7">
              {WINDOWS.map((w) => (
                <TabsTrigger key={w.value} value={String(w.value)} className="text-xs h-6 px-2">
                  {w.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-7"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
          </div>
        ) : isError ? (
          <div className="text-sm text-status-error-fg">
            Fehler: {(error as Error)?.message ?? "unknown"}
          </div>
        ) : !data || data.total_grants === 0 ? (
          <div className="rounded-md border border-border bg-surface-muted/40 p-4 text-sm text-text-tertiary">
            Noch keine Grants in diesem Zeitfenster — Telemetrie aktiviert sich ab nächstem Kauf.
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Grants" value={String(data.total_grants)} />
              <Kpi
                label="First-Value-Rate"
                value={data.first_value_rate_pct != null ? `${data.first_value_rate_pct}%` : "—"}
                hint={`${data.first_value_count}/${data.total_grants}`}
              />
              <Kpi
                label="Median TTFV"
                value={fmtMins(data.median_minutes_to_first_value)}
              />
              <Kpi
                label="Stale"
                value={String(data.stale_count)}
                hint={data.stale_count > 0 ? "Drilldown unten" : "alles ok"}
              />
            </div>

            {/* Stage breakdown */}
            <div className="space-y-2 rounded-lg border border-border p-4">
              <div className="text-xs font-medium text-text-secondary">Aktuelle Stage-Verteilung</div>
              <div className="flex flex-wrap gap-2">
                {STAGES.map((s) => {
                  const c = data.totals_by_stage[s] ?? 0;
                  return (
                    <Badge
                      key={s}
                      variant="secondary"
                      className="text-[11px] font-mono"
                    >
                      {s}: {c}
                    </Badge>
                  );
                })}
              </div>
            </div>

            {/* Stale Drilldown */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
                <AlertTriangle className="h-3.5 w-3.5" /> Stale & jüngste Grants (Top 50)
              </div>
              {data.items.length === 0 ? (
                <div className="rounded-md border border-border p-3 text-xs text-text-tertiary">
                  Keine.
                </div>
              ) : (
                <div className="max-h-96 overflow-auto rounded-md border border-border divide-y divide-border">
                  {data.items.map((it) => {
                    const plan = planActivationNudge({
                      current_stage: it.current_stage,
                      missing_next_step: it.missing_next_step,
                      is_stale_activation: it.is_stale_activation,
                      blocked_reason: it.blocked_reason,
                      minutes_since_grant: it.minutes_since_grant ?? undefined,
                    });
                    return (
                      <div
                        key={it.grant_id}
                        className="grid grid-cols-12 gap-2 p-2 text-[11px] items-center"
                      >
                        <div className="col-span-3 font-mono truncate text-text-tertiary">
                          {it.learner_ref}
                        </div>
                        <div className="col-span-2 truncate">
                          {it.package_key ?? it.package_id?.slice(0, 8) ?? "—"}
                        </div>
                        <div className="col-span-2">
                          <Badge
                            variant="outline"
                            className={
                              it.is_stale_activation
                                ? "bg-status-error-bg-subtle text-status-error-fg"
                                : "bg-status-info-bg-subtle text-status-info-fg"
                            }
                          >
                            {it.current_stage}
                          </Badge>
                        </div>
                        <div className="col-span-2 text-text-secondary truncate">
                          {it.blocked_reason ?? "—"}
                        </div>
                        <div className="col-span-2 text-text-tertiary tabular-nums">
                          {fmtMins(it.minutes_since_grant)} seit Kauf
                          {it.minutes_to_first_value != null && (
                            <span className="ml-1 inline-flex items-center gap-1 text-status-success-fg">
                              <ShieldCheck className="h-3 w-3" />
                              {fmtMins(it.minutes_to_first_value)}
                            </span>
                          )}
                        </div>
                        <div className="col-span-1 text-right">
                          <Badge variant="secondary" className="text-[10px]">
                            {plan.nudge_type}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-text-primary">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-text-tertiary">{hint}</div>}
    </div>
  );
}
