/**
 * DagBlockedDashboardCard — DAG-Blocked Jobs Übersicht + Auto-Heal
 * ─────────────────────────────────────────────────────────────────
 * Zeigt blockierte Jobs (Parent fehlt/failed), Severity (P0/P1/P2),
 * Pro-Kurs-Aufschlüsselung mit Per-Kurs-Retry und globaler Auto-Heal.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, RefreshCw, Wrench, Eye, ExternalLink, Search, Send } from "lucide-react";
import { toast } from "sonner";

type Overview = {
  summary: {
    total_blocked: number;
    by_reason: Record<string, number>;
    severity: "P0" | "P1" | "P2" | "OK";
    oldest_minutes: number;
  };
  by_package: Array<{
    package_id: string;
    package_title: string;
    package_status: string;
    bronze_locked: boolean | null;
    blocked_count: number;
    oldest_minutes: number;
    reasons: string[];
    blocked_steps: string[];
    parent_steps: string[] | null;
  }>;
  jobs: Array<{
    job_id: string;
    package_id: string;
    package_title: string;
    step_key: string;
    parent_step_key: string | null;
    parent_step_status: string | null;
    block_reason: string;
    minutes_blocked: number;
    attempts: number;
  }>;
  fetched_at: string;
};

const severityColor: Record<string, string> = {
  P0: "bg-destructive text-destructive-foreground",
  P1: "bg-status-warning-bg-subtle text-status-warning-fg",
  P2: "bg-status-info-bg-subtle text-status-info-fg",
  OK: "bg-status-success-bg-subtle text-status-success-fg",
};

export function DagBlockedDashboardCard() {
  const qc = useQueryClient();
  const [showDetails, setShowDetails] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dag-blocked-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_dag_blocked_overview" as never);
      if (error) throw error;
      return data as unknown as Overview;
    },
    refetchInterval: 30_000,
  });

  const healAll = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const { data, error } = await supabase.rpc("admin_heal_dag_blocked_jobs" as never, {
        p_package_id: null, p_dry_run: dryRun, p_max_packages: 50,
      } as never);
      if (error) throw error;
      return data as { parents_re_enqueued: number; steps_requeued: number; skipped_parent_active: number };
    },
    onSuccess: (r, dryRun) => {
      toast.success(
        dryRun
          ? `Dry-Run: ${r.parents_re_enqueued} Parents würden re-enqueued`
          : `Geheilt: ${r.parents_re_enqueued} Parents re-enqueued · ${r.steps_requeued} Steps reset`,
      );
      qc.invalidateQueries({ queryKey: ["dag-blocked-overview"] });
    },
    onError: (e: Error) => toast.error(`Heal fehlgeschlagen: ${e.message}`),
  });

  const healPackage = useMutation({
    mutationFn: async (pkgId: string) => {
      const { data, error } = await supabase.rpc("admin_retry_dag_blocked_for_package" as never, {
        p_package_id: pkgId,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Kurs-Heal ausgelöst");
      qc.invalidateQueries({ queryKey: ["dag-blocked-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sev = data?.summary.severity ?? "OK";

  return (
    <Card id="dag-blocked">
      <CardHeader className="flex flex-row items-start justify-between gap-2 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            DAG-Blocked Jobs
            <Badge className={severityColor[sev]}>{sev}</Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {isLoading
              ? "Lade…"
              : `${data?.summary.total_blocked ?? 0} Jobs blockiert · ältester ${data?.summary.oldest_minutes ?? 0} min`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["dag-blocked-overview"] })}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => healAll.mutate(true)} disabled={healAll.isPending}>
            <Eye className="h-3.5 w-3.5 mr-1" /> Dry-Run
          </Button>
          <Button size="sm" onClick={() => healAll.mutate(false)} disabled={healAll.isPending}>
            <Wrench className="h-3.5 w-3.5 mr-1" /> Auto-Heal alle
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data && (
          <div className="flex gap-2 flex-wrap text-xs">
            {Object.entries(data.summary.by_reason).map(([reason, count]) => (
              <Badge key={reason} variant="outline">
                {reason}: <span className="ml-1 font-mono">{count}</span>
              </Badge>
            ))}
          </div>
        )}

        {data && data.by_package.length > 0 && (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kurs</TableHead>
                  <TableHead className="text-right">Blocked</TableHead>
                  <TableHead className="text-right">Älteste</TableHead>
                  <TableHead>Parent-Steps</TableHead>
                  <TableHead>Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.by_package.slice(0, 25).map((p) => (
                  <TableRow key={p.package_id}>
                    <TableCell className="max-w-[260px]">
                      <div className="truncate font-medium" title={p.package_title}>{p.package_title}</div>
                      <div className="text-xs text-muted-foreground flex gap-1 flex-wrap mt-0.5">
                        {p.bronze_locked && <Badge variant="outline" className="text-[10px]">bronze</Badge>}
                        {p.reasons.map((r) => (
                          <span key={r} className="font-mono">{r}</span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{p.blocked_count}</TableCell>
                    <TableCell className="text-right font-mono">{p.oldest_minutes}m</TableCell>
                    <TableCell className="text-xs font-mono">{(p.parent_steps ?? []).join(", ") || "—"}</TableCell>
                    <TableCell>
                      <Button
                        size="sm" variant="outline"
                        onClick={() => healPackage.mutate(p.package_id)}
                        disabled={healPackage.isPending}
                      >
                        Heal
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? "Job-Details ausblenden" : `Job-Details anzeigen (${data?.jobs.length ?? 0})`}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href="/admin/queue?tab=audit" target="_blank" rel="noreferrer">
              auto_heal_log <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
        </div>

        {showDetails && data && (
          <div className="rounded-lg border max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Step</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobs.map((j) => (
                  <TableRow key={j.job_id}>
                    <TableCell className="font-mono text-xs">{j.step_key}</TableCell>
                    <TableCell className="font-mono text-xs">{j.parent_step_key ?? "—"}</TableCell>
                    <TableCell className="text-xs">{j.parent_step_status ?? "—"}</TableCell>
                    <TableCell className="text-xs">{j.block_reason}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{j.minutes_blocked}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
