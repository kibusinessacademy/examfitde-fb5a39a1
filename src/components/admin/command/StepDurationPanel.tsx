import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Timer, Clock, RotateCcw, TrendingUp } from 'lucide-react';

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
  step_key: string;
  package_id: string | null;
  run_ms: number | null;
  queue_wait_ms: number | null;
  attempts: number;
  completed_at: string | null;
  error_snip: string | null;
};

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function severity(runP95: number | null, qwaitP95: number | null): 'red' | 'amber' | 'green' {
  if ((runP95 ?? 0) > 120_000 || (qwaitP95 ?? 0) > 60_000) return 'red';
  if ((runP95 ?? 0) > 60_000 || (qwaitP95 ?? 0) > 30_000) return 'amber';
  return 'green';
}

function SeverityDot({ level }: { level: 'red' | 'amber' | 'green' }) {
  return (
    <span className={cn(
      'inline-block h-2.5 w-2.5 rounded-full shrink-0',
      level === 'red' && 'bg-destructive',
      level === 'amber' && 'bg-amber-500',
      level === 'green' && 'bg-emerald-500',
    )} />
  );
}

function friendlyStep(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function StepDurationPanel() {
  const [drillStep, setDrillStep] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ['ops-step-duration-7d'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ops_step_duration_7d')
        .select('*');
      if (error) throw error;
      return (data ?? []) as StepRow[];
    },
    refetchInterval: 30_000,
  });

  const { data: slowJobs } = useQuery({
    queryKey: ['ops-step-slowest-7d', drillStep],
    queryFn: async () => {
      if (!drillStep) return [];
      const { data, error } = await (supabase as any)
        .from('ops_step_duration_slowest_7d')
        .select('job_id, step_key, package_id, run_ms, queue_wait_ms, attempts, completed_at, error_snip')
        .eq('step_key', drillStep)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as SlowJob[];
    },
    enabled: !!drillStep,
  });

  if (isLoading || !rows) return null;

  const sorted = [...rows].sort((a, b) => (b.run_p95_ms ?? 0) - (a.run_p95_ms ?? 0));
  const hasIssues = sorted.some(r => severity(r.run_p95_ms, r.qwait_p95_ms) !== 'green');

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Timer className="h-4 w-4 text-primary" />
            Step-Duration (7d)
            {!hasIssues ? (
              <Badge variant="secondary" className="text-[10px]">Healthy</Badge>
            ) : (
              <Badge variant="destructive" className="text-[10px]">Bottleneck</Badge>
            )}
          </CardTitle>
          <div className="text-[10px] text-muted-foreground">p95 = Worst-Case-Signal · Refresh 30s</div>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left p-2 pl-4">Step</th>
                  <th className="text-right p-2">Done</th>
                  <th className="text-right p-2">Fail</th>
                  <th className="text-right p-2">Run p50</th>
                  <th className="text-right p-2">Run p95</th>
                  <th className="text-right p-2">Queue p95</th>
                  <th className="text-right p-2 pr-4">Retries</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map(r => {
                  const sev = severity(r.run_p95_ms, r.qwait_p95_ms);
                  return (
                    <tr
                      key={r.step_key}
                      className={cn(
                        'cursor-pointer hover:bg-muted/50',
                        sev === 'red' && 'bg-destructive/5',
                        sev === 'amber' && 'bg-amber-500/5',
                      )}
                      onClick={() => { setDrillStep(r.step_key); setOpen(true); }}
                    >
                      <td className="p-2 pl-4">
                        <div className="flex items-center gap-1.5">
                          <SeverityDot level={sev} />
                          <span className="font-medium">{friendlyStep(r.step_key)}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">{r.job_type}</div>
                      </td>
                      <td className="text-right p-2 font-mono">{r.completed}</td>
                      <td className="text-right p-2 font-mono">
                        <span className={r.failed_or_cancelled > 0 ? 'text-destructive font-semibold' : ''}>{r.failed_or_cancelled}</span>
                      </td>
                      <td className="text-right p-2 font-mono">{fmtMs(r.run_p50_ms)}</td>
                      <td className="text-right p-2 font-mono font-bold">{fmtMs(r.run_p95_ms)}</td>
                      <td className="text-right p-2 font-mono">{fmtMs(r.qwait_p95_ms)}</td>
                      <td className="text-right p-2 pr-4 font-mono">
                        <span className={(r.attempts_avg ?? 1) > 2 ? 'text-destructive font-bold' : ''}>
                          {(r.attempts_avg ?? 1).toFixed(1)}×
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2 p-3">
            {sorted.map(r => {
              const sev = severity(r.run_p95_ms, r.qwait_p95_ms);
              return (
                <div
                  key={r.step_key}
                  className={cn(
                    'border rounded-lg p-3 space-y-1 cursor-pointer',
                    sev === 'red' && 'border-destructive/30 bg-destructive/5',
                    sev === 'amber' && 'border-amber-500/30 bg-amber-500/5',
                  )}
                  onClick={() => { setDrillStep(r.step_key); setOpen(true); }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <SeverityDot level={sev} />
                      <span className="font-medium text-sm">{friendlyStep(r.step_key)}</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{r.completed} done</span>
                  </div>
                  <div className="grid grid-cols-3 text-[10px] text-muted-foreground gap-1">
                    <div><Clock className="h-3 w-3 inline mr-0.5" />p95: {fmtMs(r.run_p95_ms)}</div>
                    <div><TrendingUp className="h-3 w-3 inline mr-0.5" />Wait: {fmtMs(r.qwait_p95_ms)}</div>
                    <div><RotateCcw className="h-3 w-3 inline mr-0.5" />{(r.attempts_avg ?? 1).toFixed(1)}×</div>
                  </div>
                </div>
              );
            })}
          </div>

          <Separator className="mt-2" />
          <div className="text-[10px] text-muted-foreground px-4 py-2">
            Hohe Queue-p95 = Runner/Rate-Limit-Engpass · Hohe Run-p95 = Step teuer (LLM, IO)
          </div>
        </CardContent>
      </Card>

      {/* Drilldown Sheet */}
      <Sheet open={open} onOpenChange={v => { setOpen(v); if (!v) setDrillStep(null); }}>
        <SheetContent side="right" className="w-[96vw] sm:w-[520px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-sm flex items-center gap-2">
              <Timer className="h-5 w-5 text-primary" />
              {drillStep ? `${friendlyStep(drillStep)} – Slowest Runs (7d)` : ''}
            </SheetTitle>
            <div className="text-xs text-muted-foreground">
              Top 20 langsamste <b>completed</b> Jobs für diesen Step.
            </div>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {(!slowJobs || slowJobs.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-4">Keine Daten</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {slowJobs.map(j => (
                  <div key={j.job_id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-muted-foreground">{j.job_id.slice(0, 12)}…</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{fmtMs(j.run_ms)}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>Wait: {fmtMs(j.queue_wait_ms)}</span>
                      <span>Attempts: {j.attempts}</span>
                      {j.package_id && <span>pkg {j.package_id.slice(0, 8)}</span>}
                    </div>
                    {j.completed_at && (
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(j.completed_at).toLocaleString('de-DE')}
                      </div>
                    )}
                    {j.error_snip && (
                      <div className="text-[10px] text-muted-foreground whitespace-pre-wrap mt-1">{j.error_snip}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Button variant="outline" className="w-full" onClick={() => { setOpen(false); setDrillStep(null); }}>
              Schließen
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
