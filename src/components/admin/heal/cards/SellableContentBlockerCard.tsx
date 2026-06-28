/**
 * SELLABLE.CONTENT.BLOCKER.BATCH.1 — Cockpit card
 * Dry-run & live trigger plus latest outcome ledger row.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlayCircle, FlaskConical, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  dry_run: boolean;
  trigger_source: string;
  status: string;
  delta_sellable: number | null;
  delta_blockers: number | null;
  remaining_blocker_count: number | null;
  before_snapshot: any;
  after_snapshot: any;
  actions: any;
  error: string | null;
}

export function SellableContentBlockerCard() {
  const qc = useQueryClient();

  const runsQ = useQuery({
    queryKey: ["sellable-content-blocker-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sellable_content_blocker_runs" as any)
        .select("*")
        .order("started_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as unknown as RunRow[];
    },
    refetchInterval: 60_000,
  });

  const trigger = useMutation({
    mutationFn: async (dry: boolean) => {
      const { data, error } = await supabase.functions.invoke(
        "sellable-content-blocker-batch",
        { body: { dry_run: dry, cap: 200, trigger_source: dry ? "ui-dry" : "ui-live" } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(
        `Batch ${data?.dry_run ? "(dry)" : "(live)"} ok · sellable ${data?.before?.sellable}→${data?.after?.sellable} (Δ ${data?.delta_sellable ?? 0})`,
      );
      qc.invalidateQueries({ queryKey: ["sellable-content-blocker-runs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Batch fehlgeschlagen"),
  });

  const latest = runsQ.data?.[0];
  const after = latest?.after_snapshot ?? null;
  const actions = latest?.actions ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4" />
          Sellable Content-Blocker Batch
          {after && (
            <Badge variant="outline">
              {after.sellable}/{after.view_rows} sellable · {after.remaining_blocker_count} blockers
            </Badge>
          )}
          {latest?.status === "error" && <Badge variant="destructive">last error</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="text-muted-foreground">
          Räumt nicht-sellable Pakete via Lane A (lesson-readiness recheck), Lane B (empty-demote),
          Lane C (publish-bridge) ab. Cron läuft stündlich als Dry-Run; Live-Lauf nur manuell oder
          per Eskalation. Keine Mutation an Approval/Publish/Stripe.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => trigger.mutate(true)}
            disabled={trigger.isPending}
          >
            {trigger.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FlaskConical className="mr-1 h-3 w-3" />}
            Dry-Run
          </Button>
          <Button
            size="sm"
            onClick={() => trigger.mutate(false)}
            disabled={trigger.isPending}
          >
            <PlayCircle className="mr-1 h-3 w-3" />
            Live (cap 200)
          </Button>
        </div>

        {latest && (
          <div className="rounded-md border p-2 space-y-1">
            <div className="font-medium">Letzter Lauf · {new Date(latest.started_at).toLocaleString()}</div>
            <div className="text-muted-foreground">
              {latest.dry_run ? "dry" : "live"} · {latest.trigger_source} · status {latest.status}
            </div>
            {actions && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="secondary">A enq {actions.lane_a_enqueued ?? 0}</Badge>
                <Badge variant="secondary">B demote {actions.lane_b_demoted ?? 0}</Badge>
                <Badge variant="secondary">C1 enq {actions.lane_c1_enqueued ?? 0}</Badge>
                <Badge variant="secondary">C2 log {actions.lane_c2_logged ?? 0}</Badge>
                {actions.refused_by_gate ? (
                  <Badge variant="outline">refused {actions.refused_by_gate}</Badge>
                ) : null}
                {Array.isArray(actions.errors) && actions.errors.length > 0 ? (
                  <Badge variant="destructive">errors {actions.errors.length}</Badge>
                ) : null}
              </div>
            )}
            {typeof latest.delta_sellable === "number" && (
              <div>
                Δ sellable <strong>{latest.delta_sellable >= 0 ? "+" : ""}{latest.delta_sellable}</strong> · Δ
                blockers <strong>{latest.delta_blockers}</strong>
              </div>
            )}
            {latest.error && <div className="text-destructive">{latest.error}</div>}
          </div>
        )}

        {runsQ.data && runsQ.data.length > 1 && (
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">Verlauf ({runsQ.data.length})</summary>
            <ul className="mt-1 space-y-1">
              {runsQ.data.slice(1).map((r) => (
                <li key={r.id}>
                  {new Date(r.started_at).toLocaleString()} · {r.dry_run ? "dry" : "live"} ·
                  {" "}Δ{r.delta_sellable ?? 0} · rem {r.remaining_blocker_count ?? "?"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
