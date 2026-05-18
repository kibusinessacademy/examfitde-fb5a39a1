/**
 * StatusReverterAlertsCard
 *
 * Listet jüngste Pattern-X6-Vorfälle: building -> queued/blocked
 * mit Trigger-Liste und blocked_reason als Beweise.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Reverter = {
  id: string;
  created_at: string;
  package_id: string;
  title: string | null;
  symptom_before: { status?: string; blocked_reason?: string | null } | null;
  symptom_after: { status?: string; blocked_reason?: string | null } | null;
  gate_layer_after: {
    transition_source?: string;
    active_triggers?: string[];
    reverted_at?: string;
  } | null;
  notes: string | null;
  trigger_source: string;
};

export function StatusReverterAlertsCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["status-reverter-recent"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_status_reverter_recent", { p_limit: 25 });
      if (error) throw error;
      return (data ?? []) as Reverter[];
    },
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-status-warning-fg" />
            Status-Reverter (Pattern X6)
          </CardTitle>
          <CardDescription>
            <code>building → queued/blocked</code> innerhalb kurzer Zeit. Mit Trigger-Beweisen.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-text-muted">Keine Reverter in den letzten 7 Tagen.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-auto">
            {data.map((r) => (
              <div key={r.id} className="border border-border-subtle rounded-md p-2 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{r.title ?? r.package_id.slice(0, 8)}</span>
                  <span className="text-text-muted shrink-0">{new Date(r.created_at).toLocaleString("de-DE")}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline">{r.symptom_before?.status} → {r.symptom_after?.status}</Badge>
                  {r.symptom_after?.blocked_reason && (
                    <Badge variant="outline" className="bg-status-warning-bg-subtle text-status-warning-fg">
                      {r.symptom_after.blocked_reason}
                    </Badge>
                  )}
                  <Badge variant="outline">src: {r.trigger_source}</Badge>
                </div>
                {r.gate_layer_after?.active_triggers && r.gate_layer_after.active_triggers.length > 0 && (
                  <details className="text-text-muted">
                    <summary className="cursor-pointer">Aktive Trigger ({r.gate_layer_after.active_triggers.length})</summary>
                    <ul className="ml-4 mt-1 list-disc">
                      {r.gate_layer_after.active_triggers.map((t) => (
                        <li key={t}><code>{t}</code></li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
