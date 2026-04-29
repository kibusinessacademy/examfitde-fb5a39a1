/**
 * TargetedRecheckCard — Cause-aware Re-Enqueue für 4 Blocker-Klassen.
 * Source: RPC admin_targeted_blocker_recheck(p_execute)
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CheckCircle2, Clock, Play, MinusCircle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface RecheckRow {
  package_id: string;
  course_title: string | null;
  package_track: string | null;
  blocker: string;
  action: string;
  reason: string;
  attempted: boolean;
  job_inserted: boolean;
}

export function TargetedRecheckCard() {
  const qc = useQueryClient();
  const [snapshotBefore, setSnapshotBefore] = useState<Record<string, number> | null>(null);
  const [snapshotAfter, setSnapshotAfter] = useState<Record<string, number> | null>(null);
  const [lastPlan, setLastPlan] = useState<RecheckRow[] | null>(null);
  const [planMode, setPlanMode] = useState<"dry" | "exec" | null>(null);

  const snapshotJobs = async (): Promise<Record<string, number>> => {
    const types = [
      "package_run_integrity_check",
      "package_quality_council",
      "package_repair_exam_pool_quality",
      "package_repair_exam_pool_competency_coverage",
      "package_repair_exam_pool_lf_coverage",
    ];
    const out: Record<string, number> = {};
    await Promise.all(
      types.map(async (t) => {
        const { count } = await supabase
          .from("job_queue")
          .select("*", { count: "exact", head: true })
          .eq("job_type", t)
          .in("status", ["pending", "processing", "queued"]);
        out[t] = count ?? 0;
      }),
    );
    return out;
  };

  const recheck = useMutation({
    mutationFn: async (execute: boolean) => {
      const before = execute ? await snapshotJobs() : null;
      if (execute) setSnapshotBefore(before);
      const { data, error } = await supabase.rpc(
        "admin_targeted_blocker_recheck" as any,
        { p_execute: execute },
      );
      if (error) throw error;
      const after = execute ? await snapshotJobs() : null;
      if (execute) setSnapshotAfter(after);
      return { rows: (data ?? []) as unknown as RecheckRow[], execute };
    },
    onSuccess: ({ rows, execute }) => {
      setLastPlan(rows);
      setPlanMode(execute ? "exec" : "dry");
      toast.success(
        execute
          ? `Re-Enqueue ausgeführt: ${rows.length} Aktionen`
          : `Dry-Run: ${rows.length} geplante Aktionen`,
      );
      qc.invalidateQueries({ queryKey: ["blocker-dashboard"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Recheck fehlgeschlagen"),
  });

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold">Targeted Blocker Recheck</h3>
          <p className="text-xs text-muted-foreground">
            Cause-aware Re-Enqueue für alle 4 Blocker-Klassen — auditiert über admin_ai_analysis_log.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => recheck.mutate(false)}
            disabled={recheck.isPending}
          >
            Dry-Run
          </Button>
          <Button size="sm" onClick={() => recheck.mutate(true)} disabled={recheck.isPending}>
            <Play className="h-3.5 w-3.5 mr-1.5" /> Execute
          </Button>
        </div>
      </div>

      {planMode === "exec" && snapshotBefore && snapshotAfter && (
        <div className="border rounded-md p-3 bg-muted/30">
          <div className="text-xs font-semibold mb-2">Job-Queue Snapshot (Before → After)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
            {Object.keys(snapshotBefore).map((t) => {
              const b = snapshotBefore[t];
              const a = snapshotAfter[t];
              const delta = a - b;
              return (
                <div key={t} className="flex justify-between">
                  <span className="truncate">{t}</span>
                  <span>
                    {b} → {a}{" "}
                    <span className={delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground"}>
                      ({delta > 0 ? "+" : ""}{delta})
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lastPlan && (
        <div className="border rounded-md max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Course</TableHead>
                <TableHead className="text-xs">Track</TableHead>
                <TableHead className="text-xs">Blocker</TableHead>
                <TableHead className="text-xs">Action</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lastPlan.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs max-w-[200px] truncate">{r.course_title}</TableCell>
                  <TableCell className="text-xs">{r.package_track}</TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className="text-[10px]">{r.blocker}</Badge>
                  </TableCell>
                  <TableCell className="text-[10px] font-mono">{r.action}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.reason}</TableCell>
                  <TableCell>
                    {!r.attempted ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <MinusCircle className="h-3.5 w-3.5" /> skipped
                      </span>
                    ) : r.job_inserted ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> job inserted
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-secondary-foreground">
                        <ShieldAlert className="h-3.5 w-3.5" /> active/blocked
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
