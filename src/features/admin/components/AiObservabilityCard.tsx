/**
 * P20 Cut 0A — AI Runtime Observability Card
 * Read-only View auf admin_get_ai_observability_summary.
 * Keine Mutation. Keine AI-Ausführung.
 */
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Radar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface ObservabilityRow {
  model: string | null;
  job_type: string | null;
  events_total: number | null;
  hallucinations: number | null;
  grounding_misses: number | null;
  scope_violations: number | null;
  eval_drifts: number | null;
  rollbacks: number | null;
  critical_events: number | null;
  hallucination_rate_pct: number | null;
  grounding_miss_rate_pct: number | null;
  scope_violation_rate_pct: number | null;
  last_observed_at: string | null;
}

function num(n: number | null | undefined): number {
  return Number(n ?? 0);
}

export default function AiObservabilityCard() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'ai-observability-summary'],
    queryFn: async (): Promise<ObservabilityRow[]> => {
      const { data, error } = await supabase.rpc('admin_get_ai_observability_summary');
      if (error) throw error;
      return (data ?? []) as ObservabilityRow[];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const rows = data ?? [];
  const totals = rows.reduce(
    (acc, r) => ({
      events: acc.events + num(r.events_total),
      hallucinations: acc.hallucinations + num(r.hallucinations),
      grounding: acc.grounding + num(r.grounding_misses),
      scope: acc.scope + num(r.scope_violations),
      drifts: acc.drifts + num(r.eval_drifts),
      rollbacks: acc.rollbacks + num(r.rollbacks),
      critical: acc.critical + num(r.critical_events),
    }),
    { events: 0, hallucinations: 0, grounding: 0, scope: 0, drifts: 0, rollbacks: 0, critical: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radar className="h-4 w-4" />
              AI Observability
            </CardTitle>
            <CardDescription>
              Modellgesundheit pro <code>model × job_type</code>: Halluzinationen, Grounding-Miss,
              Scope-Violations, Drifts, Rollbacks. Read-only via{' '}
              <code>admin_get_ai_observability_summary</code>.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {isFetching && <Badge variant="outline" className="text-[10px]">refresh</Badge>}
            <button
              onClick={() => refetch()}
              className="text-xs text-fg-muted hover:text-fg-default underline"
            >
              Reload
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Observability nicht ladbar</AlertTitle>
            <AlertDescription>
              <code className="text-xs">{(error as Error).message}</code>
              <button
                onClick={() => refetch()}
                className="ml-2 underline text-xs"
              >
                Retry
              </button>
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <Alert>
            <AlertTitle>Keine Observability-Daten</AlertTitle>
            <AlertDescription>
              Noch keine AI-Events erfasst. Sobald der nächste{' '}
              <code>ai-eval-worker</code>-Lauf Daten produziert, erscheinen sie hier.
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !error && rows.length > 0 && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
              <KpiTile label="Events" value={totals.events} />
              <KpiTile label="Halluc." value={totals.hallucinations} tone={totals.hallucinations > 0 ? 'warn' : 'ok'} />
              <KpiTile label="Grounding-Miss" value={totals.grounding} tone={totals.grounding > 0 ? 'warn' : 'ok'} />
              <KpiTile label="Scope-Viol." value={totals.scope} tone={totals.scope > 0 ? 'warn' : 'ok'} />
              <KpiTile label="Drifts" value={totals.drifts} />
              <KpiTile label="Rollbacks" value={totals.rollbacks} />
              <KpiTile label="Critical" value={totals.critical} tone={totals.critical > 0 ? 'crit' : 'ok'} />
            </div>

            {/* Detail table */}
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Job-Type</TableHead>
                    <TableHead className="text-right">Events</TableHead>
                    <TableHead className="text-right">Halluc.%</TableHead>
                    <TableHead className="text-right">Ground-Miss%</TableHead>
                    <TableHead className="text-right">Scope-Viol.%</TableHead>
                    <TableHead className="text-right">Critical</TableHead>
                    <TableHead>Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.model}-${r.job_type}-${i}`}>
                      <TableCell className="font-mono text-xs">{r.model ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.job_type ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.events_total)}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.hallucination_rate_pct).toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.grounding_miss_rate_pct).toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.scope_violation_rate_pct).toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(r.critical_events) > 0 ? (
                          <Badge variant="destructive" className="text-[10px]">{num(r.critical_events)}</Badge>
                        ) : (
                          <span className="text-fg-muted">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {r.last_observed_at
                          ? new Date(r.last_observed_at).toLocaleString()
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-fg-muted">
              Read-only. Keine Mutationen, keine AI-Ausführung aus dieser Card.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function KpiTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'ok' | 'warn' | 'crit' | 'neutral';
}) {
  const toneClass =
    tone === 'crit'
      ? 'text-status-bg-subtle-error border-border'
      : tone === 'warn'
        ? 'text-fg-default border-border'
        : 'text-fg-default border-border';
  return (
    <div className={`rounded-md border ${toneClass} p-2`}>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
