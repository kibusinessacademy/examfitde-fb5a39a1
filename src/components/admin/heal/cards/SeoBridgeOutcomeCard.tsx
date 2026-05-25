/**
 * SeoBridgeOutcomeCard — E3e.4 Outcome Measurement
 * SSOT: admin_get_bridge_outcome_summary + admin_seo_bridge_compute_outcome
 *
 * Read-only KPI-Card. Pre/Post-Window-Vergleich pro Bridge-Typ.
 * Snapshot-Button persistiert aktuellen Stand in seo_bridge_outcome_snapshots.
 * Promotion suggested→active bleibt manueller Schritt — kein Auto-Flip.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Activity, Camera, RefreshCw, TrendingUp } from "lucide-react";
import { toast } from "sonner";

type SummaryRow = {
  link_type: string;
  edges_total: number;
  promote_recommended: number;
  rollback_candidates: number;
  hold_count: number;
  insufficient_sample: number;
  avg_target_views_lift_pct: number | null;
  last_snapshot_at: string | null;
};

export function SeoBridgeOutcomeCard() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["seo-bridge-outcome-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_bridge_outcome_summary" as never,
      );
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
    refetchInterval: 120_000,
  });

  const snapshot = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_seo_bridge_compute_outcome" as never,
        { p_link_type: null } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (res: any) => {
      toast.success(`Snapshot persistiert: ${res?.rows_snapshotted ?? 0} Edges`);
      qc.invalidateQueries({ queryKey: ["seo-bridge-outcome-summary"] });
    },
    onError: (e: Error) => toast.error(`Snapshot fehlgeschlagen: ${e.message}`),
  });

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-base font-semibold">
              SEO Bridge Outcome
              <Badge variant="outline" className="ml-2 font-mono text-xs">E3e.4</Badge>
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Pre/Post-Vergleich (14d default) — Promotion suggested→active erfordert PROMOTE_RECOMMENDED + Human-Gate.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => snapshot.mutate()}
            disabled={snapshot.isPending}
          >
            <Camera className={`h-4 w-4 mr-1 ${snapshot.isPending ? "animate-pulse" : ""}`} />
            Snapshot
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-6 text-center">
          Noch keine aktivierten Bridges — Outcome-Messung beginnt nach erster Aktivierung.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bridge-Typ</TableHead>
              <TableHead className="text-right">Edges</TableHead>
              <TableHead className="text-right text-success-fg">Promote</TableHead>
              <TableHead className="text-right text-destructive">Rollback</TableHead>
              <TableHead className="text-right">Hold</TableHead>
              <TableHead className="text-right text-muted-foreground">Pending Sample</TableHead>
              <TableHead className="text-right">
                <TrendingUp className="h-3 w-3 inline mr-1" />
                Ø Lift %
              </TableHead>
              <TableHead className="text-xs">Last Snapshot</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r) => (
              <TableRow key={r.link_type}>
                <TableCell className="font-mono text-xs">{r.link_type}</TableCell>
                <TableCell className="text-right">{r.edges_total}</TableCell>
                <TableCell className="text-right">
                  {r.promote_recommended > 0 ? (
                    <Badge className="bg-success-bg-subtle text-success-fg">
                      {r.promote_recommended}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {r.rollback_candidates > 0 ? (
                    <Badge variant="destructive">{r.rollback_candidates}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{r.hold_count}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {r.insufficient_sample}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {r.avg_target_views_lift_pct !== null
                    ? `${r.avg_target_views_lift_pct > 0 ? "+" : ""}${r.avg_target_views_lift_pct}%`
                    : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.last_snapshot_at
                    ? new Date(r.last_snapshot_at).toLocaleString("de-DE", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
