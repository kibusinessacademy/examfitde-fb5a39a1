/**
 * Blocker Operations — /admin/ops/blocker-ops
 *
 * Single Pane of Glass für die 4 echten Publish-Blocker:
 *  • Counts + Drill-down (package, defer_reason)
 *  • Targeted Recheck (Dry-Run + Execute) mit Before/After Snapshot
 *  • Deferred-Resolved Alerts (sicheres Re-Enqueue)
 *  • Reaper-Config (Threshold, Cron, Max-Cancels) + Audit-Log
 *  • Auto-Selector für package_repair_exam_pool_*
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, Clock, Pause, Play, RefreshCw, Settings,
  ShieldAlert, Sparkles, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type BlockerKey =
  | "INTEGRITY_NEVER_CHECKED"
  | "INTEGRITY_DEFERRED"
  | "QUALITY_COUNCIL_PENDING"
  | "EXAM_POOL_TOO_SMALL";

const BLOCKER_META: Record<BlockerKey, { label: string; icon: any; tone: string }> = {
  INTEGRITY_NEVER_CHECKED: { label: "Never Checked", icon: Clock, tone: "bg-muted text-muted-foreground" },
  INTEGRITY_DEFERRED: { label: "Deferred", icon: Pause, tone: "bg-secondary text-secondary-foreground" },
  QUALITY_COUNCIL_PENDING: { label: "Council Pending", icon: Clock, tone: "bg-secondary text-secondary-foreground" },
  EXAM_POOL_TOO_SMALL: { label: "Exam Pool Too Small", icon: AlertTriangle, tone: "bg-destructive/15 text-destructive" },
};

interface DashboardRow {
  package_id: string;
  curriculum_id: string | null;
  course_title: string | null;
  curriculum_title: string | null;
  package_track: string | null;
  package_status: string | null;
  primary_blocker: BlockerKey;
  integrity_passed: boolean | null;
  approved_exam_questions: number | null;
  defer_reason: string | null;
  reason_code: string | null;
  quality_council_status: string | null;
  updated_at: string | null;
}

interface RecheckRow {
  package_id: string;
  course_title: string | null;
  package_track: string | null;
  blocker: string;
  action: string;
  reason: string;
  executed: boolean;
}

interface ReaperConfig {
  stale_recoveries_threshold: number;
  max_cancels_per_run: number;
  orphan_lock_minutes: number;
  cron_interval_minutes: number;
  enabled: boolean;
}

const DEFAULT_REAPER: ReaperConfig = {
  stale_recoveries_threshold: 5,
  max_cancels_per_run: 200,
  orphan_lock_minutes: 15,
  cron_interval_minutes: 10,
  enabled: true,
};

export default function BlockerOpsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<BlockerKey | "ALL">("ALL");
  const [snapshotBefore, setSnapshotBefore] = useState<Record<string, number> | null>(null);
  const [snapshotAfter, setSnapshotAfter] = useState<Record<string, number> | null>(null);
  const [lastPlan, setLastPlan] = useState<RecheckRow[] | null>(null);
  const [planMode, setPlanMode] = useState<"dry" | "exec" | null>(null);

  // ---- Dashboard ----
  const dashboard = useQuery({
    queryKey: ["blocker-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_blocker_dashboard" as any)
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as DashboardRow[];
    },
    refetchInterval: 30_000,
  });

  // ---- Deferred-resolved alerts ----
  const alerts = useQuery({
    queryKey: ["deferred-resolved-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_deferred_resolved_alerts" as any)
        .select("*");
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  // ---- Reaper config ----
  const reaper = useQuery({
    queryKey: ["reaper-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select("value, updated_at")
        .eq("key", "reaper_config")
        .maybeSingle();
      if (error) throw error;
      return {
        cfg: (data?.value as unknown as ReaperConfig) ?? DEFAULT_REAPER,
        updated_at: data?.updated_at as string | undefined,
      };
    },
  });

  const reaperAudit = useQuery({
    queryKey: ["reaper-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_reaper_audit" as any)
        .select("*")
        .order("run_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  // ---- Council-deferred packages ----
  const councilDeferred = useQuery({
    queryKey: ["council-deferred"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_council_deferred_packages" as any)
        .select("*");
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  // ---- Queue throughput v2 (jobs/h, duration p50/p95, lifecycle, pending wait) ----
  const throughput = useQuery({
    queryKey: ["queue-throughput-v2"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_queue_throughput_v2" as any,
        { p_window_hours: 6 },
      );
      if (error) throw error;
      return data as any;
    },
    refetchInterval: 30_000,
  });

  // ---- Aggressive Reap Now ----
  const reapNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_reap_stale_processing_now" as any,
        { p_max_age_seconds: 300, p_max_cancels: 100 },
      );
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      toast.success(
        `Stale-Reap ausgeführt: ${res?.failed_terminal ?? 0} terminal · ${res?.requeued ?? 0} requeued`,
      );
      qc.invalidateQueries({ queryKey: ["queue-throughput-v2"] });
      qc.invalidateQueries({ queryKey: ["reaper-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Stale-Reap fehlgeschlagen"),
  });

  // ---- Hot-Loop Quarantäne (attempts >= 10) ----
  // Default: nur die zwei bekannten Hotloop-Typen, damit legitime
  // High-Attempt Repair-/Integrity-Jobs nicht versehentlich abgewürgt werden.
  const HOTLOOP_DEFAULT_TYPES = "package_promote_blueprint_variants,package_auto_publish";
  const [hotloopThreshold, setHotloopThreshold] = useState<number>(10);
  const [hotloopJobTypes, setHotloopJobTypes] = useState<string>(HOTLOOP_DEFAULT_TYPES);
  const parseJobTypes = (s: string): string[] | null => {
    const arr = s.split(",").map((t) => t.trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  };
  const hotloopDryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_quarantine_hotloop_jobs" as any,
        { p_attempt_threshold: hotloopThreshold, p_dry_run: true, p_job_types: parseJobTypes(hotloopJobTypes) },
      );
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      const byType = res?.by_type ? Object.entries(res.by_type).map(([k,v]) => `${k}:${v}`).join(" · ") : "—";
      toast.message(`Dry-Run: ${res?.candidate_count ?? 0} Kandidaten`, { description: byType });
    },
    onError: (e: any) => toast.error(e?.message ?? "Dry-Run fehlgeschlagen"),
  });
  const hotloopExecute = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_quarantine_hotloop_jobs" as any,
        { p_attempt_threshold: hotloopThreshold, p_dry_run: false, p_job_types: parseJobTypes(hotloopJobTypes) },
      );
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      toast.success(
        `Hot-Loop quarantäniert: ${res?.cancelled ?? 0} Jobs cancelled · ${res?.steps_deferred ?? 0} Steps deferred`,
      );
      qc.invalidateQueries({ queryKey: ["queue-throughput-v2"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Quarantäne fehlgeschlagen"),
  });

  // ---- Counts ----
  const counts = useMemo(() => {
    const c: Record<BlockerKey, number> = {
      INTEGRITY_NEVER_CHECKED: 0,
      INTEGRITY_DEFERRED: 0,
      QUALITY_COUNCIL_PENDING: 0,
      EXAM_POOL_TOO_SMALL: 0,
    };
    (dashboard.data ?? []).forEach((r) => {
      if (c[r.primary_blocker] !== undefined) c[r.primary_blocker]++;
    });
    return c;
  }, [dashboard.data]);

  // ---- Job queue snapshot per blocker type ----
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

  // ---- Targeted recheck mutation ----
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

  // ---- Manual reaper trigger ----
  const runReaper = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("fn_reap_stale_jobs_configurable" as any);
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      toast.success(
        `Reaper: ${res?.cancelled ?? 0} cancelled · ${res?.unlocked ?? 0} unlocked · ${res?.terminal ?? 0} terminal`,
      );
      qc.invalidateQueries({ queryKey: ["reaper-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Reaper-Run fehlgeschlagen"),
  });

  const saveReaper = useMutation({
    mutationFn: async (cfg: ReaperConfig) => {
      const { error } = await supabase
        .from("admin_settings")
        .update({ value: cfg as any, updated_at: new Date().toISOString() })
        .eq("key", "reaper_config");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reaper-Config gespeichert");
      qc.invalidateQueries({ queryKey: ["reaper-config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Speichern fehlgeschlagen"),
  });

  // ---- Auto-selector preview ----
  const [selectorPkgId, setSelectorPkgId] = useState("");
  const selectorQuery = useMutation({
    mutationFn: async (pid: string) => {
      const { data, error } = await supabase.rpc(
        "fn_select_exam_pool_repair_action" as any,
        { p_package_id: pid },
      );
      if (error) throw error;
      return data as any;
    },
    onError: (e: any) => toast.error(e?.message ?? "Auto-Select fehlgeschlagen"),
  });

  const filteredRows = (dashboard.data ?? []).filter(
    (r) => filter === "ALL" || r.primary_blocker === filter,
  );

  const reaperCfg = reaper.data?.cfg ?? DEFAULT_REAPER;

  return (
    <div className="space-y-6 max-w-[1500px] mx-auto pb-12">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>Blocker Operations</span>
            <Badge variant="outline" className="text-[10px]">SSOT</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Publish-Blocker Steuerstand</h1>
          <p className="text-sm text-muted-foreground">
            4 echte Blocker-Klassen · Targeted Recheck · Deferred-Alerts · Reaper-Governance
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ["blocker-dashboard"] })}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </header>

      {/* Counts grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(Object.keys(BLOCKER_META) as BlockerKey[]).map((k) => {
          const meta = BLOCKER_META[k];
          const Icon = meta.icon;
          const active = filter === k;
          return (
            <button
              key={k}
              onClick={() => setFilter(active ? "ALL" : k)}
              className={cn(
                "text-left p-3 rounded-lg border bg-card transition-all hover:shadow-sm",
                active && "ring-2 ring-primary",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("p-1.5 rounded", meta.tone)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-2xl font-bold tabular-nums">{counts[k]}</span>
              </div>
              <div className="mt-1.5 text-xs font-medium">{meta.label}</div>
              <div className="text-[10px] text-muted-foreground">{k}</div>
            </button>
          );
        })}
      </div>

      {/* Throughput v2 + Reap + Hot-Loop row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Queue Throughput (6h)</h3>
            <Badge variant="outline" className="text-[10px]">live · v2</Badge>
          </div>
          {throughput.data ? (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><div className="text-muted-foreground">jobs/h</div><div className="text-lg font-bold tabular-nums">{throughput.data.jobs_per_hour ?? 0}</div></div>
              <div><div className="text-muted-foreground">done (6h)</div><div className="text-lg font-bold tabular-nums">{throughput.data.completed_total ?? 0}</div></div>
              <div><div className="text-muted-foreground">duration p50</div><div className="text-lg font-bold tabular-nums">{throughput.data.duration_p50_sec ?? 0}s</div></div>
              <div><div className="text-muted-foreground">duration p95</div><div className="text-lg font-bold tabular-nums">{throughput.data.duration_p95_sec ?? 0}s</div></div>
              <div><div className="text-muted-foreground">pending wait p50</div><div className="text-lg font-bold tabular-nums">{Math.round((throughput.data.pending_wait_p50_sec ?? 0) / 60)}m</div></div>
              <div><div className="text-muted-foreground">pending wait p95</div><div className={cn("text-lg font-bold tabular-nums", (throughput.data.pending_wait_p95_sec ?? 0) > 3600 && "text-destructive")}>{Math.round((throughput.data.pending_wait_p95_sec ?? 0) / 60)}m</div></div>
              <div><div className="text-muted-foreground">lifecycle p95</div><div className="text-lg font-bold tabular-nums">{throughput.data.lifecycle_p95_sec ?? 0}s</div></div>
              <div><div className="text-muted-foreground">oldest processing</div><div className={cn("text-lg font-bold tabular-nums", (throughput.data.processing_oldest_sec ?? 0) > 600 && "text-destructive")}>{Math.round((throughput.data.processing_oldest_sec ?? 0))}s</div></div>
            </div>
          ) : <Skeleton className="h-24 w-full" />}
        </Card>
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <h3 className="text-sm font-semibold mb-1">Stale-Processing Reap</h3>
          <p className="text-[11px] text-muted-foreground mb-2">Räumt processing-Jobs &gt;300s ohne Heartbeat sofort weg. Requeue solange attempts &lt; max, sonst terminal.</p>
          <Button size="sm" variant="destructive" onClick={() => reapNow.mutate()} disabled={reapNow.isPending} className="w-full">
            <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Reap Now (aggressive)
          </Button>
        </Card>
        <Card className="p-4 border-warning/40 bg-warning/5">
          <h3 className="text-sm font-semibold mb-1">Hot-Loop Quarantäne</h3>
          <p className="text-[11px] text-muted-foreground mb-2">Cancelt Jobs mit attempts ≥ Threshold (nur in Whitelist) und auto-defert zugehörige steps via meta-Marker, damit Atomic-Trigger keine neuen Jobs nachlegen.</p>
          <div className="flex items-center gap-2 mb-2">
            <Label htmlFor="hotloop-threshold" className="text-[11px] text-muted-foreground">attempts ≥</Label>
            <Input
              id="hotloop-threshold"
              type="number"
              min={3}
              max={50}
              value={hotloopThreshold}
              onChange={(e) => setHotloopThreshold(Math.max(3, Number(e.target.value) || 10))}
              className="h-7 w-16 text-xs"
            />
          </div>
          <div className="mb-2">
            <Label htmlFor="hotloop-types" className="text-[11px] text-muted-foreground">Job-Typen Whitelist (komma-getrennt, leer = alle ⚠️)</Label>
            <Input
              id="hotloop-types"
              type="text"
              value={hotloopJobTypes}
              onChange={(e) => setHotloopJobTypes(e.target.value)}
              placeholder="package_promote_blueprint_variants,package_auto_publish"
              className="h-7 text-[11px] mt-1 font-mono"
            />
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => hotloopDryRun.mutate()} disabled={hotloopDryRun.isPending} className="flex-1 text-xs">
              Dry-Run
            </Button>
            <Button size="sm" variant="destructive" onClick={() => hotloopExecute.mutate()} disabled={hotloopExecute.isPending} className="flex-1 text-xs">
              <ShieldAlert className="h-3 w-3 mr-1" /> Execute
            </Button>
          </div>
        </Card>
      </div>

      {/* === TRIAGE: Failed-Cluster · Blocker-Split · Hollow-Published · Track-Normalize === */}
      <TriageRow />

      {/* Council-deferred banner */}
      {councilDeferred.data && councilDeferred.data.length > 0 && (
        <Card className="p-4 border-secondary/40 bg-secondary/10">
          <div className="flex items-start gap-2 mb-2">
            <Pause className="h-4 w-4 mt-0.5 text-secondary-foreground" />
            <div>
              <h3 className="text-sm font-semibold">{councilDeferred.data.length} Paket(e) Council-Deferred (Auto-Skip nach 3× Stale-Fail)</h3>
              <p className="text-xs text-muted-foreground">Diese Pakete blockieren publish_readiness nicht mehr — Council wurde wegen wiederholter Worker-Liveness-Fehler übersprungen.</p>
            </div>
          </div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {councilDeferred.data.map((p: any) => (
              <div key={p.defer_id} className="flex items-center justify-between text-xs py-1 border-t border-border/40 first:border-0">
                <span className="truncate"><span className="font-mono text-[10px] text-muted-foreground mr-2">{p.package_id.slice(0,8)}</span>{p.package_title}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[10px]">{p.defer_reason}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{p.fail_count}× fail</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Deferred-resolved alerts */}
      {alerts.data && alerts.data.length > 0 && (
        <Card className="p-4 border-warning/40 bg-warning/5">
          <div className="flex items-start gap-2 mb-2">
            <ShieldAlert className="h-4 w-4 text-warning mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold">
                {alerts.data.length} Paket(e) DEFERRED — Bedingung jetzt erfüllt
              </h3>
              <p className="text-xs text-muted-foreground">
                Diese Pakete können sicher re-enqueued werden (Trigger: "Recheck ausführen").
              </p>
            </div>
          </div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {alerts.data.map((a: any) => (
              <div key={a.package_id} className="flex items-center justify-between text-xs py-1 border-t border-border/40 first:border-0">
                <div className="min-w-0 truncate">
                  <span className="font-mono text-[10px] text-muted-foreground mr-2">{a.package_id.slice(0, 8)}</span>
                  {a.course_title}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[10px]">{a.defer_reason}</Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {a.approved_exam_questions}/{a.min_required}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Tabs defaultValue="recheck" className="w-full">
        <TabsList>
          <TabsTrigger value="recheck">Targeted Recheck</TabsTrigger>
          <TabsTrigger value="drilldown">Drill-down</TabsTrigger>
          <TabsTrigger value="selector">Auto-Selector</TabsTrigger>
          <TabsTrigger value="reaper">Reaper-Governance</TabsTrigger>
        </TabsList>

        {/* === TAB: Recheck === */}
        <TabsContent value="recheck" className="space-y-4">
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
                <Button
                  size="sm"
                  onClick={() => recheck.mutate(true)}
                  disabled={recheck.isPending}
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" /> Execute
                </Button>
              </div>
            </div>

            {/* Before/After snapshot */}
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
                      <TableHead className="text-xs">Executed</TableHead>
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
                          {r.executed ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          ) : (
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* === TAB: Drill-down === */}
        <TabsContent value="drilldown">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                Drill-down ({filteredRows.length}) {filter !== "ALL" && (
                  <Badge variant="outline" className="ml-2 text-[10px]">{filter}</Badge>
                )}
              </h3>
              {filter !== "ALL" && (
                <Button variant="ghost" size="sm" onClick={() => setFilter("ALL")}>
                  Filter zurücksetzen
                </Button>
              )}
            </div>
            {dashboard.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="border rounded-md max-h-[600px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Course</TableHead>
                      <TableHead className="text-xs">Track</TableHead>
                      <TableHead className="text-xs">Blocker</TableHead>
                      <TableHead className="text-xs">Defer-Reason</TableHead>
                      <TableHead className="text-xs">Approved Q</TableHead>
                      <TableHead className="text-xs">Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((r) => (
                      <TableRow key={r.package_id}>
                        <TableCell className="text-xs max-w-[300px] truncate" title={r.course_title ?? ""}>
                          {r.course_title}
                        </TableCell>
                        <TableCell className="text-xs">{r.package_track}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-[10px]">{r.primary_blocker}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.defer_reason ?? r.reason_code ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono tabular-nums">
                          {r.approved_exam_questions ?? 0}
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">
                          {r.updated_at ? new Date(r.updated_at).toLocaleString("de-DE") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* === TAB: Auto-Selector === */}
        <TabsContent value="selector">
          <Card className="p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Wand2 className="h-4 w-4" /> Exam-Pool Repair Auto-Selector
              </h3>
              <p className="text-xs text-muted-foreground">
                Wählt defect-aware zwischen <code>quality</code>, <code>competency_coverage</code> und <code>lf_coverage</code> Repair-Jobs.
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="package_id (UUID)"
                value={selectorPkgId}
                onChange={(e) => setSelectorPkgId(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                onClick={() => selectorQuery.mutate(selectorPkgId)}
                disabled={!selectorPkgId || selectorQuery.isPending}
              >
                Analysieren
              </Button>
            </div>
            {selectorQuery.data && (
              <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge>{selectorQuery.data.recommended_action}</Badge>
                  <span className="text-xs text-muted-foreground">{selectorQuery.data.reason}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <Metric label="Track" value={selectorQuery.data.track} />
                  <Metric label="Approved" value={`${selectorQuery.data.approved}/${selectorQuery.data.min_required}`} />
                  <Metric label="LF Gap %" value={`${selectorQuery.data.lf_gap_pct}%`} />
                  <Metric label="Comp Gap %" value={`${selectorQuery.data.comp_gap_pct}%`} />
                </div>
              </div>
            )}
            {/* Quick links from EXAM_POOL_TOO_SMALL packages */}
            {(dashboard.data ?? []).filter((r) => r.primary_blocker === "EXAM_POOL_TOO_SMALL").length > 0 && (
              <div className="pt-2 border-t">
                <div className="text-xs font-semibold mb-2">Pakete mit EXAM_POOL_TOO_SMALL</div>
                <div className="space-y-1">
                  {(dashboard.data ?? [])
                    .filter((r) => r.primary_blocker === "EXAM_POOL_TOO_SMALL")
                    .map((r) => (
                      <button
                        key={r.package_id}
                        onClick={() => {
                          setSelectorPkgId(r.package_id);
                          selectorQuery.mutate(r.package_id);
                        }}
                        className="w-full text-left text-xs p-2 rounded hover:bg-muted transition"
                      >
                        <span className="font-mono text-[10px] text-muted-foreground mr-2">
                          {r.package_id.slice(0, 8)}
                        </span>
                        {r.course_title}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* === TAB: Reaper === */}
        <TabsContent value="reaper" className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Settings className="h-4 w-4" /> Reaper Configuration
                </h3>
                <p className="text-xs text-muted-foreground">
                  Schwellenwerte für fn_reap_stale_jobs_configurable (cron alle {reaperCfg.cron_interval_minutes} min)
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => runReaper.mutate()} disabled={runReaper.isPending}>
                  <Play className="h-3.5 w-3.5 mr-1.5" /> Jetzt ausführen
                </Button>
              </div>
            </div>
            <ReaperForm cfg={reaperCfg} onSave={(c) => saveReaper.mutate(c)} pending={saveReaper.isPending} />
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Audit-Log (letzte 50 Aktionen)</h3>
            <div className="border rounded-md max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Zeit</TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                    <TableHead className="text-xs">Job-Type</TableHead>
                    <TableHead className="text-xs">Package</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                    <TableHead className="text-xs">Attempts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(reaperAudit.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">
                        Keine Aktionen bisher.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (reaperAudit.data ?? []).map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-[10px] text-muted-foreground">
                          {new Date(a.run_at).toLocaleString("de-DE")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={a.action === "hard_cancel" ? "destructive" : "outline"} className="text-[10px]">
                            {a.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[10px] font-mono">{a.job_type}</TableCell>
                        <TableCell className="text-[10px] font-mono">
                          {a.package_id ? a.package_id.slice(0, 8) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.reason}</TableCell>
                        <TableCell className="text-xs font-mono tabular-nums">{a.transient_attempts ?? "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="border rounded p-2 bg-background">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-mono font-semibold">{value}</div>
    </div>
  );
}

function ReaperForm({
  cfg,
  onSave,
  pending,
}: {
  cfg: ReaperConfig;
  onSave: (c: ReaperConfig) => void;
  pending: boolean;
}) {
  const [local, setLocal] = useState<ReaperConfig>(cfg);
  const dirty = JSON.stringify(local) !== JSON.stringify(cfg);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          id="threshold"
          label="Stale-Recoveries Threshold"
          hint="Hard-Cancel ab N transient_attempts"
          type="number"
          value={local.stale_recoveries_threshold}
          onChange={(v) => setLocal({ ...local, stale_recoveries_threshold: v })}
        />
        <Field
          id="max"
          label="Max Cancels / Run"
          hint="Sicherheits-Cap pro Reaper-Lauf"
          type="number"
          value={local.max_cancels_per_run}
          onChange={(v) => setLocal({ ...local, max_cancels_per_run: v })}
        />
        <Field
          id="orphan"
          label="Orphan-Lock Minuten"
          hint="Locked, never started → unlock"
          type="number"
          value={local.orphan_lock_minutes}
          onChange={(v) => setLocal({ ...local, orphan_lock_minutes: v })}
        />
        <Field
          id="cron"
          label="Cron-Intervall (Minuten)"
          hint="Nur Anzeige – Anpassung erfordert DB-Migration"
          type="number"
          value={local.cron_interval_minutes}
          onChange={(v) => setLocal({ ...local, cron_interval_minutes: v })}
          disabled
        />
      </div>
      <div className="flex items-center justify-between border-t pt-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={local.enabled}
            onCheckedChange={(v) => setLocal({ ...local, enabled: v })}
            id="reaper-enabled"
          />
          <Label htmlFor="reaper-enabled" className="text-xs">
            Reaper aktiv
          </Label>
        </div>
        <Button size="sm" onClick={() => onSave(local)} disabled={!dirty || pending}>
          Speichern
        </Button>
      </div>
    </div>
  );
}

function Field({
  id, label, hint, type, value, onChange, disabled,
}: {
  id: string; label: string; hint: string; type: string; value: number;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-sm font-mono"
      />
      <div className="text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

// ===========================================================================
// TriageRow — Failed-Cluster · Blocker-Split · Hollow-Published · Track-Normalize
// Operative Reihenfolge: Queue → Hotloops → Cluster → Blocker → Track
// ===========================================================================
function TriageRow() {
  const qc = useQueryClient();

  const failed = useQuery({
    queryKey: ["admin-failed-clusters"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_failed_clusters" as any, { p_window_hours: 24 });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  const blockerSplit = useQuery({
    queryKey: ["admin-blocker-split"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_blocked_packages_split" as any);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  const hollow = useQuery({
    queryKey: ["admin-hollow-published"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_hollow_published_packages" as any);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 120_000,
  });

  const [trackTargets, setTrackTargets] = useState<string>("EXAM_FIRST");
  const parseTracks = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);

  const trackDryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_normalize_track_steps" as any, {
        p_dry_run: true, p_tracks: parseTracks(trackTargets), p_max_packages: 50,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      const c = res?.candidates;
      toast.message(`Dry-Run: ${c?.total_candidates ?? 0} Steps · ${c?.distinct_packages ?? 0} Pakete`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Track-Normalize Dry-Run fehlgeschlagen"),
  });

  const trackExecute = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_normalize_track_steps" as any, {
        p_dry_run: false, p_tracks: parseTracks(trackTargets), p_max_packages: 50,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      toast.success(`Normalisiert: ${res?.skipped_steps ?? 0} Steps · ${res?.packages_touched ?? 0} Pakete`);
      qc.invalidateQueries({ queryKey: ["admin-blocker-split"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Track-Normalize Execute fehlgeschlagen"),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Failed-Cluster */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Failed-Cluster (24h)</h3>
            <Badge variant="outline" className="text-[10px]">{failed.data?.length ?? 0} groups</Badge>
          </div>
          {failed.isLoading ? <Skeleton className="h-32 w-full" /> : (
            <div className="space-y-1 max-h-56 overflow-auto text-xs">
              {(failed.data ?? []).slice(0, 12).map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1 border-t border-border/40 first:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px] truncate">{r.job_type}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{r.error_class} · {r.last_error_code}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <Badge variant="destructive" className="text-[10px]">{r.jobs}j</Badge>
                    <Badge variant="outline" className="text-[10px]">{r.packages}p</Badge>
                  </div>
                </div>
              ))}
              {(!failed.data || failed.data.length === 0) && (
                <div className="text-[11px] text-muted-foreground py-4 text-center">Keine Failed-Jobs in 24h</div>
              )}
            </div>
          )}
        </Card>

        {/* Blocker-Split */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Blocked Packages · Split</h3>
            <Badge variant="outline" className="text-[10px]">{blockerSplit.data?.length ?? 0} groups</Badge>
          </div>
          {blockerSplit.isLoading ? <Skeleton className="h-32 w-full" /> : (
            <div className="space-y-1 max-h-56 overflow-auto text-xs">
              {(blockerSplit.data ?? []).map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1 border-t border-border/40 first:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px] truncate">{r.primary_blocker}</div>
                    <div className="text-[10px] text-muted-foreground">{r.package_track}</div>
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0 ml-2">{r.packages}</Badge>
                </div>
              ))}
              {(!blockerSplit.data || blockerSplit.data.length === 0) && (
                <div className="text-[11px] text-muted-foreground py-4 text-center">Keine blockierten Pakete</div>
              )}
            </div>
          )}
        </Card>

        {/* Hollow-Published Forensik */}
        <Card className={cn("p-4", (hollow.data?.length ?? 0) > 0 && "border-destructive/40 bg-destructive/5")}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Hollow-Published Forensik</h3>
            <Badge variant={(hollow.data?.length ?? 0) > 0 ? "destructive" : "outline"} className="text-[10px]">
              {hollow.data?.length ?? 0} pkg
            </Badge>
          </div>
          {hollow.isLoading ? <Skeleton className="h-32 w-full" /> : (
            <div className="space-y-1 max-h-56 overflow-auto text-xs">
              {(hollow.data ?? []).slice(0, 10).map((r: any) => (
                <div key={r.package_id} className="flex items-center justify-between py-1 border-t border-border/40 first:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px]">
                      <span className="font-mono text-[10px] text-muted-foreground mr-1">{r.package_id.slice(0,8)}</span>
                      {r.course_title ?? "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{r.package_track} · {r.primary_blocker ?? "—"}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {r.is_published && <Badge variant="destructive" className="text-[10px]">live</Badge>}
                    <Badge variant="outline" className="text-[10px]">{r.package_status}</Badge>
                  </div>
                </div>
              ))}
              {(!hollow.data || hollow.data.length === 0) && (
                <div className="text-[11px] text-muted-foreground py-4 text-center">Keine Hollow-Pakete</div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Track-Normalize */}
      <Card className="p-4 border-warning/40 bg-warning/5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold">Track-Normalisierung (statt Einzel-Heal)</h3>
            <p className="text-[11px] text-muted-foreground">
              Setzt nicht-applicable <code className="font-mono">package_steps</code> für die gewählten Tracks auf <code className="font-mono">skipped</code> via SSOT <code className="font-mono">track_step_applicability</code>. Markiert sie mit <code className="font-mono">meta.track_normalized=true</code>. Empfohlen für EXAM_FIRST mit Shadow-Learning-Steps.
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="track-targets" className="text-[11px] text-muted-foreground">Tracks (komma-getrennt)</Label>
            <Input
              id="track-targets"
              value={trackTargets}
              onChange={(e) => setTrackTargets(e.target.value)}
              placeholder="EXAM_FIRST,EXAM_FIRST_PLUS"
              className="h-7 text-[11px] mt-1 font-mono"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => trackDryRun.mutate()} disabled={trackDryRun.isPending}>
            Dry-Run
          </Button>
          <Button size="sm" variant="destructive" onClick={() => trackExecute.mutate()} disabled={trackExecute.isPending}>
            <Wand2 className="h-3 w-3 mr-1" /> Execute
          </Button>
        </div>
      </Card>
    </div>
  );
}
