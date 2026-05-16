import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Kpi = {
  window_hours: number;
  by_state: Record<string, number>;
  by_kind: Record<string, number>;
  top_suppression_reasons: Record<string, number>;
  subscriptions_active: number;
  subscriptions_revoked: number;
  delivery_rate_pct: number | null;
};

export default function NotificationKpiCard() {
  const [data, setData] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: d } = await (supabase as any).rpc("admin_get_notification_kpis", {
      p_window_hours: 24,
    });
    setData(d as Kpi | null);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const stateSum = (k: string) => data?.by_state?.[k] ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Bell className="h-4 w-4" /> Notification Outbox · 24h
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data ? (
          <p className="text-xs text-muted-foreground">Lädt…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Pending" value={stateSum("pending")} />
              <Stat label="Suppressed" value={stateSum("suppressed")} />
              <Stat label="Delivered" value={stateSum("delivered")} />
              <Stat label="Failed" value={stateSum("failed")} tone="warn" />
            </div>
            <div className="flex items-center justify-between text-xs pt-2 border-t">
              <span className="text-muted-foreground">Delivery-Rate</span>
              <Badge variant="outline">
                {data.delivery_rate_pct == null ? "—" : `${data.delivery_rate_pct}%`}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Aktive Subscriptions</span>
              <Badge variant="outline">{data.subscriptions_active}</Badge>
            </div>
            {data.subscriptions_revoked > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Revoked (cleanup)</span>
                <Badge variant="outline">{data.subscriptions_revoked}</Badge>
              </div>
            )}
            {Object.keys(data.top_suppression_reasons || {}).length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-1">Top Suppression-Reasons</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(data.top_suppression_reasons).map(([r, c]) => (
                    <Badge key={r} variant="secondary" className="text-[10px]">
                      {r}: {c}
                    </Badge>
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

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${tone === "warn" && value > 0 ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  );
}
