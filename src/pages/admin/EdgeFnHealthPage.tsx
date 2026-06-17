import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Helmet } from 'react-helmet-async';

type Row = {
  name: string;
  bytes: number;
  loc: number;
  manually_tagged_cluster: string | null;
  updated_at: string;
  has_cron: boolean;
  cron_schedules: string[] | null;
  cron_count: number;
  size_class: 'huge' | 'large' | 'normal';
  path_class: 'hot-path' | 'cold-tail';
};

function bytesToKB(b: number) {
  return (b / 1024).toFixed(1) + ' KB';
}

function toCSV(rows: Row[]): string {
  const head = ['name', 'bytes', 'loc', 'cluster', 'has_cron', 'cron_count', 'cron_schedules', 'size_class', 'path_class'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      r.name,
      r.bytes,
      r.loc,
      r.manually_tagged_cluster ?? '',
      r.has_cron,
      r.cron_count,
      (r.cron_schedules ?? []).join('|'),
      r.size_class,
      r.path_class,
    ].join(','));
  }
  return lines.join('\n');
}

export default function EdgeFnHealthPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pathFilter, setPathFilter] = useState<string>('all');
  const [sizeFilter, setSizeFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'bytes' | 'loc' | 'name'>('bytes');

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('v_admin_edge_fn_health' as any)
        .select('*')
        .order('bytes', { ascending: false });
      if (error) setError(error.message);
      else setRows(((data ?? []) as unknown) as Row[]);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const total = rows.length;
    const hot = rows.filter(r => r.has_cron).length;
    const cold = total - hot;
    const huge = rows.filter(r => r.size_class === 'huge').length;
    const large = rows.filter(r => r.size_class === 'large').length;
    const totalKB = rows.reduce((s, r) => s + r.bytes, 0) / 1024;
    return { total, hot, cold, huge, large, totalKB };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let f = rows.filter(r =>
      (!q || r.name.toLowerCase().includes(q)) &&
      (pathFilter === 'all' || r.path_class === pathFilter) &&
      (sizeFilter === 'all' || r.size_class === sizeFilter)
    );
    f = [...f].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return (b[sortBy] as number) - (a[sortBy] as number);
    });
    return f;
  }, [rows, query, pathFilter, sizeFilter, sortBy]);

  const downloadCSV = () => {
    const csv = toCSV(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edge-fn-health-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Helmet><title>Edge-Function-Health — Admin</title></Helmet>
      <div className="container mx-auto p-6 space-y-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Edge-Function-Health</h1>
          <p className="text-muted-foreground">
            Inventar aller Edge Functions mit Cron-Bindung, Größe und Cluster-Tag. Phase A der Konsolidierung — read-only.
          </p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Hot-Path (Cron)" value={stats.hot} tone="ok" />
          <StatCard label="Cold-Tail" value={stats.cold} tone="warn" />
          <StatCard label="Huge >50KB" value={stats.huge} tone="bad" />
          <StatCard label="Large >30KB" value={stats.large} tone="warn" />
          <StatCard label="Σ KB Code" value={Math.round(stats.totalKB)} />
        </div>

        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
            <CardTitle>Triage-Tabelle</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Suche Name…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-48"
              />
              <Select value={pathFilter} onValueChange={setPathFilter}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Path" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Pfade</SelectItem>
                  <SelectItem value="hot-path">Hot-Path</SelectItem>
                  <SelectItem value="cold-tail">Cold-Tail</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sizeFilter} onValueChange={setSizeFilter}>
                <SelectTrigger className="w-32"><SelectValue placeholder="Größe" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Größen</SelectItem>
                  <SelectItem value="huge">Huge</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                <SelectTrigger className="w-32"><SelectValue placeholder="Sort" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bytes">Bytes</SelectItem>
                  <SelectItem value="loc">LOC</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={downloadCSV}>Export CSV</Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading && <p>Lade…</p>}
            {error && <p className="text-destructive">Fehler: {error}</p>}
            {!loading && !error && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr>
                      <th className="py-2 pr-3">Function</th>
                      <th className="py-2 pr-3 text-right">Größe</th>
                      <th className="py-2 pr-3 text-right">LOC</th>
                      <th className="py-2 pr-3">Path</th>
                      <th className="py-2 pr-3">Größenklasse</th>
                      <th className="py-2 pr-3">Cron</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 600).map(r => (
                      <tr key={r.name} className="border-b hover:bg-muted/50">
                        <td className="py-1.5 pr-3 font-mono text-xs">{r.name}</td>
                        <td className="py-1.5 pr-3 text-right">{bytesToKB(r.bytes)}</td>
                        <td className="py-1.5 pr-3 text-right">{r.loc}</td>
                        <td className="py-1.5 pr-3">
                          <Badge variant={r.has_cron ? 'default' : 'secondary'}>
                            {r.path_class}
                          </Badge>
                        </td>
                        <td className="py-1.5 pr-3">
                          <Badge variant={
                            r.size_class === 'huge' ? 'destructive' :
                            r.size_class === 'large' ? 'outline' : 'secondary'
                          }>
                            {r.size_class}
                          </Badge>
                        </td>
                        <td className="py-1.5 pr-3 text-xs">
                          {r.has_cron ? `${r.cron_count}× ${(r.cron_schedules ?? []).slice(0, 2).join(', ')}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-3">
                  Zeige {Math.min(filtered.length, 600)} von {filtered.length} Functions.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' }) {
  const color =
    tone === 'ok' ? 'text-emerald-600' :
    tone === 'warn' ? 'text-amber-600' :
    tone === 'bad' ? 'text-destructive' : 'text-foreground';
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold ${color}`}>{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}
