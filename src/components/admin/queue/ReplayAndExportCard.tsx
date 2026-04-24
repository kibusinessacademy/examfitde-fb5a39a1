/**
 * ReplayAndExportCard
 * ───────────────────
 * - Replay-Button: ruft fn_replay_recent_reschedules(5min) auf, zeigt Counts.
 * - Audit-Export: lädt v_pending_enqueue_audit_export und exportiert CSV/JSON.
 */
import { useState } from "react";
import { Download, FileJson, History, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  fetchAuditExport, replayRecentReschedules, rowsToCsv, downloadFile,
  type ReplayResult,
} from "@/lib/admin/queue/pendingEnqueueApi";
import { toast } from "@/hooks/use-toast";

export function ReplayAndExportCard() {
  const [replayBusy, setReplayBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [lastResult, setLastResult] = useState<ReplayResult | null>(null);

  const runReplay = async () => {
    setReplayBusy(true);
    try {
      const res = await replayRecentReschedules(5, 100);
      setLastResult(res);
      if (res.ok) {
        toast({
          title: "Replay abgeschlossen",
          description: `${res.rescheduled ?? 0} reschedult · ${res.skipped_active ?? 0} aktiv · ${res.skipped_not_building ?? 0} nicht building`,
        });
      } else {
        toast({ title: "Replay fehlgeschlagen", description: res.error ?? "unbekannt", variant: "destructive" });
      }
    } finally {
      setReplayBusy(false);
    }
  };

  const exportData = async (format: "csv" | "json") => {
    setExportBusy(true);
    try {
      const rows = await fetchAuditExport(5000);
      if (rows.length === 0) {
        toast({ title: "Keine Daten zum Export" });
        return;
      }
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      if (format === "csv") {
        downloadFile(`pending-enqueue-audit-${ts}.csv`, rowsToCsv(rows), "text/csv");
      } else {
        downloadFile(`pending-enqueue-audit-${ts}.json`,
          JSON.stringify(rows, null, 2), "application/json");
      }
      toast({ title: `Export ok`, description: `${rows.length} Einträge` });
    } catch (e) {
      toast({ title: "Export fehlgeschlagen", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operator-Tools</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Idempotenter Replay der letzten Reschedules · Audit-Export
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={runReplay} disabled={replayBusy}>
            {replayBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <History className="h-4 w-4 mr-2" />}
            Replay letzte 5 min
          </Button>
          <Button variant="outline" onClick={() => exportData("csv")} disabled={exportBusy}>
            <Download className="h-4 w-4 mr-2" /> Audit CSV
          </Button>
          <Button variant="outline" onClick={() => exportData("json")} disabled={exportBusy}>
            <FileJson className="h-4 w-4 mr-2" /> Audit JSON
          </Button>
        </div>

        {lastResult && (
          <div className="p-3 border rounded-md bg-muted/50 text-sm space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={lastResult.ok ? "default" : "destructive"}>
                {lastResult.ok ? "ok" : "failed"}
              </Badge>
              {lastResult.replay_marker && (
                <code className="text-xs text-muted-foreground">{lastResult.replay_marker}</code>
              )}
              {lastResult.ran_at && (
                <span className="text-xs text-muted-foreground">
                  {new Date(lastResult.ran_at).toLocaleTimeString()}
                </span>
              )}
            </div>
            {lastResult.ok && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Stat label="Window" value={`${lastResult.window_minutes}min`} />
                <Stat label="Kandidaten" value={lastResult.candidates_in_window ?? 0} />
                <Stat label="Reschedult" value={lastResult.rescheduled ?? 0} tone="ok" />
                <Stat label="Skip aktiv" value={lastResult.skipped_active ?? 0} tone="warn" />
              </div>
            )}
            {!lastResult.ok && lastResult.error && (
              <div className="text-xs text-destructive">{lastResult.error}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "warn" }) {
  const cls = tone === "ok" ? "text-emerald-600 dark:text-emerald-400"
            : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "";
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className={`font-mono font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
