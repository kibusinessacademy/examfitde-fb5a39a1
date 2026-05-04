/**
 * ContinuationFailuresCard — Sichtbarkeit für Continuation-Inserts, die scheiterten
 * (z.B. wegen uq_job_queue_active_package_job UNIQUE-Verletzungen).
 *
 * Quelle: RPC admin_get_continuation_enqueue_failures (last 24h)
 * Wenn der DB-Trigger erfolgreich greift, sollte diese Liste leer bleiben.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  source_job_id: string;
  package_id: string;
  title: string;
  job_type: string;
  completed_at: string;
  mode: string | null;
  depth: number | null;
  continuation_reason: string;
  continuation_error: string | null;
  remaining_targets: number | null;
};

export function ContinuationFailuresCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "continuation-enqueue-failures"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await (supabase as any).rpc(
        "admin_get_continuation_enqueue_failures",
        { p_limit: 50 }
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 120_000,
  });

  const rows = data ?? [];

  return (
    <Card className="border-border bg-surface-1">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-4 w-4 text-warning" />
            Continuation Enqueue Failures
            <Badge variant="outline" className="ml-2 text-xs">
              24h
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            {rows.length > 0 ? (
              <Badge variant="destructive">{rows.length}</Badge>
            ) : (
              <Badge variant="secondary">0</Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Worker meldet <code>CONTINUATION_ENQUEUE_FAILED</code> (z.B.
          UNIQUE-Konflikt). Sollte 0 bleiben — der DB-Trigger
          <code> fn_competency_repair_tail_reset</code> übernimmt jetzt.
          Werte &gt; 0 = Trigger greift nicht oder zusätzlicher Pfad existiert.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            ✓ Keine Continuation-Fehlversuche in 24h
          </div>
        ) : (
          <ScrollArea className="h-[260px]">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground sticky top-0 bg-surface-1">
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2">Paket</th>
                  <th className="text-left py-2 px-2">Mode</th>
                  <th className="text-right py-2 px-2">Depth</th>
                  <th className="text-right py-2 px-2">Remaining</th>
                  <th className="text-left py-2 px-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.source_job_id}
                    className="border-b border-border/50 hover:bg-surface-2/50"
                  >
                    <td
                      className="py-2 px-2 max-w-[220px] truncate"
                      title={r.title}
                    >
                      {r.title}
                    </td>
                    <td className="py-2 px-2">
                      <code className="text-xs">{r.mode ?? "—"}</code>
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      {r.depth ?? "—"}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      {r.remaining_targets ?? "—"}
                    </td>
                    <td
                      className="py-2 px-2 text-xs text-muted-foreground max-w-[280px] truncate"
                      title={r.continuation_error ?? ""}
                    >
                      {r.continuation_error ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
