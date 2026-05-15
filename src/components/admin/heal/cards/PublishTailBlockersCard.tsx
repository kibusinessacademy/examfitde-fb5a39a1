import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Blocker = {
  package_id: string;
  title: string;
  status: string;
  track: string | null;
  approved_questions: number;
  steps_done: number;
  steps_total: number;
  steps_failed_retriable: number;
  steps_parked: number;
  bronze_locked: boolean;
  root_cause: string;
  recommendation: string;
};

const causeVariant = (c: string) => {
  if (c === "STEP_RECONCILE_DRIFT" || c === "JOB_FAILED_RETRIABLE" || c === "JOB_PARKED") return "default";
  if (c === "BRONZE_LOCKED" || c === "PRICING_BLOCKED" || c === "GUARD_MATRIX_MISMATCH") return "destructive";
  return "secondary";
};

export function PublishTailBlockersCard() {
  const [lastRun, setLastRun] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["publish-tail-blockers"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_publish_tail_blockers", { p_limit: 100 });
      if (error) throw error;
      return data as { ok: boolean; count: number; blockers: Blocker[] };
    },
  });

  const reconcile = useMutation({
    mutationFn: async (dry: boolean) => {
      const { data, error } = await supabase.rpc("admin_run_publish_tail_reconciler", {
        p_dry_run: dry,
        p_limit: 20,
        p_package_ids: null,
      });
      if (error) throw error;
      return data as { ok: boolean; healed: number; unresolved: number; skipped: number };
    },
    onSuccess: (r, dry) => {
      setLastRun(`${dry ? "Dry-run" : "Run"}: healed=${r.healed} unresolved=${r.unresolved} skipped=${r.skipped}`);
      toast.success(`Reconciler ${dry ? "dry-run" : "run"} complete`);
      if (!dry) refetch();
    },
    onError: (e: any) => toast.error(`Reconciler failed: ${e.message}`),
  });

  const blockers = data?.blockers ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Publish-Tail Blockers</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={reconcile.isPending} onClick={() => reconcile.mutate(true)}>
            Dry-Run (20)
          </Button>
          <Button size="sm" disabled={reconcile.isPending} onClick={() => reconcile.mutate(false)}>
            Run (20)
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {lastRun && <div className="text-xs text-muted-foreground">{lastRun}</div>}
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Lade…</div>
        ) : blockers.length === 0 ? (
          <div className="text-sm text-muted-foreground">Keine Tail-Blocker.</div>
        ) : (
          <div className="space-y-2 max-h-[480px] overflow-auto">
            {blockers.map((b) => (
              <div key={b.package_id} className="rounded-md border border-border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate">{b.title}</div>
                  <Badge variant={causeVariant(b.root_cause) as any}>{b.root_cause}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>status: {b.status}</span>
                  <span>track: {b.track ?? "—"}</span>
                  <span>approved Q: {b.approved_questions}</span>
                  <span>steps: {b.steps_done}/{b.steps_total}</span>
                  {b.steps_failed_retriable > 0 && <span>failed: {b.steps_failed_retriable}</span>}
                  {b.steps_parked > 0 && <span>parked: {b.steps_parked}</span>}
                  {b.bronze_locked && <span>bronze-locked</span>}
                  <span>→ {b.recommendation}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
