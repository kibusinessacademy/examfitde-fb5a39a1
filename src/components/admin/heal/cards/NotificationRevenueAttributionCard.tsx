import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Euro } from "lucide-react";

type Row = {
  intent_key: string;
  persona: string;
  dispatches_allowed: number;
  dispatches_suppressed: number;
  orders_attributed: number;
  revenue_cents_attributed: number;
  conversion_pct: number;
};

const WINDOWS = ["24h", "7d", "30d"] as const;

export default function NotificationRevenueAttributionCard() {
  const [windowKey, setWindowKey] = useState<(typeof WINDOWS)[number]>("30d");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["notif-revenue-attribution", windowKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_notification_revenue_attribution" as any,
        { p_window: windowKey }
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const totalRevenue = (data ?? []).reduce(
    (s, r) => s + Number(r.revenue_cents_attributed ?? 0),
    0
  );
  const totalOrders = (data ?? []).reduce(
    (s, r) => s + Number(r.orders_attributed ?? 0),
    0
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-4" />
            Notification Revenue Attribution
          </CardTitle>
          <CardDescription>
            Track M1 — Umsatz-Lift pro Intent × Persona (Dispatch → Order ≤7d).
          </CardDescription>
        </div>
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={w === windowKey ? "default" : "outline"}
              onClick={() => setWindowKey(w)}
            >
              {w}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="size-3 animate-spin" /> : "↻"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-md border border-border bg-surface-subtle p-2">
            <div className="text-text-muted text-xs">Orders</div>
            <div className="font-semibold">{totalOrders}</div>
          </div>
          <div className="rounded-md border border-border bg-surface-subtle p-2">
            <div className="text-text-muted text-xs">Revenue</div>
            <div className="font-semibold flex items-center gap-1">
              <Euro className="size-3" />
              {(totalRevenue / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="rounded-md border border-border bg-surface-subtle p-2">
            <div className="text-text-muted text-xs">Intents</div>
            <div className="font-semibold">{data?.length ?? 0}</div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-text-muted">
            Noch keine Attribution-Daten im Fenster.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-text-muted">
                <tr className="border-b border-border">
                  <th className="text-left py-1">Intent</th>
                  <th className="text-left">Persona</th>
                  <th className="text-right">Allowed</th>
                  <th className="text-right">Suppr.</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Conv.%</th>
                  <th className="text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1 font-mono">{r.intent_key}</td>
                    <td>
                      <Badge variant="outline" className="text-[10px]">
                        {r.persona}
                      </Badge>
                    </td>
                    <td className="text-right">{r.dispatches_allowed}</td>
                    <td className="text-right text-text-muted">{r.dispatches_suppressed}</td>
                    <td className="text-right font-semibold">{r.orders_attributed}</td>
                    <td className="text-right">{Number(r.conversion_pct).toFixed(1)}</td>
                    <td className="text-right font-semibold">
                      €{(Number(r.revenue_cents_attributed) / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
