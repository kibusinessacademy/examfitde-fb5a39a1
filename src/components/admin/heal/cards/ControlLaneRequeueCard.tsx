/**
 * ControlLaneRequeueCard — Heal-Aktion für Control-Lane Worker-Stillstand.
 * Zeigt Dry-Run-Liste der zu re-queuenden Stale-Jobs, dann Execute-Button.
 * Nutzt admin_requeue_stale_control_jobs(min_age, limit, dry_run).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { RotateCw, Play, AlertTriangle } from "lucide-react";

interface Row {
  job_id: string;
  job_type: string;
  package_id: string;
  old_status: string;
  new_status: string;
  required_step: string | null;
  required_step_status: string | null;
  action: string; // 'dry_run' | 'requeued' | 'skipped_prereq_not_done'
}

export function ControlLaneRequeueCard() {
  const qc = useQueryClient();
  const [minAge, setMinAge] = useState(60);
  const [limit, setLimit] = useState(50);
  const [dryRunResult, setDryRunResult] = useState<Row[] | null>(null);

  const dryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_requeue_stale_control_jobs" as any,
        { p_min_age_minutes: minAge, p_limit: limit, p_dry_run: true },
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    onSuccess: (data) => {
      setDryRunResult(data);
      toast.success(`Dry-Run: ${data.length} Stale-Jobs gefunden`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const execute = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_requeue_stale_control_jobs" as any,
        { p_min_age_minutes: minAge, p_limit: limit, p_dry_run: false },
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    onSuccess: (data) => {
      toast.success(`${data.length} Control-Lane-Jobs requeued`);
      setDryRunResult(null);
      qc.invalidateQueries({ queryKey: ["admin-lane-health"] });
      qc.invalidateQueries({ queryKey: ["admin-pending-age-histogram"] });
      qc.invalidateQueries({ queryKey: ["queue-throughput-v2"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="p-4 border-warning/40">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <RotateCw className="h-4 w-4" /> Control-Lane Stale-Requeue
        </h3>
        <Badge variant="outline" className="text-[10px] border-warning text-warning-foreground">
          <AlertTriangle className="h-3 w-3 mr-1" /> Heal-Aktion · DB-Mutation
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Setzt alte hängende Control-Lane-Jobs (pending/queued ≥ N Minuten) zurück auf pending mit
        gelöschtem Lock und Audit-Eintrag in <code className="font-mono">meta.admin_requeued_at</code>.
        <strong className="block mt-1">Vorbedingungs-Schutz:</strong> Jobs deren erforderlicher
        Pipeline-Step (z.B. <code className="font-mono">quality_council</code>) noch nicht
        <code className="font-mono"> done</code>/<code className="font-mono">skipped</code> ist,
        werden als <code className="font-mono">skipped_prereq_not_done</code> gemeldet und
        NICHT requeued.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <Label htmlFor="minAge" className="text-xs">Min. Alter (Minuten)</Label>
          <Input
            id="minAge"
            type="number"
            value={minAge}
            onChange={(e) => setMinAge(Math.max(1, Number(e.target.value)))}
            className="h-8"
          />
        </div>
        <div>
          <Label htmlFor="limit" className="text-xs">Limit (max. Jobs)</Label>
          <Input
            id="limit"
            type="number"
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value))))}
            className="h-8"
          />
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => dryRun.mutate()}
          disabled={dryRun.isPending}
        >
          {dryRun.isPending ? "Prüfe…" : "Dry-Run"}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => execute.mutate()}
          disabled={
            execute.isPending ||
            !dryRunResult ||
            dryRunResult.filter((r) => r.action !== "skipped_prereq_not_done").length === 0
          }
        >
          <Play className="h-3 w-3 mr-1" />
          {execute.isPending
            ? "Requeue…"
            : `Execute (${dryRunResult?.filter((r) => r.action !== "skipped_prereq_not_done").length ?? 0})`}
        </Button>
      </div>

      {dryRunResult && (
        <div className="space-y-1 max-h-64 overflow-y-auto text-xs">
          {dryRunResult.length === 0 ? (
            <p className="text-muted-foreground py-2">Keine Stale-Jobs gefunden ✓</p>
          ) : (
            <>
              {(() => {
                const skipped = dryRunResult.filter((r) => r.action === "skipped_prereq_not_done").length;
                const actionable = dryRunResult.length - skipped;
                return (
                  <div className="text-[11px] text-muted-foreground mb-2 flex gap-3">
                    <span><strong className="text-foreground">{actionable}</strong> requeue-fähig</span>
                    {skipped > 0 && (
                      <span className="text-warning-foreground">
                        <strong>{skipped}</strong> blockiert (Vorbedingung offen)
                      </span>
                    )}
                  </div>
                );
              })()}
              {dryRunResult.map((r) => {
                const blocked = r.action === "skipped_prereq_not_done";
                return (
                  <div
                    key={r.job_id}
                    className={`flex items-center justify-between rounded border p-1.5 font-mono ${
                      blocked ? "border-warning/50 bg-warning/5" : ""
                    }`}
                  >
                    <span className="truncate flex-1">{r.job_type}</span>
                    {r.required_step && (
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                        prereq: {r.required_step}={r.required_step_status ?? "missing"}
                      </span>
                    )}
                    <span className="text-muted-foreground text-[10px] shrink-0 ml-2">
                      {r.job_id.slice(0, 8)}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
