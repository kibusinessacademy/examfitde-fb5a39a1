/**
 * NextActionCard — "Was jetzt klicken?"
 *
 * v2: Diagnose statt Heuristik.
 * Nutzt admin_get_queue_claimability_summary, um zwischen
 * stale_processing, dag_blocked, pricing_blocked, schema_drift_blocked,
 * package_not_building, phantom_step_done und claimable zu unterscheiden.
 * Lane-Health liefert nur noch Heartbeat- und Claimable-Signale.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertTriangle, ArrowRight, Compass } from "lucide-react";
import { cn } from "@/lib/utils";

interface LaneRow {
  lane: string;
  pending_cnt: number;
  processing_cnt: number;
  queued_cnt: number;
  last_completed_at: string | null;
  completed_6h: number;
  oldest_pending_sec: number | null;
  dispatched_recent_5m?: number;
  last_worker_activity_at?: string | null;
}

interface ClaimRow {
  lane: string;
  claimability_status: string;
  job_count: number;
  oldest_age_sec: number;
}

type Severity = "ok" | "info" | "warn" | "critical";

interface Recommendation {
  severity: Severity;
  title: string;
  body: string;
  action?: { label: string; targetSelector?: string };
}

function buildRecommendation(lanes: LaneRow[], claim: ClaimRow[]): Recommendation {
  const sum = (status: string) =>
    claim.filter((c) => c.claimability_status === status).reduce((a, c) => a + c.job_count, 0);

  const stale = sum("stale_processing");
  const dagBlocked = sum("dag_blocked");
  const pricingBlocked = sum("pricing_blocked");
  const schemaDrift = sum("schema_drift_blocked");
  const phantom = sum("phantom_step_done");
  const notBuilding = sum("package_not_building");
  const claimable = sum("claimable_by_rpc_filters");

  // Echte Worker-Toten-Diagnose: claimable Jobs vorhanden, aber kein Heartbeat in 5 min
  const stalledLanes = lanes.filter((l) => {
    const recent = l.dispatched_recent_5m ?? 0;
    const claimableInLane = claim
      .filter((c) => c.lane === l.lane && c.claimability_status === "claimable_by_rpc_filters")
      .reduce((a, c) => a + c.job_count, 0);
    return claimableInLane > 0 && recent === 0;
  });

  if (stale > 0) {
    return {
      severity: "critical",
      title: `Stale Locks: ${stale} Jobs >10 min in processing`,
      body: "Echte Zombie-Leases. Reap-Lane freigeben.",
      action: { label: "Zum Reap-Button (oben)", targetSelector: "[data-quick-reap]" },
    };
  }

  if (stalledLanes.length > 0) {
    return {
      severity: "critical",
      title: `Runner-Stillstand: ${stalledLanes.map((l) => l.lane).join(", ")}`,
      body: "Claimable Jobs vorhanden, aber 0 Worker-Heartbeats in 5 min. Edge-Function prüfen.",
      action: { label: "Edge-Function-Logs", targetSelector: '[data-section="ops"]' },
    };
  }

  if (schemaDrift > 0) {
    return {
      severity: "critical",
      title: `Schema-Drift: ${schemaDrift} Jobs blockiert`,
      body: "Fehlende/falsche Spalten in der DB. Healer-Code an Schema angleichen.",
    };
  }

  if (dagBlocked > 0) {
    return {
      severity: "warn",
      title: `DAG-Blocked: ${dagBlocked} Jobs warten auf Parents`,
      body: "Vorgelagerte Steps sind nicht done/skipped. → Heal-Status pro Kurs → Per-Step-Retry.",
      action: { label: 'Zu „Pakete heilen“', targetSelector: '[data-section="packages"]' },
    };
  }

  if (pricingBlocked > 0) {
    return {
      severity: "warn",
      title: `Pricing-Gate: ${pricingBlocked} Auto-Publish blockiert`,
      body: "Pakete brauchen aktive product_prices mit stripe_price_id.",
      action: { label: "Pricing-Backfill", targetSelector: '[data-section="pricing"]' },
    };
  }

  if (notBuilding + phantom > 0) {
    return {
      severity: "info",
      title: `Gap-Sync nötig: ${notBuilding + phantom} Jobs verwaist`,
      body: `${notBuilding} Pakete nicht building, ${phantom} Phantom-Steps. Gap-Sync aufräumen.`,
      action: { label: "Gap-Sync starten", targetSelector: '[data-section="ops"]' },
    };
  }

  if ((claim.find((c) => c.claimability_status === "claimable_by_rpc_filters")?.oldest_age_sec ?? 0) > 3600) {
    return {
      severity: "info",
      title: `Slow drain: ${claimable} claimable, älteste >1h`,
      body: "Worker drainen langsam. Stuck-Patterns Bulk-Promote prüfen.",
      action: { label: "Zu Stuck-Patterns", targetSelector: '[data-section="packages"]' },
    };
  }

  return {
    severity: "ok",
    title: "Pipeline gesund",
    body: "Alle Lanes drainen, keine Aktion nötig. Live-Refresh läuft alle 30s.",
  };
}

const TONE: Record<Severity, { ring: string; text: string; badge: string; label: string; Icon: typeof CheckCircle2 }> = {
  ok:       { ring: "border-primary/40 bg-primary/5",       text: "text-primary",       badge: "bg-primary text-primary-foreground", label: "OK",       Icon: CheckCircle2 },
  info:     { ring: "border-muted-foreground/30 bg-muted/30", text: "text-foreground",  badge: "bg-muted text-foreground",            label: "INFO",     Icon: Compass },
  warn:     { ring: "border-warning/50 bg-warning/5",       text: "text-warning",       badge: "bg-warning text-warning-foreground",  label: "ACTION",   Icon: AlertTriangle },
  critical: { ring: "border-destructive/60 bg-destructive/5", text: "text-destructive", badge: "bg-destructive text-destructive-foreground", label: "URGENT", Icon: AlertTriangle },
};

function scrollTo(selector?: string) {
  if (!selector) return;
  const el = document.querySelector(selector);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    (el as HTMLElement).classList.add("ring-2", "ring-primary");
    setTimeout(() => (el as HTMLElement).classList.remove("ring-2", "ring-primary"), 1800);
  }
}

export function NextActionCard() {
  const lanesQ = useQuery({
    queryKey: ["admin-lane-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_lane_health" as any);
      if (error) throw error;
      return (data ?? []) as LaneRow[];
    },
    refetchInterval: 30_000,
  });
  const claimQ = useQuery({
    queryKey: ["admin-queue-claimability"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_queue_claimability_summary" as any);
      if (error) throw error;
      return (data ?? []) as ClaimRow[];
    },
    refetchInterval: 30_000,
  });
  const hbQ = useQuery({
    queryKey: ["admin-worker-heartbeat"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_worker_heartbeat_summary" as any);
      if (error) throw error;
      return data as { any_alive_5m: boolean; pipeline_alive_5m: number };
    },
    refetchInterval: 30_000,
  });

  if (lanesQ.isLoading || claimQ.isLoading) return <Skeleton className="h-24 w-full" />;
  // Heartbeat-Override: wenn echte Worker leben, NIE „Runner-Stillstand" zeigen
  const workersAlive = hbQ.data?.any_alive_5m ?? true;
  let rec = buildRecommendation(lanesQ.data ?? [], claimQ.data ?? []);
  if (workersAlive && rec.title.startsWith("Runner-Stillstand")) {
    rec = {
      severity: "warn",
      title: "DAG-Backlog: Worker leben, Jobs vom Claim-RPC ausgefiltert",
      body: `${hbQ.data?.pipeline_alive_5m ?? 0} pipeline-runner alive in 5min. Pending Jobs warten auf DAG-Prereqs (Bronze/Manual-Review/Tail-Steps). Stuck-Patterns Bulk-Promote oder Per-Step-Retry prüfen.`,
      action: { label: 'Zu „Pakete heilen"', targetSelector: '[data-section="packages"]' },
    };
  }
  const tone = TONE[rec.severity];

  return (
    <Card className={cn("p-4 border-2", tone.ring)}>
      <div className="flex items-start gap-3">
        <tone.Icon className={cn("h-6 w-6 shrink-0 mt-0.5", tone.text)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge className={cn("text-[10px]", tone.badge)}>{tone.label} · NÄCHSTER SCHRITT</Badge>
            <span className={cn("font-semibold text-sm", tone.text)}>{rec.title}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{rec.body}</p>
          {rec.action && (
            <Button
              size="sm"
              variant={rec.severity === "critical" ? "destructive" : "outline"}
              className="mt-2 h-7 text-xs"
              onClick={() => scrollTo(rec.action?.targetSelector)}
            >
              {rec.action.label} <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
