import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Pure helper — exported for unit tests. Aggregates rows by reason,
 * mapping null/undefined to "UNKNOWN". Stable insertion order.
 */
export function buildReasonClusters(
  rows: Array<{ reason: string | null | undefined }> | null | undefined,
): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const r of rows ?? []) {
    const k = r?.reason ?? "UNKNOWN";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m);
}

type QRow = {
  package_id: string;
  package_key: string | null;
  title: string | null;
  status: string | null;
  reason: string | null;
  since: string | null;
  occurrences: number;
  source_job_type: string | null;
  last_error_excerpt: string | null;
  curriculum_id: string | null;
  manual_bypass: boolean;
};

const REASON_PRESETS = ["all", "STALE_REAP_LOOP_TERMINAL"] as const;

export function BronzeQuarantineCard() {
  const qc = useQueryClient();
  const [reason, setReason] = useState<(typeof REASON_PRESETS)[number]>("all");
  const [requeueReason, setRequeueReason] = useState("manual_admin_requeue");

  const { data, isLoading } = useQuery({
    queryKey: ["bronze-quarantine", reason],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_bronze_quarantine" as any,
        { p_reason: reason === "all" ? null : reason, p_limit: 100 },
      );
      if (error) throw error;
      return (data ?? []) as QRow[];
    },
    refetchInterval: 60_000,
  });

  const requeue = useMutation({
    mutationFn: async (packageId: string) => {
      const { data, error } = await supabase.rpc(
        "admin_requeue_bronze_quarantine" as any,
        { p_package_id: packageId, p_reason: requeueReason },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, packageId) => {
      toast.success(`Re-queue ausgelöst: ${packageId.slice(0, 8)}…`);
      qc.invalidateQueries({ queryKey: ["bronze-quarantine"] });
    },
    onError: (e: any) =>
      toast.error(`Re-queue fehlgeschlagen: ${e?.message ?? "unbekannt"}`),
  });

  // Cluster by reason for filter chips
  const reasonClusters = buildReasonClusters(data);

  return (
    <Card data-testid="bronze-quarantine-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">Bronze Quarantäne</CardTitle>
            <p className="text-xs text-muted-foreground">
              Pakete mit terminalen Heal-Loops · alle Job-Enqueues sind blockiert
              bis manueller Re-Queue.
            </p>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {REASON_PRESETS.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={reason === r ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => setReason(r)}
                data-testid={`bronze-quarantine-filter-${r}`}
              >
                {r === "all" ? "Alle" : r}
              </Button>
            ))}
          </div>
        </div>
        {reasonClusters.length > 0 ? (
          <div className="flex gap-1 mt-2 flex-wrap">
            {reasonClusters.map(([k, n]) => (
              <Badge key={k} variant="muted" className="text-[10px]">
                {k}: {n}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : !(data?.length) ? (
          <p className="text-sm text-muted-foreground">
            Keine Pakete in Quarantäne.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-[480px] overflow-y-auto" data-testid="bronze-quarantine-list">
            {data.map((r) => (
              <div
                key={r.package_id}
                className="border rounded-md p-2 text-xs"
                data-testid="bronze-quarantine-row"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Badge variant="warning">{r.reason ?? "UNKNOWN"}</Badge>
                    <span className="font-mono text-[10px] truncate">
                      {r.package_key ?? r.package_id.slice(0, 8)}
                    </span>
                    {r.title ? (
                      <span className="text-muted-foreground truncate max-w-[280px]">
                        {r.title}
                      </span>
                    ) : null}
                    {r.occurrences > 1 ? (
                      <Badge variant="muted" className="text-[10px]">
                        ×{r.occurrences}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-muted-foreground tabular-nums">
                    {r.since ? new Date(r.since).toLocaleString("de-DE") : "—"}
                  </span>
                </div>
                {r.last_error_excerpt ? (
                  <p
                    className="mt-1 text-[10px] text-muted-foreground truncate"
                    title={r.last_error_excerpt}
                  >
                    {r.source_job_type ? `${r.source_job_type}: ` : ""}
                    {r.last_error_excerpt}
                  </p>
                ) : null}
                <div className="mt-1 flex items-center gap-1 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">
                    status: {r.status ?? "—"}
                  </Badge>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] ml-auto"
                        disabled={requeue.isPending}
                        data-testid="bronze-quarantine-requeue-btn"
                      >
                        ↻ Re-Queue
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Paket aus Quarantäne nehmen?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {`Paket ${r.package_key ?? r.package_id.slice(0, 8)} wird aus der Quarantäne entfernt und ein Integrity-Check enqueuet. Begründung: "${requeueReason}".`}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                          data-testid="bronze-quarantine-requeue-confirm"
                          onClick={() => requeue.mutate(r.package_id)}
                        >
                          Re-Queue bestätigen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <label htmlFor="bq-reason">Re-Queue-Begründung:</label>
          <input
            id="bq-reason"
            value={requeueReason}
            onChange={(e) => setRequeueReason(e.target.value)}
            className="h-7 text-[11px] border rounded px-2 bg-background flex-1 max-w-xs"
            data-testid="bronze-quarantine-requeue-reason"
          />
        </div>
      </CardContent>
    </Card>
  );
}
