import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Health = {
  status: "healthy" | "degraded" | "critical";
  window_minutes: number;
  totals: {
    total: number; sent: number; skipped: number; failed: number; pending: number;
    skipped_pct: number; failed_pct: number; oldest_pending_age_min: number;
  };
  destinations: { total: number; enabled: number };
  skipped_reasons: Record<string, number>;
  failed_reasons: Record<string, number>;
  issues: Array<{ code: string; severity: string; message: string; reasons?: Record<string, number>; oldest_pending_age_min?: number }>;
  checked_at: string;
};

const statusVariant = (s: string) =>
  s === "critical" ? "destructive" : s === "degraded" ? "default" : "secondary";

export function NotificationDeliveryHealthCard() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const { data: res, error } = await supabase.rpc("admin_get_notification_delivery_health", { p_window_minutes: 60 });
    if (error) setErr(error.message); else setData(res as unknown as Health);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Notification Delivery Health</CardTitle>
          <CardDescription>Heal-Alert Outbox · letzte 60 min · skipped/failed/stale_pending</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {data && <Badge variant={statusVariant(data.status)}>{data.status}</Badge>}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {err && <p className="text-sm text-destructive">{err}</p>}
        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <Metric label="Total" value={data.totals.total} />
              <Metric label="Sent" value={data.totals.sent} />
              <Metric label="Skipped" value={`${data.totals.skipped} (${data.totals.skipped_pct}%)`} />
              <Metric label="Failed" value={`${data.totals.failed} (${data.totals.failed_pct}%)`} />
              <Metric label="Pending" value={`${data.totals.pending} · ${data.totals.oldest_pending_age_min}m`} />
            </div>
            <div className="text-xs text-muted-foreground">
              Destinations: {data.destinations.enabled}/{data.destinations.total} enabled · checked {new Date(data.checked_at).toLocaleTimeString()}
            </div>
            {data.issues.length > 0 && (
              <div className="space-y-2">
                {data.issues.map((i, idx) => (
                  <div key={idx} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={i.severity === "critical" ? "destructive" : "default"}>{i.severity}</Badge>
                      <span className="font-medium">{i.code}</span>
                    </div>
                    <p className="text-muted-foreground mt-1">{i.message}</p>
                    {i.reasons && (
                      <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(i.reasons, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
            {data.issues.length === 0 && (
              <p className="text-sm text-muted-foreground">Keine Probleme im Auswertungsfenster.</p>
            )}
            {(Object.keys(data.skipped_reasons || {}).length > 0 || Object.keys(data.failed_reasons || {}).length > 0) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Reason-Aggregation</summary>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <pre className="bg-muted p-2 rounded">skipped: {JSON.stringify(data.skipped_reasons, null, 2)}</pre>
                  <pre className="bg-muted p-2 rounded">failed: {JSON.stringify(data.failed_reasons, null, 2)}</pre>
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
