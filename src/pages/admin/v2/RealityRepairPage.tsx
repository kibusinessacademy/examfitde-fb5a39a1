/**
 * P0-D — Reality Repair Dashboard
 *
 * Single source of truth: "Ist ExamFit besser geworden?"
 * Liest statisch /reality/latest.json + /reality/history.json (vom
 * Customer-Reality-Triage Workflow committed). Keine DB, kein Edge.
 */
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, ArrowDown, ArrowUp, Minus, RefreshCw } from 'lucide-react';

interface Finding {
  fingerprint: string;
  severity: 'P0' | 'P1' | 'P2';
  kind: string;
  journey: string;
  route?: string;
  detail: string;
  owner: string;
  surface: string;
  fix_hint: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
}
interface Latest {
  ts: string | null;
  overall: 'RELEASE' | 'REVIEW' | 'BLOCK';
  runs: {
    learner?: { status: string; score: number; max_score: number } | null;
    pre_customer?: { status: string; score: number; max_score: number; time_to_course_ms?: number | null; time_to_course_ok?: boolean } | null;
  };
  counts: { p0: number; p1: number; p2: number; total: number };
  trend: {
    baseline_finding_count: number;
    current_finding_count: number;
    delta: number;
    new_count: number;
    resolved_count: number;
    new_p0: number;
    baseline_ts: string | null;
  } | null;
  ttr_hours_avg: number | null;
  ttr_samples: number;
  top_causes: { owner: string; kind: string; count: number }[];
  findings: Finding[];
  resolved_since_last: string[];
  history_entries: number;
}
interface HistoryEntry {
  ts: string;
  overall: string;
  counts: { p0: number; p1: number; p2: number; total: number };
  fingerprints: string[];
  new_fps: string[];
  resolved_fps: string[];
}

const SEV_STYLES: Record<string, string> = {
  P0: 'bg-status-danger-bg-subtle text-status-danger border-status-danger/30',
  P1: 'bg-status-warning-bg-subtle text-status-warning border-status-warning/30',
  P2: 'bg-status-info-bg-subtle text-status-info border-status-info/30',
};
const OVERALL_STYLES: Record<string, string> = {
  RELEASE: 'bg-status-success-bg-subtle text-status-success border-status-success/30',
  REVIEW: 'bg-status-warning-bg-subtle text-status-warning border-status-warning/30',
  BLOCK: 'bg-status-danger-bg-subtle text-status-danger border-status-danger/30',
};

function fmtAgo(iso?: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function useLatest() {
  return useQuery({
    queryKey: ['reality-latest'],
    queryFn: async () => {
      const r = await fetch(`/reality/latest.json?ts=${Date.now()}`);
      if (!r.ok) throw new Error('latest.json missing');
      return r.json() as Promise<Latest>;
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
}
function useHistory() {
  return useQuery({
    queryKey: ['reality-history'],
    queryFn: async () => {
      const r = await fetch(`/reality/history.json?ts=${Date.now()}`);
      if (!r.ok) throw new Error('history.json missing');
      return r.json() as Promise<HistoryEntry[]>;
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
}

function TrendArrow({ delta }: { delta: number }) {
  if (delta === 0) return <Minus className="h-4 w-4 text-text-muted" aria-label="stable" />;
  if (delta < 0) return <ArrowDown className="h-4 w-4 text-status-success" aria-label="improving" />;
  return <ArrowUp className="h-4 w-4 text-status-danger" aria-label="regressing" />;
}

function Sparkline({ values, height = 32, width = 160 }: { values: number[]; height?: number; width?: number }) {
  if (!values.length) return <div className="h-8 w-40 bg-surface-subtle rounded" />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} className="text-primary">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function windowAvg(hist: HistoryEntry[], days: number): { current: number; previous: number; series: number[] } {
  const now = Date.now();
  const cutoffMs = days * 86_400_000;
  const current = hist.filter((h) => now - new Date(h.ts).getTime() <= cutoffMs);
  const previous = hist.filter((h) => {
    const age = now - new Date(h.ts).getTime();
    return age > cutoffMs && age <= cutoffMs * 2;
  });
  const avg = (xs: HistoryEntry[]) => (xs.length ? xs.reduce((s, x) => s + (x.counts?.total ?? 0), 0) / xs.length : 0);
  return {
    current: avg(current),
    previous: avg(previous),
    series: current.map((h) => h.counts?.total ?? 0),
  };
}

function regressions(latest: Latest, hist: HistoryEntry[]): Finding[] {
  if (!hist.length) return [];
  // Findings whose fingerprint was missing in any previous snapshot but is present now
  const wasMissingAnyPrev = (fp: string) => hist.slice(0, -1).some((h) => !h.fingerprints.includes(fp));
  return latest.findings.filter((f) => wasMissingAnyPrev(f.fingerprint));
}

export default function RealityRepairPage() {
  const latestQ = useLatest();
  const historyQ = useHistory();

  if (latestQ.isLoading || historyQ.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-1/3" />
        <div className="grid grid-cols-4 gap-4"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (latestQ.error || !latestQ.data) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-status-warning mt-0.5" />
            <div>
              <p className="font-medium">Noch keine Triage-Daten verfügbar.</p>
              <p className="text-sm text-text-muted mt-1">
                Sobald der Workflow <code className="text-xs">customer-reality-triage</code> einmal gelaufen ist,
                erscheinen hier alle Findings, Trends und Top-Ursachen. Manuell triggern via GitHub Actions.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const latest = latestQ.data;
  const history = historyQ.data ?? [];
  const w7 = windowAvg(history, 7);
  const w30 = windowAvg(history, 30);
  const regs = regressions(latest, history);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reality Repair Dashboard</h1>
          <p className="text-sm text-text-muted mt-1">
            Ist ExamFit besser geworden? — Letzte Triage: {fmtAgo(latest.ts)} · {history.length} Snapshots
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className={OVERALL_STYLES[latest.overall]}>
            Overall: {latest.overall}
          </Badge>
          <button
            onClick={() => { latestQ.refetch(); historyQ.refetch(); }}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-subtle"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-text-muted">Open P0</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-status-danger">{latest.counts.p0}</div>
            <p className="text-xs text-text-muted mt-1">Auto-Issues offen · sofortiger Fix-Bedarf</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-text-muted">Open P1 / P2</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{latest.counts.p1}<span className="text-text-muted text-xl"> / {latest.counts.p2}</span></div>
            <p className="text-xs text-text-muted mt-1">P1 wöchentlich clustern · P2 Backlog</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-text-muted">Trend vs. Baseline</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendArrow delta={latest.trend?.delta ?? 0} />
              <span className="text-3xl font-semibold">{(latest.trend?.delta ?? 0) > 0 ? '+' : ''}{latest.trend?.delta ?? 0}</span>
            </div>
            <p className="text-xs text-text-muted mt-1">
              🆕 {latest.trend?.new_count ?? 0} new (P0 {latest.trend?.new_p0 ?? 0}) · ✅ {latest.trend?.resolved_count ?? 0} resolved
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-text-muted">Time-To-Resolution</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">
              {latest.ttr_hours_avg != null ? `${latest.ttr_hours_avg.toFixed(1)}h` : '—'}
            </div>
            <p className="text-xs text-text-muted mt-1">Ø über {latest.ttr_samples} resolved Findings</p>
          </CardContent>
        </Card>
      </div>

      {/* Run states + sparklines */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Trend 7d</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-semibold">{w7.current.toFixed(1)}</div>
                <p className="text-xs text-text-muted">Ø Findings · vorher {w7.previous.toFixed(1)}</p>
              </div>
              <Sparkline values={w7.series} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Trend 30d</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-semibold">{w30.current.toFixed(1)}</div>
                <p className="text-xs text-text-muted">Ø Findings · vorher {w30.previous.toFixed(1)}</p>
              </div>
              <Sparkline values={w30.series} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Runs</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">learner-reality</span>
              <Badge variant="outline" className={OVERALL_STYLES[latest.runs?.learner?.status ?? 'REVIEW']}>
                {latest.runs?.learner?.status ?? '—'} · {latest.runs?.learner?.score ?? '–'}/{latest.runs?.learner?.max_score ?? '–'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">pre-customer-reality</span>
              <Badge variant="outline" className={OVERALL_STYLES[latest.runs?.pre_customer?.status ?? 'REVIEW']}>
                {latest.runs?.pre_customer?.status ?? '—'} · {latest.runs?.pre_customer?.score ?? '–'}/{latest.runs?.pre_customer?.max_score ?? '–'}
              </Badge>
            </div>
            {latest.runs?.pre_customer?.time_to_course_ms != null && (
              <div className="text-xs text-text-muted">
                TIME_TO_COURSE: {(latest.runs.pre_customer.time_to_course_ms / 1000).toFixed(1)}s
                {latest.runs.pre_customer.time_to_course_ok ? ' ✅' : ' ⚠️'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top 10 causes */}
      <Card>
        <CardHeader><CardTitle>Top 10 Root Causes</CardTitle></CardHeader>
        <CardContent>
          {latest.top_causes.length === 0 ? (
            <p className="text-sm text-text-muted">Keine Findings — alles grün.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Owner</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latest.top_causes.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{c.owner}</TableCell>
                    <TableCell>{c.kind}</TableCell>
                    <TableCell className="text-right font-semibold">{c.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Regressions */}
      {regs.length > 0 && (
        <Card className="border-status-warning/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-warning" /> Regressionen ({regs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {regs.slice(0, 10).map((f) => (
                <li key={f.fingerprint} className="flex items-start gap-2">
                  <Badge variant="outline" className={SEV_STYLES[f.severity]}>{f.severity}</Badge>
                  <div>
                    <div className="font-medium">{f.kind} · <span className="font-mono text-xs">{f.route ?? f.journey}</span></div>
                    <div className="text-text-muted text-xs">{f.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Fix-Queue */}
      <Card>
        <CardHeader><CardTitle>Open Fix-Queue ({latest.counts.total})</CardTitle></CardHeader>
        <CardContent>
          {latest.findings.length === 0 ? (
            <p className="text-sm text-text-muted">Keine offenen Findings — Reality grün.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sev</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Route / Journey</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="text-right">×</TableHead>
                    <TableHead>Erstmals</TableHead>
                    <TableHead>Fix-Hint</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latest.findings.slice(0, 100).map((f) => (
                    <TableRow key={f.fingerprint}>
                      <TableCell><Badge variant="outline" className={SEV_STYLES[f.severity]}>{f.severity}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{f.owner}</TableCell>
                      <TableCell className="text-xs">{f.kind}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[180px] truncate" title={f.route ?? f.journey}>{f.route ?? f.journey}</TableCell>
                      <TableCell className="text-xs max-w-[280px] truncate" title={f.detail}>{f.detail}</TableCell>
                      <TableCell className="text-right text-xs">{f.occurrences}</TableCell>
                      <TableCell className="text-xs text-text-muted">{fmtAgo(f.first_seen)}</TableCell>
                      <TableCell className="text-xs text-text-muted max-w-[260px] truncate" title={f.fix_hint}>{f.fix_hint}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {latest.findings.length > 100 && (
                <p className="text-xs text-text-muted mt-2">Zeige 100 von {latest.findings.length} — siehe Artifact für vollständige Liste.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <footer className="text-xs text-text-muted pt-4 border-t border-border">
        Data feed: <code>public/reality/latest.json</code> + <code>history.json</code> ·
        Quelle: GitHub Workflow <code>customer-reality-triage</code> ·
        SSOT: <code>scripts/customer-reality-triage.mjs</code>
      </footer>
    </div>
  );
}
