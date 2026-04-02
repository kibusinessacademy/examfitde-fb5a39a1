import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminSheet as Sheet, AdminSheetContent as SheetContent, AdminSheetHeader as SheetHeader, AdminSheetTitle as SheetTitle } from '@/components/admin/AdminSheet';

type StepRow = {
  step_key: string;
  job_type: string;

  completed: number;
  failed_or_cancelled: number;
  processing: number;
  pending: number;

  qwait_p50_ms: number | null;
  qwait_p95_ms: number | null;
  run_p50_ms: number | null;
  run_p95_ms: number | null;

  run_avg_ms: number | null;
  run_max_ms: number | null;
  attempts_avg: number | null;
};

type SlowJob = {
  job_id: string;
  package_id: string | null;
  step_key: string;
  run_ms: number | null;
  queue_wait_ms: number | null;
  attempts: number;
  completed_at: string | null;
  error_snip: string | null;
};

function fmtMs(ms?: number | null) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

function prettyStep(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function severity(runP95?: number | null, qwaitP95?: number | null) {
  const r = runP95 ?? 0;
  const q = qwaitP95 ?? 0;
  if (r > 120_000 || q > 60_000) return "red" as const;
  if (r > 60_000 || q > 30_000) return "amber" as const;
  return "green" as const;
}

function Dot({ level }: { level: "red" | "amber" | "green" }) {
  const cls =
    level === "red"
      ? "bg-destructive"
      : level === "amber"
        ? "bg-amber-500"
        : "bg-emerald-500";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} />;
}

export default function StepDurationPanel() {
  const [drillStep, setDrillStep] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["ops_step_duration_7d"],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb.from("ops_step_duration_7d").select("*");
      if (error) throw error;
      return (data ?? []) as StepRow[];
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: slowJobs } = useQuery({
    queryKey: ["ops_step_duration_slowest_7d", drillStep],
    queryFn: async () => {
      if (!drillStep) return [] as SlowJob[];
      const sb = supabase as any;
      const { data, error } = await sb
        .from("ops_step_duration_slowest_7d")
        .select("job_id,package_id,step_key,run_ms,queue_wait_ms,attempts,completed_at,error_snip")
        .eq("step_key", drillStep)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as SlowJob[];
    },
    enabled: !!drillStep,
    staleTime: 10_000,
  });

  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    list.sort((a, b) => (b.run_p95_ms ?? 0) - (a.run_p95_ms ?? 0));
    return list;
  }, [rows]);

  const hasIssues = useMemo(
    () => sorted.some((r) => severity(r.run_p95_ms, r.qwait_p95_ms) !== "green"),
    [sorted],
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Step-Duration (7d)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Lade…</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Step-Duration (7d) – Fehler</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">
          {String((error as any)?.message ?? error)}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              Step-Duration (7d)
              {!hasIssues ? (
                <Badge variant="secondary" className="text-[10px]">
                  Healthy
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-[10px]">
                  Bottleneck
                </Badge>
              )}
            </CardTitle>
            <div className="text-[10px] text-muted-foreground">
              p95 = Worst-Case-Signal · Refresh 30s
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Desktop table */}
          <div className="hidden md:block overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left p-2">Step</th>
                  <th className="text-right p-2">Done</th>
                  <th className="text-right p-2">Fail</th>
                  <th className="text-right p-2">Run p50</th>
                  <th className="text-right p-2">Run p95</th>
                  <th className="text-right p-2">Queue p95</th>
                  <th className="text-right p-2">Retries</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((r) => {
                  const sev = severity(r.run_p95_ms, r.qwait_p95_ms);
                  return (
                    <tr
                      key={r.step_key}
                      className="hover:bg-muted/40 cursor-pointer"
                      onClick={() => {
                        setDrillStep(r.step_key);
                        setOpen(true);
                      }}
                    >
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <Dot level={sev} />
                          <div className="font-medium">{prettyStep(r.step_key)}</div>
                        </div>
                        <div className="text-[10px] text-muted-foreground">{r.job_type}</div>
                      </td>
                      <td className="text-right p-2">{r.completed}</td>
                      <td
                        className={`text-right p-2 ${
                          r.failed_or_cancelled > 0 ? "text-destructive font-semibold" : ""
                        }`}
                      >
                        {r.failed_or_cancelled}
                      </td>
                      <td className="text-right p-2">{fmtMs(r.run_p50_ms)}</td>
                      <td className="text-right p-2 font-semibold">{fmtMs(r.run_p95_ms)}</td>
                      <td className="text-right p-2">{fmtMs(r.qwait_p95_ms)}</td>
                      <td
                        className={`text-right p-2 ${
                          (r.attempts_avg ?? 1) >= 2 ? "text-destructive font-semibold" : ""
                        }`}
                      >
                        {(r.attempts_avg ?? 1).toFixed(1)}×
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {sorted.map((r) => {
              const sev = severity(r.run_p95_ms, r.qwait_p95_ms);
              return (
                <button
                  key={r.step_key}
                  className="w-full text-left rounded-lg border p-3 hover:bg-muted/40"
                  onClick={() => {
                    setDrillStep(r.step_key);
                    setOpen(true);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Dot level={sev} />
                      <div className="font-semibold text-sm">{prettyStep(r.step_key)}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {r.completed} done
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground space-y-1">
                    <div>
                      Run p95:{" "}
                      <span className="font-semibold text-foreground">{fmtMs(r.run_p95_ms)}</span>
                    </div>
                    <div>
                      Queue p95: {fmtMs(r.qwait_p95_ms)} · Retries:{" "}
                      {(r.attempts_avg ?? 1).toFixed(1)}×
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 text-[10px] text-muted-foreground">
            Queue-p95 hoch = Capacity/WIP/Rate-Limit · Run-p95 hoch = Step teuer (LLM/IO/Validator)
          </div>
        </CardContent>
      </Card>

      {/* Drilldown Sheet */}
      <Sheet
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setDrillStep(null);
        }}
      >
        <SheetContent side="right" className="w-[96vw] sm:w-[560px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-sm">
              {drillStep ? `${prettyStep(drillStep)} – Slowest Runs (7d)` : "Slowest Runs"}
            </SheetTitle>
            <div className="text-xs text-muted-foreground">
              Top 20 langsamste completed Jobs für diesen Step.
            </div>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {!slowJobs || slowJobs.length === 0 ? (
              <div className="text-sm text-muted-foreground">Keine Daten</div>
            ) : (
              <div className="divide-y rounded-lg border">
                {slowJobs.map((j) => (
                  <div key={j.job_id} className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">
                        {j.job_id.slice(0, 12)}…
                        {j.package_id ? (
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            pkg {j.package_id.slice(0, 8)}
                          </span>
                        ) : null}
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {fmtMs(j.run_ms)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Wait: {fmtMs(j.queue_wait_ms)} · Attempts: {j.attempts}
                    </div>
                    {j.completed_at ? (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(j.completed_at).toLocaleString("de-DE")}
                      </div>
                    ) : null}
                    {j.error_snip ? (
                      <div className="mt-2 text-[11px] text-muted-foreground whitespace-pre-wrap">
                        {j.error_snip}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>
              Schließen
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
