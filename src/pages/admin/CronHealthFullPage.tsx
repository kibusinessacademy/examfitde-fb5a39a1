import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Helmet } from 'react-helmet-async';
import { RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';

type Row = {
  job_name: string;
  schedule: string | null;
  active: boolean;
  command_excerpt: string | null;
  run_count_24h: number;
  success_count_24h: number;
  fail_count_24h: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
  last_status: string | null;
  last_run_at: string | null;
  last_message: string | null;
  health: string;
};

const HEALTH_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  healthy: 'default',
  lagging: 'secondary',
  degraded: 'destructive',
  last_run_failed: 'destructive',
  disabled: 'outline',
  never_ran: 'destructive',
  unknown: 'outline',
};

function fmtRel(iso: string | null) {
  if (!iso) return '—';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export default function CronHealthFullPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_get_cron_health_full' as any);
    if (!error && data) setRows(data as Row[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const snapshot = async () => {
    setLoading(true);
    await supabase.rpc('fn_snapshot_cron_health' as any);
    await load();
  };

  const stats = useMemo(() => {
    const total = rows.length;
    const healthy = rows.filter(r => r.health === 'healthy').length;
    const failed = rows.filter(r => r.health === 'last_run_failed' || r.health === 'degraded').length;
    const idle = rows.filter(r => r.health === 'never_ran' || r.health === 'disabled' || r.health === 'lagging').length;
    return { total, healthy, failed, idle };
  }, [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (healthFilter !== 'all' && r.health !== healthFilter) return false;
    if (filter && !r.job_name.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  }), [rows, filter, healthFilter]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Helmet><title>Cron Health Full — Admin</title></Helmet>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cron Health Full</h1>
          <p className="text-muted-foreground">Live-Übersicht aller pg_cron-Jobs · 24h-Metriken · Audit-Snapshots</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={snapshot} disabled={loading}>Snapshot jetzt</Button>
          <Button onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" />Gesamt</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{stats.total}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" />Healthy</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{stats.healthy}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-red-600"><XCircle className="h-4 w-4" />Failed / Degraded</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{stats.failed}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-orange-600"><AlertTriangle className="h-4 w-4" />Idle / Lagging</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{stats.idle}</CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex gap-2 items-center">
            <Input placeholder="Job-Name filtern…" value={filter} onChange={e => setFilter(e.target.value)} className="max-w-sm" />
            <div className="flex gap-1">
              {['all', 'healthy', 'last_run_failed', 'degraded', 'lagging', 'never_ran', 'disabled'].map(h => (
                <Button key={h} size="sm" variant={healthFilter === h ? 'default' : 'outline'} onClick={() => setHealthFilter(h)}>{h}</Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Health</th>
                  <th className="p-2">Job</th>
                  <th className="p-2">Schedule</th>
                  <th className="p-2 text-right">Runs 24h</th>
                  <th className="p-2 text-right">Fails 24h</th>
                  <th className="p-2 text-right">p95 ms</th>
                  <th className="p-2 text-right">max ms</th>
                  <th className="p-2">Last Run</th>
                  <th className="p-2">Last Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.job_name} className="border-b hover:bg-muted/30">
                    <td className="p-2"><Badge variant={HEALTH_VARIANT[r.health] || 'outline'}>{r.health}</Badge></td>
                    <td className="p-2 font-mono text-xs">{r.job_name}</td>
                    <td className="p-2 font-mono text-xs">{r.schedule}</td>
                    <td className="p-2 text-right">{r.run_count_24h}</td>
                    <td className="p-2 text-right">{r.fail_count_24h > 0 ? <span className="text-red-600 font-semibold">{r.fail_count_24h}</span> : 0}</td>
                    <td className="p-2 text-right">{r.p95_ms ?? '—'}</td>
                    <td className="p-2 text-right">{r.max_ms ?? '—'}</td>
                    <td className="p-2 text-xs">{fmtRel(r.last_run_at)}</td>
                    <td className="p-2 text-xs">{r.last_status ?? '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">{loading ? 'Lade…' : 'Keine Treffer'}</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
