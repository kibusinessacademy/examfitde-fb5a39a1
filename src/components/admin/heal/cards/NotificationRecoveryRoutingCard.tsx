import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Play, Route } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type AuditRow = {
  id: number; source_job_id: string; intent_key: string;
  from_state: string; to_action: string; reason: string | null; created_at: string;
};

export default function NotificationRecoveryRoutingCard() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).rpc("admin_get_recovery_audit", {
      p_window_hours: 168, p_limit: 100,
    });
    setRows((data as AuditRow[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const run = async (dryRun: boolean) => {
    setRunning(true);
    const { data, error } = await (supabase as any).rpc("admin_run_notification_recovery_routing", { p_dry_run: dryRun });
    setRunning(false);
    if (error) { toast.error(error.message); return; }
    const summary = (data as any[] ?? []).map((r) => `${r.action}: ${r.jobs_routed}`).join(" · ");
    toast.success(`${dryRun ? "Dry-run" : "Routing"} OK · ${summary}`);
    if (!dryRun) load();
  };

  const counts: Record<string, number> = {};
  rows.forEach((r) => { counts[r.to_action] = (counts[r.to_action] ?? 0) + 1; });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Route className="h-4 w-4" /> Recovery Routing · 7 Tage
        </CardTitle>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => run(true)} disabled={running}>Dry-run</Button>
          <Button variant="default" size="sm" onClick={() => run(false)} disabled={running}>
            <Play className="h-3 w-3 mr-1" /> Routen
          </Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex flex-wrap gap-1">
          {Object.keys(counts).length === 0 ? (
            <span className="text-muted-foreground">Keine Recovery-Aktionen im Fenster.</span>
          ) : Object.entries(counts).map(([k, v]) => (
            <Badge key={k} variant="secondary" className="text-[10px]">{k}: {v}</Badge>
          ))}
        </div>
        <div className="pt-2 border-t max-h-64 overflow-auto space-y-1">
          {rows.slice(0, 25).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 border-b py-1">
              <span className="truncate">
                <span className="font-medium">{r.intent_key}</span>
                <span className="text-muted-foreground"> · {r.from_state} → {r.to_action}</span>
              </span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {new Date(r.created_at).toLocaleString("de-DE")}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
