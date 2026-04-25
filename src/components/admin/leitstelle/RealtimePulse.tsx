/**
 * RealtimePulse + PredictiveAlerts
 * ────────────────────────────────
 * Live-Stream von Job-Status-Wechseln via Supabase Realtime + heuristische
 * Predictive Alerts (z.B. "Paket X läuft gleich in EXAM_POOL_DEFICIT").
 *
 * Realtime-Source: postgres_changes auf job_queue (status-Wechsel).
 * Predictive: errechnet aus aktueller Queue-Snapshot + historischen Patterns
 * im Frontend (kein Backend-Call → keine zusätzliche Latenz).
 */
import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAdminQueueSSOT } from "@/hooks/useAdminQueueSSOT";
import { useAdminPackagesSSOT } from "@/hooks/useAdminPackagesSSOT";
import { Activity, AlertTriangle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

interface PulseEvent {
  ts: number;
  jobId: string;
  type: string;
  oldStatus: string | null;
  newStatus: string;
  packageId?: string | null;
}

const MAX_EVENTS = 25;

export function RealtimePulse() {
  const [events, setEvents] = useState<PulseEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const { data: jobs } = useAdminQueueSSOT();
  const { data: packages } = useAdminPackagesSSOT();

  useEffect(() => {
    const channel = supabase
      .channel("admin-queue-pulse")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "job_queue" },
        (payload) => {
          const oldRow = payload.old as Record<string, any> | undefined;
          const newRow = payload.new as Record<string, any>;
          if (!newRow?.id) return;
          if (oldRow?.status === newRow.status) return; // nur echte Status-Wechsel

          setEvents((prev) =>
            [
              {
                ts: Date.now(),
                jobId: newRow.id,
                type: newRow.job_type || "unknown",
                oldStatus: oldRow?.status ?? null,
                newStatus: newRow.status,
                packageId: newRow.package_id ?? null,
              },
              ...prev,
            ].slice(0, MAX_EVENTS),
          );
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Predictive: Pakete die "demnächst" stallen werden (heuristisch)
  const predictive = useMemo(() => {
    if (!jobs || !packages) return [];
    const out: Array<{ pkgId: string; title: string; reason: string }> = [];

    // Pattern A: Job hat 2+ transient retries und nähert sich max_attempts
    jobs
      .filter(
        (j) =>
          j.job_status === "pending" &&
          j.attempts >= Math.max(1, Math.floor((j.max_attempts ?? 3) * 0.66)) &&
          j.attempts < (j.max_attempts ?? 3),
      )
      .forEach((j) => {
        if (!j.package_id) return;
        out.push({
          pkgId: j.package_id,
          title: j.package_title || j.package_id.slice(0, 8),
          reason: `${j.job_type.replace(/^package_/, "")} bei ${j.attempts}/${j.max_attempts} — Eskalation wahrscheinlich`,
        });
      });

    // Pattern B: Pakete > 4h building ohne Council
    const now = Date.now();
    packages
      .filter(
        (p) =>
          p.status === "building" &&
          !p.council_complete &&
          p.updated_at &&
          now - new Date(p.updated_at).getTime() > 4 * 60 * 60 * 1000,
      )
      .forEach((p) => {
        out.push({
          pkgId: p.package_id,
          title: p.canonical_title || p.raw_title || p.package_id.slice(0, 8),
          reason: `> 4h building ohne Council-Fortschritt — könnte stallen`,
        });
      });

    // Dedup nach pkgId
    const seen = new Set<string>();
    return out.filter((o) => {
      if (seen.has(o.pkgId)) return false;
      seen.add(o.pkgId);
      return true;
    }).slice(0, 4);
  }, [jobs, packages]);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* ─── Realtime Pulse ─── */}
      <Card className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Realtime-Pulse</h2>
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] h-4 px-1.5",
                connected
                  ? "bg-success/10 text-success border-success/30"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {connected ? "● live" : "○ verbinden..."}
            </Badge>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {events.length} Events
          </span>
        </div>

        {events.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            Warte auf Job-Status-Wechsel…
          </div>
        ) : (
          <ScrollArea className="h-[200px]">
            <div className="space-y-1 pr-2">
              {events.map((e, i) => (
                <div
                  key={`${e.jobId}-${e.ts}-${i}`}
                  className="text-xs flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/40"
                >
                  <span className="text-muted-foreground font-mono text-[10px] shrink-0">
                    {new Date(e.ts).toLocaleTimeString("de-DE", {
                      hour12: false,
                    })}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {e.jobId.slice(0, 8)}
                  </span>
                  <span className="truncate flex-1">
                    {e.type.replace(/^package_/, "")}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] h-4 px-1.5 shrink-0",
                      e.newStatus === "completed" &&
                        "bg-success/10 text-success border-success/30",
                      e.newStatus === "failed" &&
                        "bg-destructive/10 text-destructive border-destructive/30",
                      e.newStatus === "processing" &&
                        "bg-primary/10 text-primary border-primary/30",
                    )}
                  >
                    {e.oldStatus ? `${e.oldStatus}→` : ""}
                    {e.newStatus}
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </Card>

      {/* ─── Predictive Alerts ─── */}
      <Card className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-warning" />
          <h2 className="text-sm font-semibold text-foreground">Predictive Alerts</h2>
          <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-mono">
            heuristisch
          </Badge>
        </div>

        {predictive.length === 0 ? (
          <div className="text-xs text-success/80 py-4 text-center">
            ✓ Keine Stall-Risiken erkannt
          </div>
        ) : (
          <div className="space-y-1.5">
            {predictive.map((p) => (
              <Link
                key={p.pkgId}
                to={`/admin/studio/${p.pkgId}`}
                className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 p-2 hover:bg-warning/10 transition-colors"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground truncate">
                    {p.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-tight">
                    {p.reason}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
