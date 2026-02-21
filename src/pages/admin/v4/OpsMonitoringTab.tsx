import React, { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  RefreshCw, AlertTriangle, CheckCircle2, Activity, Package, Loader2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────

type OpsSnapshot = {
  ok: boolean;
  as_of?: string;
  snapshot?: {
    batch_requeue_summary: Record<string, unknown>[];
    package_steps_stuck: Record<string, unknown>[];
    step_job_drift: Record<string, unknown>[];
    prereq_guard_cancelled: Record<string, unknown>[];
    course_build_progress: Record<string, unknown>[];
  };
  error?: string;
  details?: unknown;
};

// ── Helpers ────────────────────────────────────────────────────────

import { formatDateTime } from '@/lib/timezone';

function formatTs(ts?: string | null) {
  return formatDateTime(ts);
}

function cell(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "✅" : "—";
  return String(val);
}

// ── Data Fetcher ───────────────────────────────────────────────────

async function fetchOpsSnapshot(): Promise<OpsSnapshot> {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) return { ok: false, error: sessionErr.message };
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return { ok: false, error: "Not authenticated" };

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return { ok: false, error: "Missing VITE_SUPABASE_URL" };

  const res = await fetch(`${supabaseUrl}/functions/v1/ops-dashboard`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  });

  const json = (await res.json().catch(() => null)) as OpsSnapshot | null;
  if (!res.ok) {
    return { ok: false, error: json?.error || `HTTP ${res.status}`, details: (json as Record<string, unknown>)?.details };
  }
  return json ?? { ok: false, error: "Empty response" };
}

// ── Reusable Panel ─────────────────────────────────────────────────

function DataPanel({
  title,
  icon,
  columns,
  rows,
  emptyText = "Keine Treffer.",
}: {
  title: string;
  icon: React.ReactNode;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  emptyText?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          {icon}
          {title}
          <Badge variant="secondary" className="ml-auto text-xs">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto max-h-[420px]">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.key} className="text-xs whitespace-nowrap">{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-muted-foreground text-center py-6">
                    {emptyText}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r, idx) => (
                  <TableRow key={idx}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className="text-xs py-2 whitespace-nowrap max-w-[280px] truncate">
                        {cell(r[c.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export default function OpsMonitoringTab() {
  const [data, setData] = useState<OpsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await fetchOpsSnapshot();
    if (!res.ok) {
      setErr(res.error || "OPS Snapshot failed");
    }
    setData(res);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  const snapshot = data?.snapshot;

  // ── Column Definitions ──

  const progressCols = useMemo(() => [
    { key: "title", label: "Paket" },
    { key: "package_status", label: "Status" },
    { key: "current_step", label: "Step" },
    { key: "build_progress", label: "Progress" },
    { key: "is_stuck", label: "Stuck" },
    { key: "stuck_minutes", label: "Stuck Min" },
    { key: "stuck_reason", label: "Stuck Reason" },
    { key: "open_jobs", label: "Jobs" },
    { key: "pending_jobs", label: "Pending" },
    { key: "processing_jobs", label: "Processing" },
    { key: "attempts_sum", label: "Attempts" },
    { key: "last_progress_at", label: "Last Progress" },
    { key: "last_error", label: "Last Error" },
  ], []);

  const batchCols = useMemo(() => [
    { key: "job_type", label: "Job Type" },
    { key: "requeues", label: "Requeues" },
    { key: "distinct_cursors", label: "Distinct Cursors" },
    { key: "cursor_null", label: "Cursor Null" },
    { key: "first_seen", label: "First Seen" },
    { key: "last_seen", label: "Last Seen" },
  ], []);

  const stuckCols = useMemo(() => [
    { key: "title", label: "Paket" },
    { key: "step_key", label: "Step" },
    { key: "status", label: "Status" },
    { key: "attempts", label: "Attempts" },
    { key: "updated_at", label: "Updated" },
    { key: "last_error", label: "Error" },
  ], []);

  const driftCols = useMemo(() => [
    { key: "step_key", label: "Step" },
    { key: "step_status", label: "Step Status" },
    { key: "job_id", label: "Job ID" },
    { key: "job_status", label: "Job Status" },
    { key: "job_updated_at", label: "Job Updated" },
    { key: "job_error", label: "Job Error" },
  ], []);

  const prereqCols = useMemo(() => [
    { key: "job_type", label: "Job Type" },
    { key: "cancelled", label: "Cancelled" },
    { key: "first_seen", label: "First" },
    { key: "last_seen", label: "Last" },
    { key: "sample_error", label: "Error" },
  ], []);

  // ── Prepare rows with formatted timestamps ──

  const progressRows = useMemo(() =>
    (snapshot?.course_build_progress ?? []).map((r) => ({
      ...r,
      last_progress_at: formatTs(r.last_progress_at as string),
      last_job_activity_at: formatTs(r.last_job_activity_at as string),
      is_stuck: r.is_stuck ? "🔴 STUCK" : "",
      build_progress: r.build_progress != null ? `${Number(r.build_progress).toFixed(0)}%` : "—",
    })),
    [snapshot?.course_build_progress],
  );

  const batchRows = useMemo(() =>
    (snapshot?.batch_requeue_summary ?? []).map((r) => ({
      ...r,
      first_seen: formatTs(r.first_seen as string),
      last_seen: formatTs(r.last_seen as string),
      requeues: r.requeues,
    })),
    [snapshot?.batch_requeue_summary],
  );

  const stuckRows = useMemo(() =>
    (snapshot?.package_steps_stuck ?? []).map((r) => ({
      ...r,
      updated_at: formatTs(r.updated_at as string),
    })),
    [snapshot?.package_steps_stuck],
  );

  const driftRows = useMemo(() =>
    (snapshot?.step_job_drift ?? []).map((r) => ({
      ...r,
      job_updated_at: formatTs(r.job_updated_at as string),
    })),
    [snapshot?.step_job_drift],
  );

  const prereqRows = useMemo(() =>
    (snapshot?.prereq_guard_cancelled ?? []).map((r) => ({
      ...r,
      first_seen: formatTs(r.first_seen as string),
      last_seen: formatTs(r.last_seen as string),
      cancelled: r.cancelled,
    })),
    [snapshot?.prereq_guard_cancelled],
  );

  // ── KPI counts ──

  const stuckCount = progressRows.filter((r) => r.is_stuck === "🔴 STUCK").length;
  const driftCount = driftRows.length;
  const batchCount = batchRows.reduce((sum, r) => sum + Number(r.requeues ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            OPS Pipeline Monitor
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Stand: {data?.as_of ? formatTs(data.as_of) : "—"}
            {loading && " • lädt…"}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="auto-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <Label htmlFor="auto-refresh" className="text-xs">Auto (30s)</Label>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Stuck Packages</div>
          <div className={`text-2xl font-black ${stuckCount > 0 ? "text-destructive" : "text-accent"}`}>
            {stuckCount}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Step↔Job Drift</div>
          <div className={`text-2xl font-black ${driftCount > 0 ? "text-warning" : "text-accent"}`}>
            {driftCount}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Batch Requeues (6h)</div>
          <div className="text-2xl font-black">{batchCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Prereq Cancelled</div>
          <div className={`text-2xl font-black ${prereqRows.length > 0 ? "text-warning" : "text-accent"}`}>
            {prereqRows.reduce((s, r) => s + Number(r.cancelled ?? 0), 0)}
          </div>
        </Card>
      </div>

      {/* Error banner */}
      {err && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-destructive font-bold text-sm">
              <AlertTriangle className="h-4 w-4" />
              OPS Snapshot Fehler
            </div>
            <p className="text-xs text-muted-foreground mt-1">{err}</p>
            {data?.details && (
              <pre className="text-xs mt-2 overflow-auto max-h-32 bg-muted/50 p-2 rounded">
                {JSON.stringify(data.details, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {/* Panel 0: Course Build Progress */}
      <DataPanel
        title="Course Build Progress"
        icon={<Package className="h-4 w-4 text-primary" />}
        columns={progressCols}
        rows={progressRows}
      />

      {/* Panel 1-4 in 2-column grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DataPanel
          title="Batch-Requeue Summary"
          icon={<RefreshCw className="h-4 w-4 text-warning" />}
          columns={batchCols}
          rows={batchRows}
          emptyText="Keine Batch-Requeues in den letzten 6h."
        />
        <DataPanel
          title="Package Steps — Stuck"
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          columns={stuckCols}
          rows={stuckRows}
          emptyText="Keine hängenden Steps."
        />
        <DataPanel
          title="Step ↔ Job Drift"
          icon={<Activity className="h-4 w-4 text-warning" />}
          columns={driftCols}
          rows={driftRows}
          emptyText="Kein Drift erkannt."
        />
        <DataPanel
          title="Prereq-Guard Cancelled"
          icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
          columns={prereqCols}
          rows={prereqRows}
          emptyText="Keine Prereq-Cancels in den letzten 6h."
        />
      </div>
    </div>
  );
}
