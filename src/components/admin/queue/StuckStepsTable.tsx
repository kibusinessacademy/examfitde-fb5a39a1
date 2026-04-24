/**
 * StuckStepsTable
 * ───────────────
 * Aktuell stuck pending_enqueue Steps + letztes Reschedule-Log.
 * Read-only — Heilung läuft via Cron, nicht manuell.
 */
import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchStuckSteps, fetchRescheduleLog,
  type StuckStepRow, type RescheduleLogRow,
} from "@/lib/admin/queue/pendingEnqueueApi";
import { toast } from "@/hooks/use-toast";

function fmtAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function StuckStepsTable() {
  const [stuck, setStuck] = useState<StuckStepRow[]>([]);
  const [log, setLog] = useState<RescheduleLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([fetchStuckSteps(), fetchRescheduleLog(30)]);
      setStuck(s);
      setLog(l);
    } catch (e) {
      toast({ title: "Fehler", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Stuck Pending-Enqueue Steps</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Aktuell {stuck.length} Steps · Auto-Refresh 60s
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {stuck.length === 0 ? (
            <p className="text-sm text-muted-foreground">✅ Keine stuck Steps.</p>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-auto">
              {stuck.map((s) => (
                <div key={`${s.package_id}-${s.step_key}`} className="p-2 border rounded text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-medium truncate">{s.step_key}</code>
                    <Badge variant={s.age_seconds > 1800 ? "destructive" : "secondary"}>
                      {fmtAge(s.age_seconds)}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground mt-0.5 truncate">
                    {s.package_title ?? s.package_id}{" "}
                    {s.package_status && <span className="ml-1">· pkg: {s.package_status}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reschedule-Log (letzte 30)</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Heal-Aktivität von fn_reschedule_pending_enqueue_steps
          </p>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Kein Log vorhanden.</p>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-auto">
              {log.map((l) => {
                const isOk = l.reason === "reschedule_to_queued";
                const isFail = l.reason?.startsWith("reschedule_failed");
                return (
                  <div key={l.id} className="p-2 border rounded text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={isOk ? "default" : isFail ? "destructive" : "secondary"}>
                        {l.reason}
                      </Badge>
                      <span className="text-muted-foreground">
                        {new Date(l.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 truncate">
                      <code>{l.step_key}</code> · {l.triggered_by}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
