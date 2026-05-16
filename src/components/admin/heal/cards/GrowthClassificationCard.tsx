/**
 * GrowthClassificationCard
 * ────────────────────────
 * Track 2.2 — Growth Signal Classification SSOT.
 * Klassifiziert jedes fehlende Growth-Signal in 6 Klassen mit
 * scope (systemic/local) + severity + repairable.
 *
 * Anti-Phantom: Systemic critical = Plattform-Fix (NICHT 190 Repair-Jobs).
 *               Lokal repairable = echter Per-Paket-Backlog.
 *               Observability = nur Daten fehlen, kein Funktionsdefekt.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Layers, RefreshCw, ShieldAlert, Wrench, Eye, Rocket, FlaskConical } from "lucide-react";
import { toast } from "sonner";

type ClassRow = {
  class: string;
  scope: "systemic" | "local";
  severity: "critical" | "warn" | "info";
  repairable: boolean;
  signal_count: number;
  package_count: number;
  gap_pct_global: number;
};

type Summary = {
  total_published: number;
  critical_systemic_classes: number;
  repairable_local_signals: number;
  classes: ClassRow[];
  generated_at: string;
};

type SignalRow = {
  package_id: string;
  package_key: string | null;
  package_title: string | null;
  track: string | null;
  signal: string;
  class: string;
  scope: "systemic" | "local";
  severity: "critical" | "warn" | "info";
  repairable: boolean;
  gap_pct_global: number;
};

const CLASS_HINT: Record<string, string> = {
  SYSTEMIC_PLATFORM_DRIFT: "Globale Routing-/Canonical-Invariante → 1 Plattform-Fix, KEINE Per-Paket-Repairs",
  SEO_ARTIFACT_MISSING:    "SEO-Page / Canonical / Dead-End fehlt → Artefakt-Generierung",
  TRACKING_NOT_EMITTED:    "Keine conversion_events → Pixel/Producer-Wiring fehlt",
  TRACKING_NOT_ATTRIBUTED: "Events ohne pricing_view / checkout_started → Attribution-Drift",
  FANOUT_NOT_STARTED:      "Blog / OG / IndexNow / Distribution nicht angestoßen",
  OBSERVABILITY_GAP:       "Daten fehlen, Funktion intakt → nur Messung verbessern",
};

function sevTone(s: ClassRow["severity"]) {
  return s === "critical" ? "destructive" : s === "warn" ? "warning" : "secondary";
}
function scopeTone(s: ClassRow["scope"]) {
  return s === "systemic" ? "destructive" : "secondary";
}

function Pill({
  tone, children,
}: {
  tone: "success" | "warning" | "destructive" | "secondary";
  children: React.ReactNode;
}) {
  const t = {
    success: "bg-success-bg-subtle text-success border-success/30",
    warning: "bg-warning-bg-subtle text-warning-foreground border-warning/30",
    destructive: "bg-destructive-bg-subtle text-destructive border-destructive/30",
    secondary: "bg-muted text-muted-foreground border-border",
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${t}`}>
      {children}
    </span>
  );
}

export function GrowthClassificationCard() {
  const [filter, setFilter] = useState<{
    cls?: string; scope?: string; severity?: string; repairable?: string;
  }>({});

  const summaryQ = useQuery({
    queryKey: ["growth-classification-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_growth_classification_summary" as any,
      );
      if (error) throw error;
      return data as Summary;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const hasFilter = Object.values(filter).some(Boolean);

  const signalsQ = useQuery({
    queryKey: ["growth-classification-signals", filter],
    enabled: hasFilter,
    queryFn: async () => {
      const args: Record<string, unknown> = { _limit: 100 };
      if (filter.cls)        args._class = filter.cls;
      if (filter.scope)      args._scope = filter.scope;
      if (filter.severity)   args._severity = filter.severity;
      if (filter.repairable) args._repairable = filter.repairable === "true";
      const { data, error } = await supabase.rpc(
        "admin_get_growth_classification_signals" as any, args as any,
      );
      if (error) throw error;
      return (data ?? []) as SignalRow[];
    },
    staleTime: 30_000,
  });

  const s = summaryQ.data;
  const totalRepairable = s?.classes
    .filter(c => c.repairable)
    .reduce((acc, c) => acc + c.signal_count, 0) ?? 0;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-primary" />
              Growth-Classification v1 — Signal-Typisierung
              <Badge variant="outline" className="text-[10px]">Track 2.2 · Diagnose-only</Badge>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              6 Klassen × scope (systemic/local) × severity × repairable.
              Trennt globale Plattform-Drifts von echten Per-Paket-Gaps.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { summaryQ.refetch(); if (hasFilter) signalsQ.refetch(); }}
            disabled={summaryQ.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${summaryQ.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {summaryQ.isLoading && <Skeleton className="h-60 w-full" />}
        {summaryQ.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive-bg-subtle p-3 text-xs text-destructive">
            Fehler: {(summaryQ.error as Error).message}
            <Button variant="outline" size="sm" className="ml-2 h-7" onClick={() => summaryQ.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {s && (
          <>
            {/* KPI-Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-md border border-border bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Eye className="h-3 w-3" /> published
                </div>
                <div className="text-xl font-bold text-foreground mt-0.5">{s.total_published}</div>
              </div>
              <div className="rounded-md border border-destructive/30 bg-destructive-bg-subtle p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                  <ShieldAlert className="h-3 w-3" /> systemic critical classes
                </div>
                <div className="text-xl font-bold text-destructive mt-0.5">
                  {s.critical_systemic_classes}
                </div>
                <div className="text-[10px] text-muted-foreground">→ Plattform-Fix, keine Per-Paket-Repairs</div>
              </div>
              <div className="rounded-md border border-warning/30 bg-warning-bg-subtle p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-warning-foreground">
                  <Wrench className="h-3 w-3" /> repairable local signals
                </div>
                <div className="text-xl font-bold text-foreground mt-0.5">
                  {s.repairable_local_signals}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  echter Per-Paket-Backlog (von {totalRepairable} insgesamt repairable)
                </div>
              </div>
            </div>

            {/* Class matrix */}
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-left text-[10px] text-muted-foreground uppercase">
                    <th className="px-2 py-1.5">Class</th>
                    <th className="px-2 py-1.5">Scope</th>
                    <th className="px-2 py-1.5">Severity</th>
                    <th className="px-2 py-1.5">Repair</th>
                    <th className="px-2 py-1.5 text-right">Signals</th>
                    <th className="px-2 py-1.5 text-right">Pakete</th>
                    <th className="px-2 py-1.5 text-right">Gap %</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {s.classes.length === 0 && (
                    <tr><td colSpan={8} className="px-2 py-3 text-center text-muted-foreground">
                      Keine Klassen — alle Signale ready.
                    </td></tr>
                  )}
                  {s.classes.map((c, i) => (
                    <tr key={i} className="border-t border-border hover:bg-muted/20">
                      <td className="px-2 py-2">
                        <div className="font-medium text-foreground font-mono text-[11px]">{c.class}</div>
                        <div className="text-[10px] text-muted-foreground">{CLASS_HINT[c.class]}</div>
                      </td>
                      <td className="px-2 py-2"><Pill tone={scopeTone(c.scope)}>{c.scope}</Pill></td>
                      <td className="px-2 py-2"><Pill tone={sevTone(c.severity)}>{c.severity}</Pill></td>
                      <td className="px-2 py-2">
                        {c.repairable
                          ? <Pill tone="warning">yes</Pill>
                          : <Pill tone="secondary">no</Pill>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-foreground">{c.signal_count}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-foreground">{c.package_count}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{c.gap_pct_global}%</td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                          onClick={() => setFilter({
                            cls: c.class, scope: c.scope,
                            severity: c.severity, repairable: String(c.repairable),
                          })}
                        >Drill</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <EligibleRepairsSection />
            <LocalRepairWorkerSection />
            <RepairOutcomeVerificationSection />
            <RepairGovernanceSection />

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-foreground">Filter:</span>
              <Select value={filter.cls ?? ""} onValueChange={(v) => setFilter(f => ({ ...f, cls: v || undefined }))}>
                <SelectTrigger className="h-7 w-52 text-xs"><SelectValue placeholder="Class" /></SelectTrigger>
                <SelectContent>
                  {Object.keys(CLASS_HINT).map(k => (
                    <SelectItem key={k} value={k} className="text-xs font-mono">{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filter.scope ?? ""} onValueChange={(v) => setFilter(f => ({ ...f, scope: v || undefined }))}>
                <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder="Scope" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="systemic" className="text-xs">systemic</SelectItem>
                  <SelectItem value="local" className="text-xs">local</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filter.severity ?? ""} onValueChange={(v) => setFilter(f => ({ ...f, severity: v || undefined }))}>
                <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical" className="text-xs">critical</SelectItem>
                  <SelectItem value="warn" className="text-xs">warn</SelectItem>
                  <SelectItem value="info" className="text-xs">info</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filter.repairable ?? ""} onValueChange={(v) => setFilter(f => ({ ...f, repairable: v || undefined }))}>
                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="Repairable" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true" className="text-xs">repairable</SelectItem>
                  <SelectItem value="false" className="text-xs">not repairable</SelectItem>
                </SelectContent>
              </Select>
              {hasFilter && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFilter({})}>Reset</Button>
              )}
            </div>

            {/* Signal drill-down list */}
            {hasFilter && (
              <div className="rounded-md border border-border bg-card/50 max-h-80 overflow-y-auto">
                {signalsQ.isLoading && <div className="p-3 text-xs text-muted-foreground">Lade…</div>}
                {signalsQ.data && signalsQ.data.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">Keine Signale für diesen Filter.</div>
                )}
                {signalsQ.data && signalsQ.data.map((row, i) => (
                  <div key={i} className="px-3 py-2 border-b border-border last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">
                          {row.package_title ?? row.package_key ?? row.package_id.slice(0, 8)}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {row.track ?? "—"} · {row.package_id.slice(0, 8)} · signal=<span className="text-foreground">{row.signal}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 flex-wrap justify-end shrink-0">
                        <Pill tone={sevTone(row.severity)}>{row.severity}</Pill>
                        <Pill tone={scopeTone(row.scope)}>{row.scope}</Pill>
                        {row.repairable && <Pill tone="warning">repairable</Pill>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="text-[10px] text-muted-foreground">
              Stand: {new Date(s.generated_at).toLocaleTimeString("de-DE")} ·
              Track 2.2 · systemic-threshold ≥80% global gap · diagnose-only
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Track 2.3c — Eligible Repairs Section
// Diagnose + dry-run + live dispatch (admin only). No frontend table reads.
// ─────────────────────────────────────────────────────────────────────
type DispatchDecision = {
  action: "dispatch" | "skip";
  skip_reason?: string;
  canonical_job_type?: string;
  idempotency_key?: string;
  worker_pool?: string;
  priority?: number;
};
type DispatchRow = {
  package_id: string;
  package_key?: string | null;
  signal: string;
  expected_job_type: string;
  decision?: DispatchDecision;
  status?: "dispatched" | "skipped" | "failed";
  skip_reason?: string;
  canonical_job_type?: string;
  idempotency_key?: string;
  job_id?: string;
  error?: string;
};
type DispatchResult = {
  mode: "dry_run" | "live";
  run_id?: string;
  scanned: number;
  would_dispatch?: number;
  would_skip?: number;
  dispatched?: number;
  skipped?: number;
  failed?: number;
  limit: number;
  generated_at: string;
  rows: DispatchRow[];
};
type RecentRun = {
  run_id: string;
  created_at: string;
  result_status: string;
  dispatched: number;
  skipped: number;
  failed: number;
  scanned: number;
  reason: string | null;
};

function EligibleRepairsSection() {
  const qc = useQueryClient();
  const [batchLimit, setBatchLimit] = useState<number>(25);
  const [lastResult, setLastResult] = useState<DispatchResult | null>(null);

  const recentQ = useQuery({
    queryKey: ["growth-repair-recent-runs"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_growth_repair_recent_runs" as any, { _limit: 5 },
      );
      if (error) throw error;
      return (data ?? []) as RecentRun[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_growth_repair_dispatch_dry_run" as any, { _limit: batchLimit },
      );
      if (error) throw error;
      return data as DispatchResult;
    },
    onSuccess: (data) => {
      setLastResult(data);
      toast.success(`Dry-run: ${data.would_dispatch ?? 0} would dispatch · ${data.would_skip ?? 0} skip`);
    },
    onError: (e: Error) => toast.error(`Dry-run fehlgeschlagen: ${e.message}`),
  });

  const live = useMutation({
    mutationFn: async (reason: string) => {
      const { data, error } = await supabase.rpc(
        "admin_growth_repair_dispatch_live" as any,
        { _limit: batchLimit, _reason: reason },
      );
      if (error) throw error;
      return data as DispatchResult;
    },
    onSuccess: (data) => {
      setLastResult(data);
      toast.success(
        `Dispatch: ${data.dispatched ?? 0} dispatched · ${data.skipped ?? 0} skip · ${data.failed ?? 0} fail`,
      );
      qc.invalidateQueries({ queryKey: ["growth-repair-recent-runs"] });
      qc.invalidateQueries({ queryKey: ["growth-classification-summary"] });
    },
    onError: (e: Error) => toast.error(`Dispatch fehlgeschlagen: ${e.message}`),
  });

  const onLive = () => {
    const reason = window.prompt(
      `Live-Dispatch bestätigen.\nBatch-Limit: ${batchLimit}\nGib einen Grund ein (Pflicht für Audit):`,
      "",
    );
    if (!reason || reason.trim().length < 3) {
      toast.error("Grund (min. 3 Zeichen) ist Pflicht.");
      return;
    }
    live.mutate(reason.trim());
  };

  return (
    <div className="rounded-md border border-warning/40 bg-warning-bg-subtle/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Rocket className="h-4 w-4 text-warning-foreground" />
            Eligible Repairs · Track 2.3c Dispatcher
            <Badge variant="outline" className="text-[10px]">safe_to_repair=true</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Disponiert ausschließlich aus <code>v_growth_repair_eligibility_v1</code> ·
            Blocked/Platform-Fix werden NIE dispatched · stündliche Idempotency · Audit pflicht.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(batchLimit)} onValueChange={(v) => setBatchLimit(Number(v))}>
            <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[5, 10, 25, 50, 100].map(n => (
                <SelectItem key={n} value={String(n)} className="text-xs">Limit {n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline" size="sm" className="h-7 text-xs"
            onClick={() => dryRun.mutate()} disabled={dryRun.isPending}
          >
            <FlaskConical className="h-3.5 w-3.5 mr-1" />
            {dryRun.isPending ? "…" : "Dry-Run"}
          </Button>
          <Button
            variant="default" size="sm" className="h-7 text-xs"
            onClick={onLive} disabled={live.isPending}
          >
            <Rocket className="h-3.5 w-3.5 mr-1" />
            {live.isPending ? "…" : "Dispatch"}
          </Button>
        </div>
      </div>

      {/* Last result preview */}
      {lastResult && (
        <div className="rounded-md border border-border bg-card/50 p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-mono text-muted-foreground">
              {lastResult.mode === "dry_run" ? "DRY-RUN" : "LIVE"} ·
              scanned {lastResult.scanned} ·
              {lastResult.mode === "dry_run"
                ? <> would_dispatch {lastResult.would_dispatch} · would_skip {lastResult.would_skip}</>
                : <> dispatched {lastResult.dispatched} · skipped {lastResult.skipped} · failed {lastResult.failed}</>}
            </span>
            <span className="text-muted-foreground">
              {new Date(lastResult.generated_at).toLocaleTimeString("de-DE")}
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-border">
            {lastResult.rows.slice(0, 50).map((r, i) => {
              const action = r.decision?.action ?? r.status ?? "skipped";
              const skipReason = r.decision?.skip_reason ?? r.skip_reason;
              return (
                <div key={i} className="py-1.5 text-[11px] flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-foreground truncate">
                      {r.package_key ?? r.package_id.slice(0, 8)} · <span className="text-muted-foreground">{r.signal}</span> → <span className="text-foreground">{r.decision?.canonical_job_type ?? r.canonical_job_type ?? r.expected_job_type}</span>
                    </div>
                    {(skipReason || r.error) && (
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {skipReason && <>skip_reason=<span className="text-warning-foreground">{skipReason}</span></>}
                        {r.error && <> · err={r.error}</>}
                      </div>
                    )}
                  </div>
                  <Pill tone={action === "dispatch" || action === "dispatched" ? "success"
                          : action === "failed" ? "destructive" : "secondary"}>
                    {action}
                  </Pill>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent runs */}
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-foreground flex items-center gap-2">
          <RefreshCw className="h-3 w-3" /> Letzte Runs
        </div>
        {recentQ.isLoading && <div className="text-[11px] text-muted-foreground">Lade…</div>}
        {recentQ.data && recentQ.data.length === 0 && (
          <div className="text-[11px] text-muted-foreground">Noch keine Dispatcher-Läufe.</div>
        )}
        {recentQ.data && recentQ.data.map((r) => (
          <div key={r.run_id} className="flex items-center justify-between text-[11px] font-mono border-l-2 border-border pl-2">
            <span className="text-muted-foreground">
              {new Date(r.created_at).toLocaleString("de-DE")} ·
              <span className="text-foreground"> {r.dispatched}↑</span> /
              <span className="text-muted-foreground"> {r.skipped} skip</span> /
              <span className="text-destructive"> {r.failed} fail</span>
              {r.reason && <> · "{r.reason}"</>}
            </span>
            <Pill tone={r.result_status === "ok" ? "success" : r.result_status === "partial" ? "warning" : "destructive"}>
              {r.result_status}
            </Pill>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Track 2.3d — Local Repair Worker Section
// Read-only status + admin dry-run/live for the cron-driven worker.
// Worker consumes v_growth_repair_local_targets_v1 (FANOUT_NOT_STARTED).
// TRACKING_NOT_EMITTED is shown as platform-fix only — never dispatched.
// ─────────────────────────────────────────────────────────────────────
type LocalSummary = {
  targets: {
    fanout_safe: number;
    fanout_blocked: number;
    tracking_total: number;
    by_signal: Record<string, number> | null;
  };
  recent_runs: Array<{
    created_at: string;
    result_status: "ok" | "partial" | "failed";
    metadata: {
      run_id?: string;
      mode?: "dry_run" | "live";
      scanned?: number;
      dispatched?: number;
      skipped?: number;
      failed?: number;
    } | null;
  }>;
};

function LocalRepairWorkerSection() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"dry" | "live" | null>(null);

  const sumQ = useQuery({
    queryKey: ["growth-local-worker-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_growth_local_worker_summary" as any,
      );
      if (error) throw error;
      return data as LocalSummary;
    },
    refetchInterval: 60_000,
  });

  const runDry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_growth_local_worker_dry_run" as any,
        { _limit: 25 },
      );
      if (error) throw error;
      return data as { dispatched: number; skipped: number; scanned: number };
    },
    onSuccess: (r) => toast.success(`Dry-run: ${r.dispatched} would dispatch · ${r.skipped} skipped`),
    onError: (e: any) => toast.error(e.message ?? "Dry-run failed"),
    onSettled: () => {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["growth-local-worker-summary"] });
    },
  });

  const runLive = useMutation({
    mutationFn: async (reason: string) => {
      const { data, error } = await supabase.rpc(
        "admin_growth_local_worker_live" as any,
        { _limit: 25, _reason: reason },
      );
      if (error) throw error;
      return data as { dispatched: number; skipped: number; failed: number };
    },
    onSuccess: (r) =>
      toast.success(`Worker: ${r.dispatched} dispatched · ${r.skipped} skipped · ${r.failed} failed`),
    onError: (e: any) => toast.error(e.message ?? "Worker failed"),
    onSettled: () => {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["growth-local-worker-summary"] });
    },
  });

  const s = sumQ.data;
  const t = s?.targets;
  const bySignal = t?.by_signal ?? {};

  return (
    <div className="mt-6 rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-foreground" />
          <h4 className="text-sm font-semibold text-foreground">
            Local Repair Worker · Track 2.3d
          </h4>
          <Badge variant="outline" className="text-[10px] font-mono">cron 30min · max 25/run</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm" className="h-7 text-xs"
            disabled={busy !== null}
            onClick={() => { setBusy("dry"); runDry.mutate(); }}
          >
            <FlaskConical className="h-3 w-3 mr-1" />
            {busy === "dry" ? "…" : "Dry-Run"}
          </Button>
          <Button
            variant="default" size="sm" className="h-7 text-xs"
            disabled={busy !== null}
            onClick={() => {
              const reason = window.prompt("Reason (min 3 chars)") ?? "";
              if (reason.trim().length < 3) {
                toast.error("Reason required");
                return;
              }
              setBusy("live");
              runLive.mutate(reason.trim());
            }}
          >
            <Rocket className="h-3 w-3 mr-1" />
            {busy === "live" ? "…" : "Run Now"}
          </Button>
        </div>
      </div>

      {sumQ.isLoading && <Skeleton className="h-16 w-full" />}
      {s && t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <KpiPill label="Fanout · safe" value={t.fanout_safe} tone="success" />
            <KpiPill label="Fanout · blocked" value={t.fanout_blocked} tone="warning" />
            <KpiPill label="Tracking · platform-fix" value={t.tracking_total} tone="info" />
            <KpiPill label="By signal" value={Object.keys(bySignal).length} tone="neutral" />
          </div>

          {Object.keys(bySignal).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(bySignal).map(([sig, n]) => (
                <Badge key={sig} variant="outline" className="text-[10px] font-mono">
                  {sig}: {n}
                </Badge>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground font-medium">Recent runs (cron + admin)</div>
            {s.recent_runs.length === 0 && (
              <div className="text-[11px] text-muted-foreground">Noch keine Worker-Läufe.</div>
            )}
            {s.recent_runs.map((r, i) => {
              const m = r.metadata ?? {};
              return (
                <div key={i} className="flex items-center justify-between text-[11px] font-mono border-l-2 border-border pl-2">
                  <span className="text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("de-DE")} ·
                    <span className="text-foreground"> {m.dispatched ?? 0}↑</span> /
                    <span className="text-muted-foreground"> {m.skipped ?? 0} skip</span> /
                    <span className="text-destructive"> {m.failed ?? 0} fail</span>
                    {m.mode && <> · {m.mode}</>}
                  </span>
                  <Pill tone={r.result_status === "ok" ? "success" : r.result_status === "partial" ? "warning" : "destructive"}>
                    {r.result_status}
                  </Pill>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function KpiPill({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "info" | "neutral" }) {
  const cls =
    tone === "success" ? "border-emerald-500/30 text-emerald-500" :
    tone === "warning" ? "border-amber-500/30 text-amber-500" :
    tone === "info"    ? "border-sky-500/30 text-sky-500" :
                         "border-border text-foreground";
  return (
    <div className={`rounded-md border bg-card/50 px-2 py-1.5 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Track 2.3e — Repair Outcome Verification Section
// ─────────────────────────────────────────────────────────────────────
type OutcomeSummary = {
  window_days: number;
  totals: {
    total: number;
    pending: number;
    signal_closed: number;
    job_failed: number;
    stale: number;
    abandoned: number;
    verified: number;
    avg_close_minutes: number | null;
  };
  by_signal: Array<{
    signal: string; total: number; closed: number;
    failed: number; stale: number; pending: number;
  }>;
  by_dispatcher: Array<{
    dispatcher: string; total: number; closed: number; failed: number;
  }>;
  recent_runs: Array<{
    id: string;
    created_at: string;
    result_status: "ok" | "partial" | "failed";
    metadata: {
      run_id?: string; mode?: string; scanned?: number;
      signal_closed?: number; job_failed?: number;
      stale?: number; still_pending?: number;
    } | null;
  }>;
};

function RepairOutcomeVerificationSection() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"dry" | "live" | null>(null);

  const sumQ = useQuery({
    queryKey: ["growth-repair-outcomes-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_growth_repair_outcomes_summary" as any,
      );
      if (error) throw error;
      return data as OutcomeSummary;
    },
    refetchInterval: 60_000,
  });

  const runDry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_growth_repair_verify_now" as any,
        { _mode: "dry_run", _limit: 100 },
      );
      if (error) throw error;
      return data as { scanned: number; signal_closed: number };
    },
    onSuccess: (r) =>
      toast.success(`Dry-run: ${r.scanned} scanned · ${r.signal_closed} would close`),
    onError: (e: any) => toast.error(e.message ?? "Dry-run failed"),
    onSettled: () => {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["growth-repair-outcomes-summary"] });
    },
  });

  const runLive = useMutation({
    mutationFn: async (reason: string) => {
      const { data, error } = await supabase.rpc(
        "admin_growth_repair_verify_now" as any,
        { _mode: "live", _limit: 100, _reason: reason },
      );
      if (error) throw error;
      return data as {
        scanned: number; signal_closed: number;
        job_failed: number; stale: number;
      };
    },
    onSuccess: (r) =>
      toast.success(
        `Verified: ${r.signal_closed} closed · ${r.job_failed} failed · ${r.stale} stale (of ${r.scanned})`,
      ),
    onError: (e: any) => toast.error(e.message ?? "Verify failed"),
    onSettled: () => {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["growth-repair-outcomes-summary"] });
    },
  });

  const s = sumQ.data;
  const t = s?.totals;
  const closeRate =
    t && t.verified > 0
      ? Math.round((t.signal_closed / t.verified) * 100)
      : null;

  return (
    <div className="mt-6 rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-foreground" />
          <h4 className="text-sm font-semibold text-foreground">
            Repair Outcome Verification · Track 2.3e
          </h4>
          <Badge variant="outline" className="text-[10px] font-mono">
            cron 15min · 14d window
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm" className="h-7 text-xs"
            disabled={busy !== null}
            onClick={() => { setBusy("dry"); runDry.mutate(); }}
          >
            <FlaskConical className="h-3 w-3 mr-1" />
            {busy === "dry" ? "…" : "Dry-Run"}
          </Button>
          <Button
            variant="default" size="sm" className="h-7 text-xs"
            disabled={busy !== null}
            onClick={() => {
              const reason = window.prompt("Reason (min 3 chars)") ?? "";
              if (reason.trim().length < 3) {
                toast.error("Reason required");
                return;
              }
              setBusy("live");
              runLive.mutate(reason.trim());
            }}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            {busy === "live" ? "…" : "Verify Now"}
          </Button>
        </div>
      </div>

      {sumQ.isLoading && <Skeleton className="h-16 w-full" />}
      {s && t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <KpiPill label="Total" value={t.total} tone="neutral" />
            <KpiPill label="Pending" value={t.pending} tone="info" />
            <KpiPill label="Signal closed" value={t.signal_closed} tone="success" />
            <KpiPill label="Job failed" value={t.job_failed} tone="warning" />
            <KpiPill label="Stale" value={t.stale} tone="warning" />
            <KpiPill
              label="Close rate %"
              value={closeRate ?? 0}
              tone={closeRate !== null && closeRate >= 70 ? "success" : "warning"}
            />
          </div>

          {t.avg_close_minutes !== null && (
            <div className="text-[11px] text-muted-foreground">
              Avg time-to-close: {Math.round(t.avg_close_minutes)} min
            </div>
          )}

          {s.by_signal.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground font-medium">By signal</div>
              <div className="flex flex-wrap gap-1">
                {s.by_signal.map((b) => (
                  <Badge key={b.signal} variant="outline" className="text-[10px] font-mono">
                    {b.signal}: {b.closed}✓ / {b.failed}✗ / {b.pending}…
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground font-medium">Recent verifier runs</div>
            {s.recent_runs.length === 0 && (
              <div className="text-[11px] text-muted-foreground">Noch keine Verifier-Läufe.</div>
            )}
            {s.recent_runs.map((r) => {
              const m = r.metadata ?? {};
              return (
                <div key={r.id} className="flex items-center justify-between text-[11px] font-mono border-l-2 border-border pl-2">
                  <span className="text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("de-DE")} ·
                    <span className="text-emerald-500"> {m.signal_closed ?? 0}✓</span> /
                    <span className="text-amber-500"> {m.job_failed ?? 0}✗</span> /
                    <span className="text-muted-foreground"> {m.stale ?? 0} stale</span> /
                    <span className="text-sky-500"> {m.still_pending ?? 0}…</span>
                    {m.mode && <> · {m.mode}</>}
                  </span>
                  <Pill tone={r.result_status === "ok" ? "success" : "warning"}>
                    {r.result_status}
                  </Pill>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
