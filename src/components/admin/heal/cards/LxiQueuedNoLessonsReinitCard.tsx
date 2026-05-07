/**
 * LXI Queued-No-Lessons Reinit Card
 * ─────────────────────────────────
 * Sicherer Admin-Flow für `admin_lxi_reinit_queued_no_lessons_batch`.
 *
 * - Dry-Run Preview (bis zu 27 Kandidaten)
 * - Real-Run hart auf 10 gecapped, mit Confirm-Dialog
 * - Auto-Refetch nach Run: gate_no_lessons-Status, frische Jobs, Heal-Log
 * - Klickbare Paketzeile → Detaildialog mit Step-Verteilung + letzte Jobs + Heal-Log
 *
 * Wichtig:
 *   - Keine Cron, kein Auto-Run.
 *   - Kein p_limit > 10 im UI.
 *   - Bei `no_effect` keine Erfolgsmeldung.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, ArrowDown, ArrowUp, FlaskConical, Loader2, PlayCircle, RefreshCw, Sparkles } from "lucide-react";

type ReinitOne = {
  ok?: boolean;
  dry_run?: boolean;
  package_id: string;
  track?: string;
  skipped_steps_total?: number;
  non_applicable_steps?: number;
  reset_candidates?: Array<{ step_id: string; step_key: string }>;
  expected_first_step?: string;
  skip_reason?: string | null;
  nudge_result?: Record<string, unknown>;
};

type BatchResult = {
  ok: boolean;
  dry_run: boolean;
  candidates_count?: number;
  applied?: number;
  no_effect?: number;
  wip_before?: number;
  reason?: string;
  results: ReinitOne[];
};

type PkgMeta = { title: string | null };

const REAL_RUN_CAP = 10;
const DRY_RUN_LIMIT = 27;

export function LxiQueuedNoLessonsReinitCard() {
  const qc = useQueryClient();
  const [dryResult, setDryResult] = useState<BatchResult | null>(null);
  const [lastRealResult, setLastRealResult] = useState<BatchResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailPkg, setDetailPkg] = useState<string | null>(null);
  const [attemptsPkg, setAttemptsPkg] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "eligible" | "skipped">("eligible");
  const [skipReasonFilter, setSkipReasonFilter] = useState<string>("__all__");
  const [sortKey, setSortKey] = useState<"priority" | "track" | "skipped" | "reset">("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Live counts post-action
  const gateStatus = useQuery({
    queryKey: ["lxi-gate-no-lessons-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_learning_integrity_audit" as never)
        .select("status,gate_no_lessons");
      if (error) throw error;
      const rows = (data ?? []) as Array<{ status: string; gate_no_lessons: boolean }>;
      const map = new Map<string, number>();
      for (const r of rows) {
        if (r.gate_no_lessons) {
          map.set(r.status, (map.get(r.status) ?? 0) + 1);
        }
      }
      return Array.from(map.entries()).map(([status, count]) => ({ status, count }));
    },
    refetchInterval: 30_000,
  });

  const wip = useQuery({
    queryKey: ["lxi-wip-building"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("course_packages")
        .select("id", { count: "exact", head: true })
        .eq("status", "building")
        .eq("archived", false);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });

  const recentJobs = useQuery({
    queryKey: ["lxi-recent-jobs"],
    enabled: !!lastRealResult,
    queryFn: async () => {
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const { data, error } = await supabase
        .from("job_queue")
        .select("job_type,status")
        .gte("created_at", since);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of data ?? []) {
        const k = `${r.job_type}:${r.status}`;
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      return Array.from(map.entries())
        .map(([k, n]) => ({ key: k, count: n }))
        .sort((a, b) => b.count - a.count);
    },
    refetchInterval: 20_000,
  });

  const recentHealLog = useQuery({
    queryKey: ["lxi-recent-heal-log"],
    enabled: !!lastRealResult,
    queryFn: async () => {
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const { data, error } = await supabase
        .from("auto_heal_log")
        .select("action_type,result_status")
        .ilike("action_type", "lxi_queued_no_lessons%")
        .gte("created_at", since);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of data ?? []) {
        const k = `${r.action_type}:${r.result_status}`;
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      return Array.from(map.entries()).map(([k, n]) => ({ key: k, count: n }));
    },
    refetchInterval: 20_000,
  });

  // Resolve titles for displayed packages
  const pkgIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of dryResult?.results ?? []) ids.add(r.package_id);
    for (const r of lastRealResult?.results ?? []) ids.add(r.package_id);
    return Array.from(ids);
  }, [dryResult, lastRealResult]);

  const pkgTitles = useQuery({
    queryKey: ["lxi-pkg-titles", pkgIds.sort().join(",")],
    enabled: pkgIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_packages")
        .select("id,title")
        .in("id", pkgIds);
      if (error) throw error;
      const m = new Map<string, PkgMeta>();
      for (const r of data ?? []) m.set(r.id, { title: r.title });
      return m;
    },
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_lxi_reinit_queued_no_lessons_batch" as never,
        { p_limit: DRY_RUN_LIMIT, p_dry_run: true } as never,
      );
      if (error) throw error;
      return data as unknown as BatchResult;
    },
    onSuccess: (data) => {
      setDryResult(data);
      toast({
        title: "Dry-Run abgeschlossen",
        description: `${data.candidates_count ?? data.results?.length ?? 0} Kandidaten`,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Dry-Run fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const realRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_lxi_reinit_queued_no_lessons_batch" as never,
        { p_limit: REAL_RUN_CAP, p_dry_run: false } as never,
      );
      if (error) throw error;
      return data as unknown as BatchResult;
    },
    onSuccess: (data) => {
      setLastRealResult(data);
      const applied = data.applied ?? 0;
      const noEffect = data.no_effect ?? 0;
      if (applied > 0) {
        toast({
          title: "Re-Init angewandt",
          description: `applied=${applied}, no_effect=${noEffect}`,
        });
      } else {
        toast({
          title: "Re-Init: keine Wirkung",
          description: `Alle ${noEffect} Pakete übersprungen`,
          variant: "destructive",
        });
      }
      qc.invalidateQueries({ queryKey: ["lxi-gate-no-lessons-status"] });
      qc.invalidateQueries({ queryKey: ["lxi-wip-building"] });
      qc.invalidateQueries({ queryKey: ["lxi-recent-jobs"] });
      qc.invalidateQueries({ queryKey: ["lxi-recent-heal-log"] });
    },
    onError: (e: Error) =>
      toast({ title: "Real-Run fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  // Single-package retry — runs the per-pkg RPC directly (real-run, no batch cap)
  const singleReinit = useMutation({
    mutationFn: async (packageId: string) => {
      const { data, error } = await supabase.rpc(
        "admin_lxi_reinit_skipped_steps_for_lesson_track" as never,
        { p_package_id: packageId, p_dry_run: false } as never,
      );
      if (error) throw error;
      return data as unknown as ReinitOne & { attempt_id?: string };
    },
    onSuccess: (data) => {
      if (data?.ok) {
        toast({
          title: "Reset angewandt",
          description: data.attempt_id ? `attempt=${data.attempt_id.slice(0, 8)}…` : "ok",
        });
      } else {
        toast({
          title: "Reset ohne Wirkung",
          description: data?.skip_reason ?? "no_effect",
          variant: "destructive",
        });
      }
      qc.invalidateQueries({ queryKey: ["lxi-gate-no-lessons-status"] });
      qc.invalidateQueries({ queryKey: ["lxi-recent-heal-log"] });
      qc.invalidateQueries({ queryKey: ["lxi-heal-attempts"] });
    },
    onError: (e: Error) =>
      toast({ title: "Reset fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const dryEligible = (dryResult?.results ?? []).filter(
    (r) => !r.skip_reason && (r.reset_candidates?.length ?? 0) > 0,
  );
  const drySkipped = (dryResult?.results ?? []).filter((r) => !!r.skip_reason);
  const wipWarn = (wip.data ?? 0) >= 60;

  // Priority score: deterministic. Higher = better real-run candidate.
  // - eligible (no skip_reason) → +100
  // - has bootstrap reset_candidate → +50
  // - more reset_candidates → +5 each (cap 25)
  // - fewer skipped_steps_total = closer to clean → minor bonus
  // - non_applicable just gives confidence (track-aware), small bonus
  function priorityFor(r: ReinitOne): number {
    if (r.skip_reason) return 0;
    let p = 100;
    p += (r.reset_candidates?.length ?? 0) > 0 ? 50 : 0;
    p += Math.min(25, (r.reset_candidates?.length ?? 0) * 5);
    p += Math.max(0, 30 - (r.skipped_steps_total ?? 0));
    p += Math.min(10, (r.non_applicable_steps ?? 0) * 2);
    return p;
  }
  function priorityLabel(p: number): { label: string; tone: string } {
    if (p >= 170) return { label: "hoch", tone: "text-success" };
    if (p >= 130) return { label: "mittel", tone: "text-warning" };
    if (p > 0) return { label: "niedrig", tone: "text-text-muted" };
    return { label: "—", tone: "text-text-muted" };
  }

  const skipReasonOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of dryResult?.results ?? []) if (r.skip_reason) s.add(r.skip_reason);
    return Array.from(s).sort();
  }, [dryResult]);

  const visibleRows = useMemo(() => {
    let rows = (dryResult?.results ?? []).map((r) => ({ ...r, _priority: priorityFor(r) }));
    if (filterMode === "eligible") rows = rows.filter((r) => !r.skip_reason);
    else if (filterMode === "skipped") rows = rows.filter((r) => !!r.skip_reason);
    if (skipReasonFilter !== "__all__") rows = rows.filter((r) => r.skip_reason === skipReasonFilter);
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const va =
        sortKey === "track" ? (a.track ?? "") :
        sortKey === "skipped" ? (a.skipped_steps_total ?? 0) :
        sortKey === "reset" ? (a.reset_candidates?.length ?? 0) :
        a._priority;
      const vb =
        sortKey === "track" ? (b.track ?? "") :
        sortKey === "skipped" ? (b.skipped_steps_total ?? 0) :
        sortKey === "reset" ? (b.reset_candidates?.length ?? 0) :
        b._priority;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return rows;
  }, [dryResult, filterMode, skipReasonFilter, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "track" ? "asc" : "desc"); }
  }
  const sortIcon = (key: typeof sortKey) =>
    sortKey === key ? (sortDir === "asc" ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />) : null;

  return (
    <Card className="shadow-elev-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="h-4 w-4 text-primary" />
          LXI — Queued No-Lessons Reinit
          <Badge variant="outline" className="ml-2 font-normal">
            Bootstrap: scaffold_learning_course
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Setzt für eligible <code>queued</code>-Pakete mit <code>gate_no_lessons=true</code> den
          Lesson-Bootstrap-Step von <code>skipped</code> → <code>queued</code> und nudged das
          Paket. Governance-Steps und nicht-applicable Steps werden nie verändert. Real-Run hart
          auf {REAL_RUN_CAP} Pakete gecapped.
        </p>

        {wipWarn && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>WIP-Cap erreicht ({wip.data})</AlertTitle>
            <AlertDescription>Real-Run blockiert, bis Building-WIP unter 60 fällt.</AlertDescription>
          </Alert>
        )}

        {/* Action bar */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => dryRun.mutate()}
            disabled={dryRun.isPending}
          >
            {dryRun.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="h-4 w-4" />
            )}
            Dry-Run (bis {DRY_RUN_LIMIT})
          </Button>
          <Button
            size="sm"
            disabled={!dryResult || realRun.isPending || wipWarn}
            onClick={() => setConfirmOpen(true)}
          >
            {realRun.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            Real-Run (max {REAL_RUN_CAP})
          </Button>
        </div>

        {/* Dry-Run summary */}
        {dryResult && (
          <div className="rounded-lg border border-border bg-surface-subtle p-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                Candidates: <strong>{dryResult.candidates_count ?? dryResult.results?.length ?? 0}</strong>
              </span>
              <span>
                Reset-bereit: <strong>{dryEligible.length}</strong>
              </span>
              <span>
                Skip-Reasons: <strong>{drySkipped.length}</strong>
              </span>
              <span>
                Empfehlung Real-Run:{" "}
                <strong className={dryEligible.length > 0 ? "text-success" : "text-warning"}>
                  {dryEligible.length > 0 ? "ja" : "nein"}
                </strong>
              </span>
            </div>
          </div>
        )}

        {/* Live monitoring */}
        <div className="grid gap-3 md:grid-cols-3">
          <MetricBox label="gate_no_lessons (per Status)" loading={gateStatus.isLoading}>
            {(gateStatus.data ?? []).length === 0 ? (
              <span className="text-text-muted">0</span>
            ) : (
              <ul className="space-y-0.5 text-xs">
                {(gateStatus.data ?? []).map((s) => (
                  <li key={s.status} className="flex justify-between">
                    <span>{s.status}</span>
                    <strong>{s.count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </MetricBox>
          <MetricBox label="WIP building" loading={wip.isLoading}>
            <span className={wipWarn ? "text-destructive" : ""}>{wip.data ?? 0} / 60</span>
          </MetricBox>
          <MetricBox label="Last Real-Run" loading={false}>
            {lastRealResult ? (
              <ul className="space-y-0.5 text-xs">
                <li>applied: <strong>{lastRealResult.applied ?? 0}</strong></li>
                <li>no_effect: <strong>{lastRealResult.no_effect ?? 0}</strong></li>
                <li>wip_before: {lastRealResult.wip_before ?? "—"}</li>
              </ul>
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </MetricBox>
        </div>

        {/* Candidate table */}
        {dryResult && (dryResult.results?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-subtle px-3 py-2 text-xs text-text-muted">
              <span className="font-medium">
                Kandidaten ({visibleRows.length} sichtbar / {dryResult.results.length} gesamt)
              </span>
              <div className="flex items-center gap-2">
                <Select value={filterMode} onValueChange={(v) => setFilterMode(v as typeof filterMode)}>
                  <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle</SelectItem>
                    <SelectItem value="eligible">Nur eligible</SelectItem>
                    <SelectItem value="skipped">Nur skipped</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={skipReasonFilter} onValueChange={setSkipReasonFilter}>
                  <SelectTrigger className="h-7 w-[180px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Alle Skip-Reasons</SelectItem>
                    {skipReasonOptions.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface text-text-muted">
                  <tr>
                    <th className="px-2 py-1 text-left">Paket</th>
                    <th className="cursor-pointer px-2 py-1 text-left" onClick={() => toggleSort("track")}>
                      Track {sortIcon("track")}
                    </th>
                    <th className="cursor-pointer px-2 py-1 text-right" onClick={() => toggleSort("priority")}>
                      Prio {sortIcon("priority")}
                    </th>
                    <th className="cursor-pointer px-2 py-1 text-right" onClick={() => toggleSort("skipped")}>
                      Skipped {sortIcon("skipped")}
                    </th>
                    <th className="px-2 py-1 text-right">N/A</th>
                    <th className="cursor-pointer px-2 py-1 text-right" onClick={() => toggleSort("reset")}>
                      Reset {sortIcon("reset")}
                    </th>
                    <th className="px-2 py-1 text-left">First-Step</th>
                    <th className="px-2 py-1 text-left">Skip-Reason</th>
                    <th className="px-2 py-1 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const title = pkgTitles.data?.get(r.package_id)?.title ?? r.package_id;
                    const prio = priorityLabel(r._priority);
                    const eligible = !r.skip_reason;
                    return (
                      <tr
                        key={r.package_id}
                        onClick={() => setDetailPkg(r.package_id)}
                        className="cursor-pointer border-t border-border-subtle hover:bg-surface-hover"
                      >
                        <td className="px-2 py-1 font-medium">{title}</td>
                        <td className="px-2 py-1 text-text-muted">{r.track ?? "—"}</td>
                        <td className={`px-2 py-1 text-right ${prio.tone}`}>
                          {prio.label} <span className="text-text-muted">({r._priority})</span>
                        </td>
                        <td className="px-2 py-1 text-right">{r.skipped_steps_total ?? 0}</td>
                        <td className="px-2 py-1 text-right">{r.non_applicable_steps ?? 0}</td>
                        <td className="px-2 py-1 text-right">{r.reset_candidates?.length ?? 0}</td>
                        <td className="px-2 py-1 text-text-muted">{r.expected_first_step ?? "—"}</td>
                        <td className="px-2 py-1">
                          {r.skip_reason ? (
                            <Badge variant="outline" className="font-mono text-[10px]">{r.skip_reason}</Badge>
                          ) : (
                            <span className="text-success">eligible</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              disabled={!eligible || singleReinit.isPending}
                              onClick={() => singleReinit.mutate(r.package_id)}
                              title="Reset für dieses Paket erneut versuchen"
                            >
                              {singleReinit.isPending && singleReinit.variables === r.package_id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <RefreshCw className="h-3 w-3" />}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => setAttemptsPkg(r.package_id)}
                              title="Audit-Log + Rollback"
                            >
                              Audit
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={9} className="px-2 py-4 text-center text-text-muted">Keine Treffer für aktuelle Filter</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}


        {/* Live job & log breakdown after real-run */}
        {lastRealResult && (
          <div className="grid gap-3 md:grid-cols-2">
            <MetricBox label="Neue Jobs (15 min)" loading={recentJobs.isLoading}>
              {(recentJobs.data ?? []).length === 0 ? (
                <span className="text-text-muted">0</span>
              ) : (
                <ul className="max-h-40 overflow-auto space-y-0.5 text-xs">
                  {(recentJobs.data ?? []).slice(0, 12).map((r) => (
                    <li key={r.key} className="flex justify-between gap-2">
                      <span className="truncate font-mono text-[10px]">{r.key}</span>
                      <strong>{r.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </MetricBox>
            <MetricBox label="Heal-Log (15 min)" loading={recentHealLog.isLoading}>
              {(recentHealLog.data ?? []).length === 0 ? (
                <span className="text-text-muted">0</span>
              ) : (
                <ul className="max-h-40 overflow-auto space-y-0.5 text-xs">
                  {(recentHealLog.data ?? []).map((r) => (
                    <li key={r.key} className="flex justify-between gap-2">
                      <span className="truncate font-mono text-[10px]">{r.key}</span>
                      <strong>{r.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </MetricBox>
          </div>
        )}
      </CardContent>

      {/* Confirm */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Real-Run bestätigen</AlertDialogTitle>
            <AlertDialogDescription>
              Maximal {REAL_RUN_CAP} Pakete werden reinitialisiert (Bootstrap-Step skipped→queued
              + Nudge). Keine published Pakete werden geändert. Fortfahren?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                realRun.mutate();
              }}
            >
              Bestätigen ({REAL_RUN_CAP})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Detail */}
      <PackageDetailDialog
        packageId={detailPkg}
        title={detailPkg ? pkgTitles.data?.get(detailPkg)?.title ?? null : null}
        onClose={() => setDetailPkg(null)}
      />

      {/* Audit + Rollback */}
      <HealAttemptsDialog
        packageId={attemptsPkg}
        title={attemptsPkg ? pkgTitles.data?.get(attemptsPkg)?.title ?? null : null}
        onClose={() => setAttemptsPkg(null)}
      />
    </Card>
  );
}

function MetricBox({
  label,
  loading,
  children,
}: {
  label: string;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 text-sm">{loading ? <Skeleton className="h-4 w-16" /> : children}</div>
    </div>
  );
}

function PackageDetailDialog({
  packageId,
  title,
  onClose,
}: {
  packageId: string | null;
  title: string | null;
  onClose: () => void;
}) {
  const open = !!packageId;
  const [aiOpen, setAiOpen] = useState(false);

  const aiAnalysis = useQuery({
    queryKey: ["lxi-pkg-ai", packageId],
    enabled: open && aiOpen && !!packageId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-lxi-package-analyzer", {
        body: { package_id: packageId },
      });
      if (error) throw error;
      return data as { diagnosis: string; heuristic: { recommendation: string; confidence: string; reasoning: string } };
    },
  });

  const steps = useQuery({
    queryKey: ["pkg-steps", packageId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_steps")
        .select("step_key,status,attempts,last_error,updated_at")
        .eq("package_id", packageId!)
        .order("step_key");
      if (error) throw error;
      return data ?? [];
    },
  });

  const jobs = useQuery({
    queryKey: ["pkg-jobs", packageId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_queue")
        .select("job_type,status,created_at,updated_at,last_error")
        .eq("package_id", packageId!)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  const log = useQuery({
    queryKey: ["pkg-heal-log", packageId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auto_heal_log")
        .select("action_type,result_status,result_detail,created_at")
        .eq("target_id", packageId!)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  const stepDist = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of steps.data ?? []) m.set(s.status, (m.get(s.status) ?? 0) + 1);
    return Array.from(m.entries());
  }, [steps.data]);

  const bootstrap = (steps.data ?? []).find((s) => s.step_key === "scaffold_learning_course");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Paket-Diagnose
            <span className="ml-2 text-text-muted">{title ?? packageId}</span>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-3">
          <div className="space-y-4 text-xs">
            {/* AI analysis */}
            <section className="rounded-lg border border-border bg-surface-subtle p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-muted">
                  <Sparkles className="h-3 w-3" /> KI-Diagnose
                </div>
                {!aiOpen ? (
                  <Button size="sm" variant="outline" onClick={() => setAiOpen(true)} disabled={!packageId}>
                    Analyse starten
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => aiAnalysis.refetch()} disabled={aiAnalysis.isFetching}>
                    {aiAnalysis.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  </Button>
                )}
              </div>
              {!aiOpen ? (
                <p className="text-text-muted">Klicke auf „Analyse starten“ für KI-gestützte Empfehlung (Lovable AI).</p>
              ) : aiAnalysis.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : aiAnalysis.isError ? (
                <span className="text-destructive">Fehler: {(aiAnalysis.error as Error).message}</span>
              ) : aiAnalysis.data ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Empfehlung: {aiAnalysis.data.heuristic.recommendation}</Badge>
                    <Badge variant="outline">Confidence: {aiAnalysis.data.heuristic.confidence}</Badge>
                  </div>
                  <p className="text-text-muted italic">{aiAnalysis.data.heuristic.reasoning}</p>
                  <pre className="whitespace-pre-wrap rounded bg-surface p-2 text-[11px]">{aiAnalysis.data.diagnosis}</pre>
                </div>
              ) : null}
            </section>
            <section>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">
                Bootstrap-Step
              </div>
              {bootstrap ? (
                <div>
                  <Badge variant="outline">{bootstrap.status}</Badge>{" "}
                  attempts={bootstrap.attempts}{" "}
                  {bootstrap.last_error ? (
                    <span className="text-destructive">{bootstrap.last_error}</span>
                  ) : null}
                </div>
              ) : (
                <span className="text-text-muted">nicht gefunden</span>
              )}
            </section>

            <section>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">
                Step-Status-Verteilung
              </div>
              <div className="flex flex-wrap gap-2">
                {stepDist.map(([s, n]) => (
                  <Badge key={s} variant="outline">
                    {s}: {n}
                  </Badge>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">
                Letzte Jobs
              </div>
              {(jobs.data ?? []).length === 0 ? (
                <span className="text-text-muted">keine</span>
              ) : (
                <ul className="space-y-1">
                  {(jobs.data ?? []).map((j, i) => (
                    <li key={i} className="rounded border border-border-subtle px-2 py-1">
                      <div className="flex justify-between">
                        <span className="font-mono">{j.job_type}</span>
                        <Badge variant="outline">{j.status}</Badge>
                      </div>
                      <div className="text-text-muted">
                        {new Date(j.created_at).toLocaleString()}
                      </div>
                      {j.last_error && (
                        <div className="text-destructive">{j.last_error}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">
                Heal-Log
              </div>
              {(log.data ?? []).length === 0 ? (
                <span className="text-text-muted">keine</span>
              ) : (
                <ul className="space-y-1">
                  {(log.data ?? []).map((l, i) => (
                    <li key={i} className="rounded border border-border-subtle px-2 py-1">
                      <div className="flex justify-between">
                        <span className="font-mono">{l.action_type}</span>
                        <Badge variant="outline">{l.result_status}</Badge>
                      </div>
                      <div className="text-text-muted">
                        {new Date(l.created_at).toLocaleString()}
                      </div>
                      {l.result_detail && <div>{l.result_detail}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
