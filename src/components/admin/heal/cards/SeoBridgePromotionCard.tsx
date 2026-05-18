/**
 * SeoBridgePromotionCard — E3e.4 Human Gate & Controlled Active Promotion
 * SSOT: admin_get_bridge_promotion_snapshot
 *
 * Read-only KPI-Card. Promotion `suggested` → `active` läuft
 * deliberatly NUR via RPC (admin_seo_bridge_promotion_execute /
 * _rollback), kontrolliert per Ops-Skript mit Batch-Label und
 * explizit ausgewählter Suggestion-ID-Liste. Kein One-Click-Knopf.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";

type Row = {
  link_type: string;
  total_runs: number;
  total_promoted: number;
  total_skipped: number;
  total_rolled_back: number;
  last_run_at: string | null;
  last_batch_label: string | null;
  last_dry_run: boolean | null;
};

export function SeoBridgePromotionCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["seo-bridge-promotion-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_bridge_promotion_snapshot" as never,
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-base font-semibold">
              SEO Bridge Promotion
              <Badge variant="outline" className="ml-2 font-mono text-xs">
                E3e.4
              </Badge>
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Human Gate — hebt geprüfte Suggestions kontrolliert auf{" "}
              <code>status='active'</code>
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="rounded-md bg-surface-sunken border border-border-subtle p-3 flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            Hard-Cap pro Batch: <span className="font-mono">blog_to_pillar=30</span>,{" "}
            <span className="font-mono">blog_to_exam_package=20</span>. Default
            dry-run. Re-checks: <code>status=suggested</code>, Pilot-Herkunft,
            Bronze-Lock (exam_package), Duplicate-Active.
          </p>
          <p>
            Rollback nur für live-Batches (Grund ≥5 Zeichen) — setzt Edges
            zurück auf <code>suggested</code>. Wave 1: nur Pillar promoten,
            messen, danach Exam-Package konservativ.
          </p>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-6 text-center">
          Noch keine Promotion-Batches. Pipeline scharfgeschaltet, wartet auf
          ersten Execute-Call via{" "}
          <code className="font-mono">admin_seo_bridge_promotion_execute</code>.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bridge-Typ</TableHead>
              <TableHead className="text-right">Runs</TableHead>
              <TableHead className="text-right">Promoted</TableHead>
              <TableHead className="text-right">Skipped</TableHead>
              <TableHead className="text-right">Rolled back</TableHead>
              <TableHead>Letzter Batch</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r) => (
              <TableRow key={r.link_type}>
                <TableCell className="font-mono text-xs">{r.link_type}</TableCell>
                <TableCell className="text-right">{r.total_runs}</TableCell>
                <TableCell className="text-right font-semibold">
                  {r.total_promoted}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {r.total_skipped}
                </TableCell>
                <TableCell className="text-right">
                  {r.total_rolled_back > 0 ? (
                    <Badge variant="destructive">{r.total_rolled_back}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {r.last_batch_label ?? "—"}
                  {r.last_dry_run !== null && (
                    <Badge
                      variant={r.last_dry_run ? "outline" : "default"}
                      className="ml-2 text-[10px]"
                    >
                      {r.last_dry_run ? "dry-run" : "live"}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
