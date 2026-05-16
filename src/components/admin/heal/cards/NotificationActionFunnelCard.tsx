import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Filter as Funnel, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

interface FunnelRow {
  intent_key: string;
  label: string;
  recovery_action: string;
  sent: number;
  opened: number;
  reentered: number;
  action_taken: number;
  resolved: number;
  open_rate: number;
  action_rate: number;
  resolution_rate: number;
  is_dead_reminder: boolean;
}

export default function NotificationActionFunnelCard() {
  const [windowHours, setWindowHours] = useState(168);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["notif-action-funnel", windowHours],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        "admin_get_notification_action_funnel",
        { p_window_hours: windowHours }
      );
      if (error) throw error;
      return (data ?? []) as FunnelRow[];
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const deadCount = data?.filter((r) => r.is_dead_reminder).length ?? 0;
  const totalSent = data?.reduce((s, r) => s + r.sent, 0) ?? 0;
  const totalAction = data?.reduce((s, r) => s + r.action_taken, 0) ?? 0;
  const overallActionRate = totalSent > 0 ? ((100 * totalAction) / totalSent).toFixed(1) : "0";

  const tone = deadCount > 0 ? "warn" : totalSent === 0 ? "neutral" : "ok";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Funnel className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Notification Action Funnel</CardTitle>
          <Badge
            variant={tone === "warn" ? "destructive" : tone === "neutral" ? "outline" : "secondary"}
            className="text-xs"
          >
            {tone === "warn" ? `${deadCount} dead` : tone === "neutral" ? "no data" : "ok"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="text-xs border rounded px-2 py-1 bg-background"
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
          >
            <option value={24}>24h</option>
            <option value={72}>3d</option>
            <option value={168}>7d</option>
            <option value={720}>30d</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          SSOT-Sicht pro Reminder-Typ: sent → opened → reentered → action_taken → resolved. „Dead
          Reminder“ = ≥10 gesendet, 0 Aktionen.
        </div>

        {error && (
          <div className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {(error as Error).message}
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data || data.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Keine Intents im Registry oder im Zeitfenster.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="Sent (Σ)" value={totalSent.toString()} />
              <Stat label="Action (Σ)" value={totalAction.toString()} />
              <Stat label="Action-Rate" value={`${overallActionRate}%`} />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-1 pr-2">Intent</th>
                    <th className="text-right py-1 px-1">Sent</th>
                    <th className="text-right py-1 px-1">Open</th>
                    <th className="text-right py-1 px-1">Re-Entry</th>
                    <th className="text-right py-1 px-1">Action</th>
                    <th className="text-right py-1 px-1">Resolved</th>
                    <th className="text-right py-1 pl-1">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.intent_key} className="border-b last:border-0">
                      <td className="py-1 pr-2">
                        <div className="font-medium">{r.label}</div>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <span className="font-mono">{r.intent_key}</span>
                          {r.is_dead_reminder && (
                            <Badge variant="destructive" className="text-[10px] h-4 px-1">
                              dead
                            </Badge>
                          )}
                          <span>· recovery: {r.recovery_action}</span>
                        </div>
                      </td>
                      <td className="text-right py-1 px-1 tabular-nums">{r.sent}</td>
                      <td className="text-right py-1 px-1 tabular-nums">{r.opened}</td>
                      <td className="text-right py-1 px-1 tabular-nums">{r.reentered}</td>
                      <td className="text-right py-1 px-1 tabular-nums">{r.action_taken}</td>
                      <td className="text-right py-1 px-1 tabular-nums">{r.resolved}</td>
                      <td className="text-right py-1 pl-1 tabular-nums font-medium">
                        {r.action_rate.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
