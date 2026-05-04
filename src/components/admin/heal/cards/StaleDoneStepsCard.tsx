/**
 * StaleDoneStepsCard — Tail-Steps die done sind, obwohl danach neue approved questions entstanden
 *
 * Quelle: View v_stale_done_steps via RPC admin_get_stale_done_steps_detail
 * Heal:   admin_heal_stale_done_steps_for_package(package_id)
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock3, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  package_id: string;
  title: string;
  package_status: string;
  step_key: string;
  finished_at: string;
  last_approved_at: string;
  approved_total: number;
  staleness_minutes: number;
};

type Summary = {
  packages_affected: number;
  steps_affected: number;
  by_step_key: Record<string, number>;
  oldest_staleness_minutes: number;
};

export function StaleDoneStepsCard() {
  const qc = useQueryClient();
  const [healing, setHealing] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ["admin", "stale-done-steps", "summary"],
    queryFn: async (): Promise<Summary> => {
      const { data, error } = await (supabase as any).rpc(
        "admin_get_stale_done_steps_summary"
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? {
        packages_affected: 0,
        steps_affected: 0,
        by_step_key: {},
        oldest_staleness_minutes: 0,
      }) as Summary;
    },
    refetchInterval: 60_000,
  });

  const detail = useQuery({
    queryKey: ["admin", "stale-done-steps", "detail"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await (supabase as any).rpc(
        "admin_get_stale_done_steps_detail",
        { p_limit: 100 }
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  async function heal(pkg: string, title: string) {
    setHealing(pkg);
    try {
      const { data, error } = await (supabase as any).rpc(
        "admin_heal_stale_done_steps_for_package",
        { p_package_id: pkg }
      );
      if (error) throw error;
      const res = data as { ok: boolean; steps_reset?: number; reason?: string };
      if (res?.ok) {
        toast.success(
          `${title}: ${res.steps_reset ?? 0} Schritte zurückgesetzt + Validate angestoßen`
        );
      } else {
        toast.warning(`${title}: ${res?.reason ?? "no-op"}`);
      }
      qc.invalidateQueries({ queryKey: ["admin", "stale-done-steps"] });
    } catch (e: any) {
      toast.error(`Heal failed: ${e.message}`);
    } finally {
      setHealing(null);
    }
  }

  const rows = detail.data ?? [];
  const s = summary.data;
  const isFetching = summary.isFetching || detail.isFetching;

  return (
    <Card className="border-border bg-surface-1">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock3 className="h-4 w-4 text-warning" />
            Stale Done Steps
            <Badge variant="outline" className="ml-2 text-xs">
              SSOT v_stale_done_steps
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            {s && s.steps_affected > 0 && (
              <Badge variant="destructive">
                {s.packages_affected} Pakete · {s.steps_affected} Steps
              </Badge>
            )}
            {s && s.oldest_staleness_minutes > 0 && (
              <Badge variant="outline" className="text-xs">
                ältester: {Math.round(s.oldest_staleness_minutes / 60)}h
              </Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                summary.refetch();
                detail.refetch();
              }}
              disabled={isFetching}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Tail-Steps (validate / integrity / council / auto_publish) auf{" "}
          <code>done</code>, obwohl danach neue approved Fragen entstanden.
          Heal setzt Step → queued + enqueued <code>package_validate_exam_pool</code>.
          Stündlicher Cron <code>heal-stale-validation-hourly</code> heilt automatisch.
        </p>
      </CardHeader>
      <CardContent>
        {detail.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            ✓ Keine veralteten Tail-Steps
          </div>
        ) : (
          <ScrollArea className="h-[320px]">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground sticky top-0 bg-surface-1">
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2">Paket</th>
                  <th className="text-left py-2 px-2">Step</th>
                  <th className="text-right py-2 px-2">Approved</th>
                  <th className="text-right py-2 px-2">Stale (min)</th>
                  <th className="text-right py-2 px-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.package_id}-${r.step_key}`}
                    className="border-b border-border/50 hover:bg-surface-2/50"
                  >
                    <td
                      className="py-2 px-2 max-w-[260px] truncate"
                      title={r.title}
                    >
                      {r.title}
                      <div className="text-xs text-muted-foreground">
                        {r.package_status}
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      <code className="text-xs">{r.step_key}</code>
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      {r.approved_total}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      {r.staleness_minutes}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => heal(r.package_id, r.title)}
                        disabled={healing === r.package_id}
                      >
                        <Wand2 className="h-3.5 w-3.5 mr-1" />
                        {healing === r.package_id ? "..." : "Heal"}
                      </Button>
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
