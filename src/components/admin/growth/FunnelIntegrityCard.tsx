/**
 * FunnelIntegrityCard — Tiered Funnel-Tracking-Guard.
 *
 * Drei Sub-Ampeln aus v_funnel_integrity_check:
 *  1) Tracking-Completeness — % strict events (quiz/lead/checkout) mit package_id
 *  2) Funnel-Continuity     — alle Pflicht-Events vorhanden + Drop-Raten plausibel
 *  3) Attribution-Quality   — % mit persona/source_page
 *
 * Zeitfenster: letzte 7 Tage.
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, AlertCircle, RefreshCw, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type Status = "green" | "yellow" | "red";

type FunnelRow = {
  strict_events_total: number;
  strict_events_with_pkg: number;
  tracking_completeness_pct: number;
  tracking_completeness_status: Status;
  s1_lead_magnet: number;
  s2_quiz_started: number;
  s3_quiz_completed: number;
  s4_lead_capture: number;
  s5_checkout: number;
  funnel_continuity_status: Status;
  with_persona_total: number;
  with_source_total: number;
  persona_coverage_pct: number;
  source_coverage_pct: number;
  attribution_quality_status: Status;
  events_total_7d: number;
  status: Status;
  checked_at: string;
};

async function fetchFunnelIntegrity(): Promise<FunnelRow | null> {
  const { data, error } = await supabase
    .from("v_funnel_integrity_check" as never)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as FunnelRow | null) ?? null;
}

const STATUS_STYLES: Record<Status, { Icon: typeof CheckCircle2; label: string; iconClass: string; badgeClass: string }> = {
  green: {
    Icon: CheckCircle2,
    label: "Green",
    iconClass: "text-success",
    badgeClass: "bg-status-success-bg-subtle text-status-success-foreground border-status-success-border",
  },
  yellow: {
    Icon: AlertTriangle,
    label: "Yellow",
    iconClass: "text-warning",
    badgeClass: "bg-status-warning-bg-subtle text-status-warning-foreground border-status-warning-border",
  },
  red: {
    Icon: AlertCircle,
    label: "Red",
    iconClass: "text-destructive",
    badgeClass: "bg-status-danger-subtle text-status-danger-foreground border-status-danger/30",
  },
};

export default function FunnelIntegrityCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["funnel-integrity-check"],
    queryFn: fetchFunnelIntegrity,
    refetchInterval: 5 * 60 * 1000,
  });

  const status = (data?.status ?? "green") as Status;
  const style = STATUS_STYLES[status];
  const StatusIcon = style.Icon;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <StatusIcon className={`h-4 w-4 ${style.iconClass}`} />
            Funnel Integrity (7 Tage)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Conversion-Tracking-Guard für{" "}
            <code className="text-[10px]">lead_magnet_view → checkout_complete</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${style.badgeClass}`}>
            {style.label}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Sub-Ampeln */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <SubAmpel
            label="Tracking-Completeness"
            sub={`${data?.strict_events_with_pkg ?? "–"}/${data?.strict_events_total ?? "–"} mit package_id`}
            pct={data?.tracking_completeness_pct ?? null}
            status={data?.tracking_completeness_status ?? "green"}
            loading={isLoading}
          />
          <SubAmpel
            label="Funnel-Continuity"
            sub={`${data?.events_total_7d ?? "–"} Events / 7d`}
            status={data?.funnel_continuity_status ?? "green"}
            loading={isLoading}
          />
          <SubAmpel
            label="Attribution-Quality"
            sub={`Source ${data?.source_coverage_pct ?? "–"}% · Persona ${data?.persona_coverage_pct ?? "–"}%`}
            status={data?.attribution_quality_status ?? "green"}
            loading={isLoading}
          />
        </div>

        {/* Funnel-Stufen */}
        <div className="grid grid-cols-5 gap-1">
          <FunnelStep label="lead_magnet" value={data?.s1_lead_magnet} loading={isLoading} />
          <FunnelStep label="quiz_started" value={data?.s2_quiz_started} loading={isLoading} />
          <FunnelStep label="quiz_complete" value={data?.s3_quiz_completed} loading={isLoading} />
          <FunnelStep label="lead_capture" value={data?.s4_lead_capture} loading={isLoading} />
          <FunnelStep label="checkout" value={data?.s5_checkout} loading={isLoading} />
        </div>

        {data && data.status !== "green" && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted-foreground">
              Drift erkannt — package_id, Pflicht-Events oder Attribution prüfen.
            </p>
            <Button asChild size="sm" variant="outline">
              <a href="/admin/growth?tab=intel" rel="noreferrer">
                <Activity className="h-3 w-3 mr-1" /> Marketing-Intel
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SubAmpel({
  label,
  sub,
  pct,
  status,
  loading,
}: {
  label: string;
  sub: string;
  pct?: number | null;
  status: Status;
  loading?: boolean;
}) {
  const style = STATUS_STYLES[status];
  const Icon = style.Icon;
  return (
    <div className="rounded-md border border-border/60 bg-surface-subtle px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${style.iconClass}`} />
      </div>
      <div className="text-base font-semibold tabular-nums text-foreground mt-0.5">
        {loading ? "…" : pct !== null && pct !== undefined ? `${pct}%` : style.label}
      </div>
      <div className="text-[10px] text-muted-foreground truncate">{sub}</div>
    </div>
  );
}

function FunnelStep({
  label,
  value,
  loading,
}: {
  label: string;
  value?: number;
  loading?: boolean;
}) {
  return (
    <div className="rounded-sm border border-border/40 bg-surface-base px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-foreground">
        {loading ? "…" : value ?? 0}
      </div>
    </div>
  );
}
