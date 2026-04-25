/**
 * PackageDiagnostics
 * ──────────────────
 * Phase 2: Konsolidiertes Diagnose- & Live-Cockpit für ein einzelnes Paket.
 *
 * Sektionen:
 *   1. Root-Cause-Analyse (priorisierte Trigger + Empfehlung)
 *   2. Live-Queue (aktive Jobs + Cancel)
 *   3. Verifikationsreports (Heal-Verlauf)
 *   4. Snapshots + manuelles Rollback
 *   5. Auto-Repair-Limit-Status (Schwellenwarnungen)
 *
 * Pull-Frequenz: 5s über React-Query, manuelle Refresh-Buttons.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { runAdminOpsAction } from "@/integrations/supabase/admin-ops-actions";
import {
  analyzePackageRootCause,
  listVerificationReports,
  listHealSnapshots,
  rollbackHeal,
  getAutoRepairLimitStatus,
  type RootCauseTrigger,
  type HealVerificationReport,
  type HealSnapshot,
  type AutoRepairLimitStatus,
} from "@/lib/admin/heal/healDiagnostics";
import { SuggestRepairActionPanel } from "./SuggestRepairActionPanel";

interface Props {
  packageId: string;
}

interface LiveJob {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  created_at: string;
  locked_at: string | null;
  last_error: string | null;
  lane: string | null;
}

async function fetchLiveJobs(packageId: string): Promise<LiveJob[]> {
  const { data, error } = await (supabase as any)
    .from("job_queue")
    .select("id, job_type, status, attempts, max_attempts, created_at, locked_at, last_error, lane")
    .eq("package_id", packageId)
    .in("status", ["pending", "queued", "processing", "failed"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as LiveJob[];
}

function severityBadgeClass(sev: string): string {
  switch (sev) {
    case "critical":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "high":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "medium":
      return "bg-warning/10 text-warning border-warning/30";
    case "low":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case "processing":
      return "bg-primary/10 text-primary border-primary/30";
    case "failed":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "completed":
      return "bg-success/10 text-success border-success/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

export function PackageDiagnostics({ packageId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<string>("root_cause");

  const rootCauseQ = useQuery({
    queryKey: ["heal", "root_cause", packageId],
    queryFn: () => analyzePackageRootCause(packageId),
    refetchInterval: 10_000,
  });

  const liveJobsQ = useQuery({
    queryKey: ["heal", "live_jobs", packageId],
    queryFn: () => fetchLiveJobs(packageId),
    refetchInterval: 5_000,
  });

  const reportsQ = useQuery({
    queryKey: ["heal", "reports", packageId],
    queryFn: () => listVerificationReports(packageId, 10),
    refetchInterval: 15_000,
  });

  const snapshotsQ = useQuery({
    queryKey: ["heal", "snapshots", packageId],
    queryFn: () => listHealSnapshots(packageId, 10),
    refetchInterval: 30_000,
  });

  const limitsQ = useQuery({
    queryKey: ["heal", "limits", packageId],
    queryFn: () => getAutoRepairLimitStatus(packageId, 70, 90),
    refetchInterval: 15_000,
  });

  const cancelJobMut = useMutation({
    mutationFn: async (jobId: string) =>
      runAdminOpsAction("cancel_zombie_packages", { job_ids: [jobId] }),
    onSuccess: (_, jobId) => {
      toast({ title: "Job storniert", description: `Job ${jobId.slice(0, 8)} wurde abgebrochen.` });
      qc.invalidateQueries({ queryKey: ["heal", "live_jobs", packageId] });
    },
    onError: (err: Error) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  const cancelAllMut = useMutation({
    mutationFn: async () => {
      const ids = (liveJobsQ.data ?? [])
        .filter((j) => j.status === "pending" || j.status === "processing")
        .map((j) => j.id);
      if (!ids.length) return { cancelled: 0 };
      return runAdminOpsAction("cancel_zombie_packages", { job_ids: ids });
    },
    onSuccess: () => {
      toast({ title: "Aktive Jobs storniert", description: "Alle pending/processing Jobs abgebrochen." });
      qc.invalidateQueries({ queryKey: ["heal", "live_jobs", packageId] });
    },
    onError: (err: Error) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  const rollbackMut = useMutation({
    mutationFn: async (snapshotId: string) =>
      rollbackHeal(snapshotId, "admin_ui_phase2", false),
    onSuccess: (res) => {
      toast({
        title: "Rollback ausgeführt",
        description: `${res.steps_restored} Step(s) wiederhergestellt aus Snapshot ${res.snapshot_id.slice(0, 8)}.`,
      });
      qc.invalidateQueries({ queryKey: ["heal", "snapshots", packageId] });
      qc.invalidateQueries({ queryKey: ["heal", "root_cause", packageId] });
    },
    onError: (err: Error) => {
      toast({ title: "Rollback fehlgeschlagen", description: err.message, variant: "destructive" });
    },
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["heal", "root_cause", packageId] });
    qc.invalidateQueries({ queryKey: ["heal", "live_jobs", packageId] });
    qc.invalidateQueries({ queryKey: ["heal", "reports", packageId] });
    qc.invalidateQueries({ queryKey: ["heal", "snapshots", packageId] });
    qc.invalidateQueries({ queryKey: ["heal", "limits", packageId] });
  };

  const triggers: RootCauseTrigger[] = rootCauseQ.data?.triggers ?? [];
  const liveJobs = liveJobsQ.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Paket-Diagnose
          </CardTitle>
          {rootCauseQ.data && (
            <p className="mt-1 text-xs text-muted-foreground">
              {rootCauseQ.data.package_title || packageId.slice(0, 8)} ·{" "}
              <span className="font-mono">{rootCauseQ.data.package_status}</span>
              {rootCauseQ.data.blocked_reason && (
                <>
                  {" · "}
                  <span className="text-destructive">{rootCauseQ.data.blocked_reason}</span>
                </>
              )}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} className="h-8">
          <RefreshCw className="mr-1.5 h-3 w-3" /> Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="root_cause">Root Cause</TabsTrigger>
            <TabsTrigger value="queue">
              Queue {liveJobs.length > 0 && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px]">{liveJobs.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="snapshots">Rollback</TabsTrigger>
            <TabsTrigger value="limits">Limits</TabsTrigger>
          </TabsList>

          {/* ── Root Cause ── */}
          <TabsContent value="root_cause" className="space-y-3 pt-3">
            <SuggestRepairActionPanel packageId={packageId} />
            {rootCauseQ.isLoading && <Skeleton className="h-32 w-full" />}
            {rootCauseQ.error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Analyse fehlgeschlagen</AlertTitle>
                <AlertDescription>{(rootCauseQ.error as Error).message}</AlertDescription>
              </Alert>
            )}
            {rootCauseQ.data && (
              <>
                {triggers.length === 0 ? (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Keine Trigger erkannt</AlertTitle>
                    <AlertDescription>
                      Das Paket zeigt aktuell keine bekannten Blockade-Signale.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    {triggers.map((t) => (
                      <div key={t.code} className="rounded-lg border border-border bg-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={severityBadgeClass(t.severity)}>
                                {t.severity}
                              </Badge>
                              <span className="font-mono text-xs font-semibold">{t.code}</span>
                              {t.count > 0 && (
                                <span className="text-[10px] text-muted-foreground">×{t.count}</span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-foreground">{t.description}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              <span className="font-medium">Empfehlung:</span> {t.recommended_action}
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-foreground">{t.score}</div>
                            <div className="text-[9px] uppercase text-muted-foreground">Score</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {rootCauseQ.data.recommended && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <div className="text-xs font-semibold text-primary">Empfohlene Heal-Strategie</div>
                    <div className="mt-1 text-xs text-foreground">
                      <span className="font-mono">{rootCauseQ.data.recommended.mode}</span>
                      {" → reset from "}
                      <span className="font-mono">{rootCauseQ.data.recommended.reset_from_step}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {rootCauseQ.data.recommended.rationale}
                    </div>
                    {rootCauseQ.data.recommended.enqueue_plan?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {rootCauseQ.data.recommended.enqueue_plan.map((s, i) => (
                          <Badge key={i} variant="outline" className="text-[10px]">
                            {s.action}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Live Queue ── */}
          <TabsContent value="queue" className="space-y-3 pt-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Live · refresh alle 5s · {liveJobs.length} aktive Jobs
              </div>
              {liveJobs.some((j) => j.status === "pending" || j.status === "processing") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => cancelAllMut.mutate()}
                  disabled={cancelAllMut.isPending}
                >
                  {cancelAllMut.isPending ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 h-3 w-3" />
                  )}
                  Alle stornieren
                </Button>
              )}
            </div>
            {liveJobsQ.isLoading && <Skeleton className="h-24 w-full" />}
            {liveJobs.length === 0 && !liveJobsQ.isLoading && (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Keine aktiven Jobs.
              </p>
            )}
            <div className="space-y-1.5">
              {liveJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-border bg-card p-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className={`text-[9px] ${statusBadgeClass(job.status)}`}>
                        {job.status}
                      </Badge>
                      <span className="text-xs font-medium">{job.job_type}</span>
                      {job.lane && (
                        <Badge variant="outline" className="text-[9px]">
                          {job.lane}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                      <span className="font-mono">{job.id.slice(0, 8)}</span>
                      <span>⏱ {formatAge(job.created_at)}</span>
                      <span>
                        {job.attempts}/{job.max_attempts}
                      </span>
                    </div>
                    {job.last_error && (
                      <div className="mt-1 line-clamp-2 rounded bg-destructive/5 p-1.5 font-mono text-[10px] text-destructive">
                        {job.last_error}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                    onClick={() => cancelJobMut.mutate(job.id)}
                    disabled={cancelJobMut.isPending}
                    title="Job stornieren"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ── Verification Reports ── */}
          <TabsContent value="reports" className="space-y-2 pt-3">
            {reportsQ.isLoading && <Skeleton className="h-24 w-full" />}
            {(reportsQ.data ?? []).length === 0 && !reportsQ.isLoading && (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Noch keine Verifikationsreports vorhanden.
              </p>
            )}
            {(reportsQ.data ?? []).map((r: HealVerificationReport) => (
              <div key={r.id} className="rounded-md border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {r.verify_passed ? (
                      <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> verified
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                        <XCircle className="mr-1 h-3 w-3" /> failed
                      </Badge>
                    )}
                    <span className="text-xs font-medium">{r.heal_mode}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("de-DE")}
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <div>
                    <span className="font-medium">Status:</span>{" "}
                    {r.package_status_before} → {r.package_status_after}
                  </div>
                  <div>
                    <span className="font-medium">Steps reset:</span>{" "}
                    {Array.isArray(r.steps_reset) ? r.steps_reset.length : 0}
                  </div>
                  <div>
                    <span className="font-medium">Jobs cancelled:</span> {r.jobs_cancelled}
                  </div>
                  <div>
                    <span className="font-medium">Recovery jobs:</span> {r.recovery_jobs_planned}
                  </div>
                </div>
                {r.reason && (
                  <p className="mt-1 truncate text-[10px] text-muted-foreground" title={r.reason}>
                    {r.reason}
                  </p>
                )}
              </div>
            ))}
          </TabsContent>

          {/* ── Snapshots & Rollback ── */}
          <TabsContent value="snapshots" className="space-y-2 pt-3">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Manuelles Rollback</AlertTitle>
              <AlertDescription className="text-xs">
                Stellt den `package_steps`-Zustand aus dem Snapshot wieder her. Aktive Jobs bleiben unverändert.
              </AlertDescription>
            </Alert>
            {snapshotsQ.isLoading && <Skeleton className="h-24 w-full" />}
            {(snapshotsQ.data ?? []).length === 0 && !snapshotsQ.isLoading && (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Noch keine Snapshots vorhanden.
              </p>
            )}
            {(snapshotsQ.data ?? []).map((s: HealSnapshot) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px]">{s.id.slice(0, 8)}</span>
                    {s.rolled_back_at && (
                      <Badge variant="outline" className="text-[9px]">
                        rolled-back
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={s.reason}>
                    {s.reason} · {new Date(s.created_at).toLocaleString("de-DE")}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={!!s.rolled_back_at || rollbackMut.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Rollback dieses Snapshots wirklich ausführen? package_steps werden zurückgesetzt.",
                      )
                    ) {
                      rollbackMut.mutate(s.id);
                    }
                  }}
                >
                  {rollbackMut.isPending ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1 h-3 w-3" />
                  )}
                  Rollback
                </Button>
              </div>
            ))}
          </TabsContent>

          {/* ── Limit Guard ── */}
          <TabsContent value="limits" className="space-y-2 pt-3">
            {limitsQ.isLoading && <Skeleton className="h-24 w-full" />}
            {limitsQ.data && (
              <>
                <div className="grid grid-cols-4 gap-2">
                  <LimitTile label="Total" value={limitsQ.data.summary.total_steps} />
                  <LimitTile
                    label="Erschöpft"
                    value={limitsQ.data.summary.exhausted}
                    tone={limitsQ.data.summary.exhausted > 0 ? "destructive" : "muted"}
                  />
                  <LimitTile
                    label="Critical"
                    value={limitsQ.data.summary.critical}
                    tone={limitsQ.data.summary.critical > 0 ? "destructive" : "muted"}
                  />
                  <LimitTile
                    label="Warn"
                    value={limitsQ.data.summary.warn}
                    tone={limitsQ.data.summary.warn > 0 ? "warning" : "muted"}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Schwelle warn ≥ {limitsQ.data.thresholds.warn_pct}% · critical ≥{" "}
                  {limitsQ.data.thresholds.critical_pct}% · exhausted = attempts ≥ max
                </p>
                {limitsQ.data.steps_at_risk.length > 0 && (
                  <div className="space-y-1">
                    {limitsQ.data.steps_at_risk.map((s, i) => (
                      <div
                        key={`${s.step_key}-${i}`}
                        className="flex items-center justify-between rounded border border-border bg-card p-2"
                      >
                        <div>
                          <div className="text-xs font-medium">{s.step_key}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {s.attempts}/{s.max_attempts} ({s.attempts_pct}%) · hard_fail={s.hard_fail_count}
                          </div>
                        </div>
                        <Badge variant="outline" className={severityBadgeClass(s.severity)}>
                          {s.severity}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function LimitTile({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "warning" | "destructive";
}) {
  const cls =
    tone === "destructive"
      ? "border-destructive/30 bg-destructive/5 text-destructive"
      : tone === "warning"
        ? "border-warning/30 bg-warning/5 text-warning"
        : "border-border bg-muted/30 text-foreground";
  return (
    <div className={`rounded-md border p-2 text-center ${cls}`}>
      <div className="text-base font-bold">{value}</div>
      <div className="text-[9px] uppercase">{label}</div>
    </div>
  );
}
