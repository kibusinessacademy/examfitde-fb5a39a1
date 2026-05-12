/**
 * DeferredJobsPullForwardCard — Admin action to pull deferred jobs forward.
 * Honors admin_terminal flag + bronze-lock; audited via auto_heal_log.
 * Includes 10-min cooldown (server-enforced) and pre-pull preview list.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { FastForward, AlertTriangle, Eye } from "lucide-react";

type Cluster = {
  job_type: string;
  worker_pool: string;
  deferred_count: number;
  earliest_run_after: string;
  latest_run_after: string;
  earliest_in_sec: number;
  latest_in_sec: number;
  high_attempt_count: number;
};

type PreviewRow = {
  job_id: string;
  job_type: string;
  worker_pool: string;
  package_id: string | null;
  run_after: string;
  in_seconds: number;
  attempts: number;
  is_admin_terminal: boolean;
  is_bronze_locked: boolean;
  would_pull: boolean;
  skip_reason: string | null;
};

function fmtIn(sec: number) {
  const s = Math.max(0, Number(sec) || 0);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export function DeferredJobsPullForwardCard() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<{ job_type: string | null; worker_pool: string | null } | null>(null);
  const [maxJobs, setMaxJobs] = useState(50);
  const [reason, setReason] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const clusters = useQuery({
    queryKey: ["deferred-jobs-clusters"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_deferred_jobs_clusters" as any);
      if (error) throw error;
      return (data ?? []) as Cluster[];
    },
    refetchInterval: 30_000,
  });

  const preview = useQuery({
    queryKey: ["deferred-jobs-preview", selected, maxJobs],
    enabled: showPreview && !!selected,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_preview_deferred_jobs_pull" as any, {
        p_job_type: selected?.job_type ?? null,
        p_worker_pool: selected?.worker_pool ?? null,
        p_max_jobs: maxJobs,
      } as any);
      if (error) throw error;
      return (data ?? []) as PreviewRow[];
    },
  });

  const mut = useMutation({
    mutationFn: async (vars: { dry_run: boolean }) => {
      const { data, error } = await supabase.rpc("admin_pull_deferred_jobs_forward" as any, {
        p_job_type: selected?.job_type ?? null,
        p_worker_pool: selected?.worker_pool ?? null,
        p_max_jobs: maxJobs,
        p_reason: reason,
        p_dry_run: vars.dry_run,
      } as any);
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res, vars) => {
      toast({
        title: vars.dry_run ? "Dry-Run abgeschlossen" : "Deferred Jobs vorgezogen",
        description: `${res.updated_count}/${res.total_eligible} Jobs (Bronze-Skip: ${res.bronze_skipped})`,
      });
      if (!vars.dry_run) {
        qc.invalidateQueries({ queryKey: ["deferred-jobs-clusters"] });
        qc.invalidateQueries({ queryKey: ["deferred-jobs-preview"] });
        qc.invalidateQueries({ queryKey: ["queue-throughput-v2"] });
      }
    },
    onError: (e: any) => {
      const msg = String(e?.message || e);
      const friendly = msg.includes("cooldown_active")
        ? "Cooldown aktiv: Bitte 10 Minuten warten zwischen Pulls."
        : msg;
      toast({ title: "Fehler", description: friendly, variant: "destructive" });
    },
  });

  const total = (clusters.data ?? []).reduce((s, c) => s + Number(c.deferred_count), 0);
  const selectedCluster = (clusters.data ?? []).find(
    (c) => selected && c.job_type === selected.job_type && c.worker_pool === selected.worker_pool,
  );
  const previewRows = preview.data ?? [];
  const previewSkip = previewRows.filter((r) => !r.would_pull).length;
  const previewPull = previewRows.length - previewSkip;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FastForward className="h-4 w-4" />
            Deferred Jobs vorziehen
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Setzt <code>run_after = now()</code> für absichtlich verzögerte Jobs. Skipt admin_terminal &amp; bronze-lock.
            10-Min-Cooldown pro Admin.
          </p>
        </div>
        <Badge variant="outline" className="tabular-nums">{total} deferred</Badge>
      </div>

      {clusters.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (clusters.data?.length ?? 0) === 0 ? (
        <p className="text-xs text-text-muted py-4 text-center">Keine deferred Jobs.</p>
      ) : (
        <div className="space-y-1.5 mb-4">
          {clusters.data!.map((c) => {
            const isSel = selected?.job_type === c.job_type && selected?.worker_pool === c.worker_pool;
            return (
              <button
                key={`${c.job_type}-${c.worker_pool}`}
                type="button"
                onClick={() => {
                  setSelected({ job_type: c.job_type, worker_pool: c.worker_pool });
                  setShowPreview(false);
                }}
                className={`w-full text-left rounded-md border p-2 text-xs transition-colors ${
                  isSel ? "border-primary bg-surface-sunken" : "border-border hover:bg-surface-sunken"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-mono">{c.job_type}</span>
                    <span className="text-text-muted">pool: {c.worker_pool}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.high_attempt_count > 0 && (
                      <Badge variant="warning" className="text-[10px]">
                        <AlertTriangle className="h-3 w-3 mr-0.5" />
                        {c.high_attempt_count} hoher Attempt
                      </Badge>
                    )}
                    <Badge variant="secondary" className="tabular-nums">{c.deferred_count}</Badge>
                    <span className="text-text-muted tabular-nums">in {fmtIn(c.earliest_in_sec)}</span>
                  </div>
                </div>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setSelected({ job_type: null, worker_pool: null });
              setShowPreview(false);
            }}
            className={`w-full text-left rounded-md border p-2 text-xs transition-colors ${
              selected && selected.job_type === null && selected.worker_pool === null
                ? "border-primary bg-surface-sunken"
                : "border-dashed border-border hover:bg-surface-sunken"
            }`}
          >
            <span className="text-text-muted">Alle (kein Filter — limitiert auf max_jobs)</span>
          </button>
        </div>
      )}

      {selectedCluster && selectedCluster.high_attempt_count > 0 && (
        <div className="mb-3 rounded-md border border-warning-border bg-warning-bg-subtle p-2 text-xs text-warning flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Achtung: {selectedCluster.high_attempt_count} Job(s) mit ≥3 Attempts. Vorziehen kann Retry-Loops beschleunigen.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <Label htmlFor="max-jobs" className="text-xs">Max Jobs (1–200)</Label>
          <Input
            id="max-jobs"
            type="number"
            min={1}
            max={200}
            value={maxJobs}
            onChange={(e) => setMaxJobs(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
          />
        </div>
        <div>
          <Label htmlFor="reason" className="text-xs">Grund (Pflicht, ≥5)</Label>
          <Input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="z. B. Launch-Smoke benötigt Tail-Run"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 justify-end flex-wrap">
        <Button
          variant="outline"
          size="sm"
          disabled={!selected}
          onClick={() => setShowPreview((v) => !v)}
        >
          <Eye className="h-4 w-4 mr-1" />
          {showPreview ? "Vorschau ausblenden" : "Vorschau"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selected || reason.trim().length < 5 || mut.isPending}
          onClick={() => mut.mutate({ dry_run: true })}
        >
          Dry-Run
        </Button>
        <Button
          size="sm"
          disabled={!selected || reason.trim().length < 5 || mut.isPending}
          onClick={() => mut.mutate({ dry_run: false })}
        >
          Vorziehen
        </Button>
      </div>

      {showPreview && selected && (
        <div className="mt-3 pt-2 border-t border-border">
          <div className="flex items-center justify-between mb-2 text-xs">
            <span className="font-semibold">Vorziehliste</span>
            <span className="text-text-muted tabular-nums">
              {previewRows.length} Jobs · pull: <b className="text-success">{previewPull}</b> · skip:{" "}
              <b className="text-warning">{previewSkip}</b>
            </span>
          </div>
          {preview.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : previewRows.length === 0 ? (
            <p className="text-xs text-text-muted py-2 text-center">Keine Jobs in diesem Filter.</p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-md border border-border">
              <table className="w-full text-[11px] tabular-nums">
                <thead className="bg-surface-sunken sticky top-0">
                  <tr className="text-left">
                    <th className="px-2 py-1 font-medium">Job</th>
                    <th className="px-2 py-1 font-medium">in</th>
                    <th className="px-2 py-1 font-medium">Att.</th>
                    <th className="px-2 py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.job_id} className="border-t border-border">
                      <td className="px-2 py-1 font-mono">{r.job_id.slice(0, 8)}…</td>
                      <td className="px-2 py-1">{fmtIn(r.in_seconds)}</td>
                      <td className={`px-2 py-1 ${r.attempts >= 3 ? "text-warning font-semibold" : ""}`}>
                        {r.attempts}
                      </td>
                      <td className="px-2 py-1">
                        {r.would_pull ? (
                          <Badge variant="success" className="text-[10px]">pull</Badge>
                        ) : (
                          <Badge variant="warning" className="text-[10px]">skip: {r.skip_reason}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mut.data && (
        <div className="mt-3 pt-2 border-t border-border text-xs space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={mut.data.dry_run ? "outline" : "success"}>
              {mut.data.dry_run ? "Dry-Run" : "Ausgeführt"}
            </Badge>
            <span className="font-mono text-text-muted">run_id: {String(mut.data.run_id).slice(0, 8)}…</span>
          </div>
          <div className="text-text-secondary">
            updated: <b>{mut.data.updated_count}</b> · eligible: {mut.data.total_eligible} ·
            cap: {mut.data.cap_applied} · bronze-skip: {mut.data.bronze_skipped}
          </div>
        </div>
      )}
    </Card>
  );
}
