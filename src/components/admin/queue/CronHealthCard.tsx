/**
 * CronHealthCard
 * ──────────────
 * Übersicht aller pending_enqueue-bezogenen Cron-Jobs: Schedule, Last-Run,
 * Heal/Skip/Fail-Counts der letzten Stunde, Lag-Status.
 * Read-only — kein Heal-Pfad.
 */
import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchCronHealth, type CronHealthRow, type CronHealth } from "@/lib/admin/queue/pendingEnqueueApi";
import { toast } from "@/hooks/use-toast";

const HEALTH_VARIANT: Record<CronHealth, "default" | "secondary" | "destructive" | "outline"> = {
  healthy: "default",
  lagging: "secondary",
  last_run_failed: "destructive",
  disabled: "outline",
  never_ran: "destructive",
};

const HEALTH_ICON: Record<CronHealth, typeof CheckCircle2> = {
  healthy: CheckCircle2,
  lagging: Clock,
  last_run_failed: XCircle,
  disabled: AlertTriangle,
  never_ran: AlertTriangle,
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function CronHealthCard() {
  const [rows, setRows] = useState<CronHealthRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchCronHealth());
    } catch (e) {
      toast({ title: "Fehler", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Cron Health Monitor</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Pending-Enqueue Heal-Cron-Jobs · Auto-Refresh 30s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Cron-Jobs gefunden.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const Icon = HEALTH_ICON[r.health];
              return (
                <div
                  key={r.jobname}
                  className="flex items-start justify-between gap-4 p-3 rounded-md border bg-card"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="font-mono text-sm font-medium truncate">{r.jobname}</span>
                      <Badge variant={HEALTH_VARIANT[r.health]}>{r.health}</Badge>
                      <code className="text-xs text-muted-foreground">{r.schedule}</code>
                    </div>
                    <div className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      <span>Letzter Lauf: <strong>{formatRelative(r.last_start)} ago</strong></span>
                      <span>Status: <strong>{r.last_status ?? "—"}</strong></span>
                      {r.last_message && (
                        <span className="truncate max-w-md" title={r.last_message}>
                          Msg: {r.last_message}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs space-y-0.5 shrink-0">
                    <div className="text-muted-foreground">Letzte Stunde</div>
                    <div className="text-emerald-600 dark:text-emerald-400">
                      ✓ {r.healed_1h} healed
                    </div>
                    <div className="text-amber-600 dark:text-amber-400">
                      ⊘ {r.skipped_1h} skipped
                    </div>
                    <div className="text-destructive">✗ {r.failed_1h} failed</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
