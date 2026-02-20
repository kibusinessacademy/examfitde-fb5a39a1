import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Timer, AlertTriangle, Clock, RotateCcw, TrendingUp } from 'lucide-react';

type StepRow = {
  step_key: string;
  job_type: string;
  completed: number;
  failed_or_cancelled: number;
  processing: number;
  pending: number;
  qwait_p50_ms: number | null;
  qwait_p90_ms: number | null;
  qwait_p95_ms: number | null;
  run_p50_ms: number | null;
  run_p90_ms: number | null;
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
  return `${(ms / 60_000).toFixed(1)}m`;
}

function severity(runP95: number | null, qwaitP95: number | null): 'red' | 'amber' | 'green' {
  if ((runP95 ?? 0) > 120_000 || (qwaitP95 ?? 0) > 60_000) return 'red';
  if ((runP95 ?? 0) > 60_000 || (qwaitP95 ?? 0) > 30_000) return 'amber';
  return 'green';
}

function SeverityDot({ level }: { level: 'red' | 'amber' | 'green' }) {
  return (
    <span className={cn(
      'inline-block h-2 w-2 rounded-full shrink-0',
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
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {/* Desktop */}
          <div className="hidden sm:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Step</TableHead>
                  <TableHead className="text-right">Done</TableHead>
                  <TableHead className="text-right">Fail</TableHead>
                  <TableHead className="text-right">Run p50</TableHead>
                  <TableHead className="text-right">Run p95</TableHead>
                  <TableHead className="text-right">Queue p95</TableHead>
                  <TableHead className="text-right pr-4">Retries</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(r => {
                  const sev = severity(r.run_p95_ms, r.qwait_p95_ms);
                  return (
                    <TableRow
                      key={r.step_key}
                      className={cn(
                        'cursor-pointer',
                        sev === 'red' && 'bg-destructive/5',
                        sev === 'amber' && 'bg-amber-500/5',
                      )}
                      onClick={() => setDrillStep(r.step_key)}
                    >
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-1.5">
                          <SeverityDot level={sev} />
                          <span className="text-sm font-medium">{friendlyStep(r.step_key)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{r.completed}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        <span className={r.failed_or_cancelled > 0 ? 'text-destructive' : ''}>{r.failed_or_cancelled}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmtMs(r.run_p50_ms)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold">{fmtMs(r.run_p95_ms)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmtMs(r.qwait_p95_ms)}</TableCell>
                      <TableCell className="text-right pr-4 font-mono text-sm">
                        <span className={(r.attempts_avg ?? 1) > 2 ? 'text-destructive font-bold' : ''}>
                          {(r.attempts_avg ?? 1).toFixed(1)}×
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {/* Mobile */}
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
                  onClick={() => setDrillStep(r.step_key)}
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
        </CardContent>
      </Card>

      {/* Drilldown Drawer */}
      <Drawer open={!!drillStep} onOpenChange={open => !open && setDrillStep(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-primary" />
              {drillStep ? friendlyStep(drillStep) : ''} – Slowest Runs (7d)
            </DrawerTitle>
            <DrawerDescription>Top 20 langsamste abgeschlossene Jobs für diesen Step.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-6 max-h-[50vh] overflow-y-auto">
            {(!slowJobs || slowJobs.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-4">Keine Daten</p>
            ) : (
              <div className="space-y-2">
                {slowJobs.map(j => (
                  <div key={j.job_id} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-muted-foreground">{j.job_id.slice(0, 12)}…</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{fmtMs(j.run_ms)}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>Wait: {fmtMs(j.queue_wait_ms)}</span>
                      <span>Attempts: {j.attempts}</span>
                      <span>{j.package_id?.slice(0, 8)}</span>
                    </div>
                    {j.completed_at && (
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(j.completed_at).toLocaleString('de-DE')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
