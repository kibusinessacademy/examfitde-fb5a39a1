/**
 * LessonJoinParityCard
 * Surfaces latest lesson-join parity check from auto_heal_log via
 * admin_get_lesson_join_parity_summary. Shows recommended_action +
 * auto-heal enqueue counters. Daily cron auto-runs and auto-enqueues
 * `repair_lessons` per mismatched package (idempotent).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";

type Mismatch = {
  package_id: string;
  title: string | null;
  via_curriculum: number;
  via_package_course: number;
  delta: number;
  recommended_action: string;
};

type Summary = {
  last_run_at: string | null;
  result_status?: string | null;
  result_detail?: string | null;
  mismatch_count: number;
  mismatches: Mismatch[];
  recommended_action: string;
  auto_heal_enqueued: number;
  auto_heal_skipped_existing: number;
  duration_ms?: number | null;
};

export function LessonJoinParityCard() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["heal-cockpit", "lesson-join-parity"],
    queryFn: async (): Promise<Summary> => {
      const { data, error } = await supabase.rpc(
        "admin_get_lesson_join_parity_summary" as never,
      );
      if (error) throw error;
      return data as unknown as Summary;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const runNow = useMutation({
    mutationFn: async () => {
      // Invokes daily worker via cron-fn endpoint surrogate is service-role only.
      // Admin-side: call summary refresh after asking server to re-run is not
      // exposed; so we just re-fetch the latest log here.
      await qc.invalidateQueries({ queryKey: ["heal-cockpit", "lesson-join-parity"] });
    },
    onSuccess: () => toast.success("Parity-Status aktualisiert"),
  });

  const ok = (data?.mismatch_count ?? 0) === 0;
  const lastRun = data?.last_run_at
    ? new Date(data.last_run_at).toLocaleString()
    : "—";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Lesson-Join Parity</CardTitle>
          {isLoading ? null : ok ? (
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> OK
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> {data!.mismatch_count} Mismatches
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <KPI label="Letzter Lauf" value={lastRun} />
              <KPI label="Mismatches" value={String(data?.mismatch_count ?? 0)} />
              <KPI
                label="Auto-Heal enqueued"
                value={String(data?.auto_heal_enqueued ?? 0)}
              />
              <KPI
                label="Skipped (existiert)"
                value={String(data?.auto_heal_skipped_existing ?? 0)}
              />
            </div>

            <div className="rounded-md border border-border bg-surface-2 p-2 text-xs">
              <span className="text-muted-foreground">Recommended Action: </span>
              <code className="rounded bg-surface-3 px-1 py-0.5 font-mono">
                {data?.recommended_action ?? "repair_lessons"}
              </code>
              <span className="ml-2 text-muted-foreground">
                (auto-enqueued via Cron <code>lesson-join-parity-daily</code>)
              </span>
            </div>

            {!ok && (
              <div className="max-h-72 overflow-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2">
                    <tr>
                      <th className="px-2 py-1 text-left">Paket</th>
                      <th className="px-2 py-1 text-right">via curriculum</th>
                      <th className="px-2 py-1 text-right">via course_id</th>
                      <th className="px-2 py-1 text-right">Δ</th>
                      <th className="px-2 py-1 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.mismatches ?? []).map((m) => (
                      <tr key={m.package_id} className="border-t border-border">
                        <td className="px-2 py-1">
                          <div className="truncate" title={m.title ?? m.package_id}>
                            {m.title ?? m.package_id.slice(0, 8)}
                          </div>
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {m.via_curriculum}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {m.via_package_course}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {m.delta > 0 ? `+${m.delta}` : m.delta}
                        </td>
                        <td className="px-2 py-1">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {m.recommended_action}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data?.result_detail && (
              <div className="text-[11px] text-muted-foreground">
                {data.result_detail}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono text-foreground">{value}</div>
    </div>
  );
}
