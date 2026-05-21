import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle } from "lucide-react";

interface FailureSummary {
  window_hours: number;
  total: number;
  by_status: Record<string, number>;
  by_risk: Record<string, number>;
  top_failing_handlers: Array<{ action_type: string; count: number }>;
  idempotent_hits: number;
}

export default function RuntimeFailuresCard() {
  const [window, setWindow] = useState("24");
  const { data, isLoading } = useQuery({
    queryKey: ["runtime-action-failures", window],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_runtime_action_failures" as never, { _window_hours: parseInt(window, 10) } as never);
      if (error) throw error;
      return data as unknown as FailureSummary;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-status-fg-warning" />
          Failure & Idempotency Forensics
        </CardTitle>
        <Select value={window} onValueChange={setWindow}>
          <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1h</SelectItem>
            <SelectItem value="24">24h</SelectItem>
            <SelectItem value="168">7d</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted/30" />
        ) : !data ? null : (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">By Status</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.by_status).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-[11px]">{k}: {v}</Badge>
                ))}
                {Object.keys(data.by_status).length === 0 && <span className="text-xs text-muted-foreground">No data</span>}
              </div>
              <div className="text-xs font-semibold text-muted-foreground mt-3 mb-1.5">By Risk</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.by_risk).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-[11px]">{k}: {v}</Badge>
                ))}
              </div>
              <div className="text-xs text-muted-foreground mt-3">
                Total actions: <strong>{data.total}</strong> · Idempotent hits: <strong>{data.idempotent_hits}</strong>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Top Failing Handlers</div>
              {data.top_failing_handlers.length === 0 ? (
                <p className="text-xs text-muted-foreground">No failures in window.</p>
              ) : (
                <ul className="space-y-1">
                  {data.top_failing_handlers.map((h) => (
                    <li key={h.action_type} className="flex items-center justify-between rounded border border-border/50 bg-background px-2 py-1 text-xs">
                      <span className="font-mono">{h.action_type}</span>
                      <Badge variant="outline" className="text-[10px]">{h.count}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
