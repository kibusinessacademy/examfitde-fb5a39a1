import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/admin/cards/KpiCard';
import {
  AlertTriangle, CheckCircle2, Loader2, PauseCircle, PlayCircle,
  RefreshCw, Search, ShieldAlert, TimerReset, ArrowUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type PipelineRow = {
  package_id: string;
  title: string | null;
  curriculum_title: string | null;
  package_status: string;
  priority: number;
  wave_label: string;
  wave_order: number;
  updated_at: string | null;
  jobs_pending: number;
  jobs_processing: number;
  jobs_completed: number;
  jobs_failed: number;
  jobs_cancelled: number;
  locked_jobs: number;
  locked_by: string | null;
  job_types: string | null;
  pipeline_state: string;
};

type SortKey = 'wave_order' | 'priority' | 'updated_at' | 'jobs_pending' | 'jobs_processing' | 'jobs_failed' | 'title';

const REFRESH_MS = 20_000;

function minutesSince(value: string | null) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / 60000);
}

function stateColor(state: string) {
  switch (state) {
    case 'RUNNING': return 'bg-green-500/15 text-green-400 border-green-500/30';
    case 'READY': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'BLOCKED': return 'bg-red-500/15 text-red-400 border-red-500/30';
    case 'HAS_FAILURES': return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
    case 'BUILDING_WITHOUT_ACTIVE_JOB':
    case 'QUEUED_WITHOUT_PENDING_JOB': return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function statusColor(status: string) {
  switch (status) {
    case 'building': return 'bg-green-500/15 text-green-400 border-green-500/30';
    case 'queued': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'blocked': return 'bg-red-500/15 text-red-400 border-red-500/30';
    case 'published':
    case 'completed': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function progressPct(done: number, total: number) {
  if (!total) return 0;
  return Math.round((done / total) * 1000) / 10;
}

function fmtDate(v: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function PipelineMapDashboard() {
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [waveFilter, setWaveFilter] = useState('ALL');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('wave_order');
  const [sortAsc, setSortAsc] = useState(true);

  const fetchRows = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);

      const { data, error } = await (supabase as any)
        .from('ops_pipeline_map')
        .select('*')
        .order('wave_order', { ascending: true })
        .order('priority', { ascending: true })
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setRows((data ?? []) as PipelineRow[]);
    } catch {
      // silently fail on refresh
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRows(false);
    const id = window.setInterval(() => fetchRows(true), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [fetchRows]);

  // Filters & sort
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let next = [...rows];
    if (q) next = next.filter(r =>
      [r.title, r.curriculum_title, r.wave_label, r.package_status, r.pipeline_state, r.job_types]
        .join(' ').toLowerCase().includes(q)
    );
    if (waveFilter !== 'ALL') next = next.filter(r => r.wave_label === waveFilter);
    if (stateFilter !== 'ALL') next = next.filter(r => r.pipeline_state === stateFilter);
    next.sort((a, b) => {
      const av = a[sortKey] as any, bv = b[sortKey] as any;
      let cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), 'de');
      return sortAsc ? cmp : -cmp;
    });
    return next;
  }, [rows, search, waveFilter, stateFilter, sortKey, sortAsc]);

  // KPIs
  const summary = useMemo(() => ({
    activeBuilds: rows.filter(r => r.package_status === 'building').length,
    running: rows.filter(r => r.pipeline_state === 'RUNNING').length,
    readyQueue: rows.filter(r => r.pipeline_state === 'READY').length,
    recoveryQueue: rows.filter(r => r.wave_label === 'W3 Recovery').length,
    blocked: rows.filter(r => r.package_status === 'blocked').length,
    wrongPriority: rows.filter(r => r.priority >= 100).length,
    stale: rows.filter(r => {
      const m = minutesSince(r.updated_at);
      return (r.package_status === 'queued' || r.package_status === 'building') && m !== null && m >= 30;
    }).length,
  }), [rows]);

  // Wave progress
  const waveProgress = useMemo(() => {
    const map = new Map<string, { label: string; order: number; total: number; done: number; building: number; queued: number; blocked: number }>();
    for (const r of rows) {
      if (!map.has(r.wave_label)) map.set(r.wave_label, { label: r.wave_label, order: r.wave_order, total: 0, done: 0, building: 0, queued: 0, blocked: 0 });
      const b = map.get(r.wave_label)!;
      b.total++;
      if (r.package_status === 'published' || r.package_status === 'completed') b.done++;
      if (r.package_status === 'building') b.building++;
      if (r.package_status === 'queued') b.queued++;
      if (r.package_status === 'blocked') b.blocked++;
    }
    return [...map.values()].sort((a, b) => a.order - b.order);
  }, [rows]);

  const waves = useMemo(() => ['ALL', ...new Set(rows.map(r => r.wave_label))], [rows]);
  const states = useMemo(() => ['ALL', ...new Set(rows.map(r => r.pipeline_state))], [rows]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(s => !s);
    else { setSortKey(key); setSortAsc(true); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Pipeline Control Tower</h2>
          <p className="text-sm text-muted-foreground">Waves · Prioritäten · Runner-Aktivität · Blocker</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchRows(true)} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Aktualisieren
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <KpiCard label="Active Builds" value={summary.activeBuilds} icon={<PlayCircle className="h-4 w-4 text-green-400" />} />
        <KpiCard label="Running" value={summary.running} icon={<Loader2 className="h-4 w-4 text-blue-400" />} />
        <KpiCard label="Ready Queue" value={summary.readyQueue} icon={<CheckCircle2 className="h-4 w-4 text-primary" />} />
        <KpiCard label="Recovery" value={summary.recoveryQueue} icon={<TimerReset className="h-4 w-4 text-purple-400" />} />
        <KpiCard label="Blocked" value={summary.blocked} icon={<ShieldAlert className="h-4 w-4 text-red-400" />} />
        <KpiCard label="Wrong Prio" value={summary.wrongPriority} icon={<AlertTriangle className="h-4 w-4 text-orange-400" />} />
        <KpiCard label="Stale 30m+" value={summary.stale} icon={<PauseCircle className="h-4 w-4 text-yellow-400" />} />
      </div>

      {/* Wave Progress */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Wave Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {waveProgress.map(w => (
            <div key={w.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{w.label}</span>
                <span className="text-muted-foreground text-xs">
                  {w.done}/{w.total} done · {w.building} building · {w.queued} queued · {w.blocked} blocked
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progressPct(w.done, w.total)}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suche Paket, Wave, Jobtyp..."
            className="pl-9"
          />
        </div>
        <select
          value={waveFilter}
          onChange={e => setWaveFilter(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          {waves.map(w => <option key={w} value={w}>Wave: {w}</option>)}
        </select>
        <select
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          {states.map(s => <option key={s} value={s}>State: {s}</option>)}
        </select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <ThSort label="Wave" sortKey="wave_order" current={sortKey} asc={sortAsc} onToggle={toggleSort} />
                  <ThSort label="Prio" sortKey="priority" current={sortKey} asc={sortAsc} onToggle={toggleSort} />
                  <ThSort label="Paket" sortKey="title" current={sortKey} asc={sortAsc} onToggle={toggleSort} />
                  <th className="px-3 py-2.5 text-left">Status</th>
                  <th className="px-3 py-2.5 text-left">Pipeline</th>
                  <ThSort label="Pend" sortKey="jobs_pending" current={sortKey} asc={sortAsc} onToggle={toggleSort} />
                  <ThSort label="Proc" sortKey="jobs_processing" current={sortKey} asc={sortAsc} onToggle={toggleSort} />
                  <ThSort label="Fail" sortKey="jobs_failed" current={sortKey} asc={sortAsc} onToggle={toggleSort} />
                  <th className="px-3 py-2.5 text-left">Runner</th>
                  <ThSort label="Update" sortKey="updated_at" current={sortKey} asc={sortAsc} onToggle={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Keine Pakete gefunden</td></tr>
                ) : filtered.map(r => (
                  <tr key={r.package_id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{r.wave_label}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{r.priority}</td>
                    <td className="px-3 py-2.5 max-w-[220px] truncate font-medium text-foreground" title={r.title ?? ''}>
                      {r.title ?? r.package_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={cn('text-xs', statusColor(r.package_status))}>{r.package_status}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={cn('text-xs', stateColor(r.pipeline_state))}>{r.pipeline_state}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">{r.jobs_pending}</td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">{r.jobs_processing}</td>
                    <td className={cn('px-3 py-2.5 text-center font-mono text-xs', r.jobs_failed > 0 && 'text-red-400 font-semibold')}>{r.jobs_failed}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground truncate max-w-[100px]">{r.locked_by ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ThSort({ label, sortKey, current, asc, onToggle }: {
  label: string; sortKey: SortKey; current: SortKey; asc: boolean;
  onToggle: (k: SortKey) => void;
}) {
  return (
    <th
      className="px-3 py-2.5 text-left cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onToggle(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {current === sortKey && <ArrowUpDown className={cn('h-3 w-3', !asc && 'rotate-180')} />}
      </span>
    </th>
  );
}
