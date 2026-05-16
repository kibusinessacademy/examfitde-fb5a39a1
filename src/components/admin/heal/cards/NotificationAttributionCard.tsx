import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Attr = {
  window_hours: number;
  delivered: number; opened: number; reentry: number; session_started: number;
  minicheck_started: number; minicheck_completed: number;
  mastery_delta_events: number; rescue_delivered: number; rescue_recovery: number;
  open_rate_pct: number | null; session_per_open_pct: number | null; rescue_recovery_pct: number | null;
  opened_by_kind: Record<string, number>;
};

export default function NotificationAttributionCard() {
  const [data, setData] = useState<Attr | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: d } = await (supabase as any).rpc("admin_get_notification_attribution", { p_window_hours: 168 });
    setData(d as Attr | null);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" /> Push-Outcome · 7 Tage
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {!data ? <p className="text-muted-foreground">Lädt…</p> : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Delivered" value={data.delivered} />
              <Stat label="Opened" value={data.opened} />
              <Stat label="Sessions" value={data.session_started} />
              <Stat label="MC start" value={data.minicheck_started} />
              <Stat label="MC done" value={data.minicheck_completed} />
              <Stat label="Mastery+" value={data.mastery_delta_events} />
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <Badge variant="outline">Open-Rate: {data.open_rate_pct ?? "—"}%</Badge>
              <Badge variant="outline">Session/Open: {data.session_per_open_pct ?? "—"}%</Badge>
              <Badge variant="outline">
                Rescue→Recovery: {data.rescue_recovery}/{data.rescue_delivered}
                {data.rescue_recovery_pct != null ? ` (${data.rescue_recovery_pct}%)` : ""}
              </Badge>
            </div>
            {Object.keys(data.opened_by_kind || {}).length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-muted-foreground mb-1">Opens nach Typ</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(data.opened_by_kind).map(([k, c]) => (
                    <Badge key={k} variant="secondary" className="text-[10px]">{k}: {c}</Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
