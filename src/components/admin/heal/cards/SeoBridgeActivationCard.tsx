/**
 * SeoBridgeActivationCard — E3e.3 Selective Activation
 * SSOT: admin_get_bridge_activation_snapshot
 *
 * Read-only KPI-Card. Aktivierungs-/Rollback-Aktionen laufen über RPC
 * (admin_seo_bridge_activation_execute / _rollback) — kontrolliert per
 * Skript oder dediziertem Ops-Workflow, NICHT per One-Click-Button,
 * damit Batch-Label + Candidate-Auswahl bewusst gesetzt werden.
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
import { GitBranch, RefreshCw, ShieldCheck } from "lucide-react";

type Row = {
  link_type: string;
  total_runs: number;
  total_activated: number;
  total_skipped: number;
  total_rolled_back: number;
  last_run_at: string | null;
  last_batch_label: string | null;
  last_dry_run: boolean | null;
};

export function SeoBridgeActivationCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["seo-bridge-activation-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_bridge_activation_snapshot" as never,
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
          <GitBranch className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-base font-semibold">
              SEO Bridge Activation
              <Badge variant="outline" className="ml-2 font-mono text-xs">
                E3e.3
              </Badge>
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Selective Activation — Pilot-Kandidaten → suggestions (2nd human gate für active)
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
        <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            Hard-Cap pro Batch: <span className="font-mono">blog_to_pillar=60</span>,
            {" "}<span className="font-mono">blog_to_exam_package=25</span>.
            Aktivierte Einträge landen als <code>status='suggested'</code> —
            <strong> nicht</strong> <code>'active'</code>.
          </p>
          <p>
            Rollback nur für live-Batches (nicht dry-run), Grund ≥5 Zeichen,
            markiert Suggestions als <code>rejected</code>.
          </p>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-6 text-center">
          Noch keine Aktivierungs-Batches. Pipeline scharfgeschaltet, wartet auf ersten
          Execute-Call via <code className="font-mono">admin_seo_bridge_activation_execute</code>.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bridge-Typ</TableHead>
              <TableHead className="text-right">Runs</TableHead>
              <TableHead className="text-right">Activated</TableHead>
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
                  {r.total_activated}
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
