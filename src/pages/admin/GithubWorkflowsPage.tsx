import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Helmet } from 'react-helmet-async';
import { RefreshCw } from 'lucide-react';

type Wf = {
  name: string;
  file_path: string;
  triggers: string[];
  jobs: string[];
  schedule_cron: string[] | null;
  file_bytes: number;
  loc: number;
  cluster: string | null;
  is_active: boolean;
  last_synced_at: string;
};

export default function GithubWorkflowsPage() {
  const [rows, setRows] = useState<Wf[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [trigFilter, setTrigFilter] = useState<string>('all');

  const load = async () => {
    setLoading(true);
    const [{ data: list }, { data: ov }] = await Promise.all([
      supabase.from('github_workflow_registry' as any).select('*').order('name'),
      supabase.rpc('admin_get_github_workflow_overview' as any),
    ]);
    setRows((list as any) ?? []);
    setOverview(ov);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter(r => {
    if (trigFilter === 'scheduled' && !(r.schedule_cron && r.schedule_cron.length)) return false;
    if (trigFilter === 'pr' && !(r.triggers || []).includes('pull_request')) return false;
    if (trigFilter === 'push' && !(r.triggers || []).includes('push')) return false;
    if (trigFilter === 'manual' && !((r.triggers || []).length === 1 && r.triggers.includes('workflow_dispatch'))) return false;
    if (filter && !r.name.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  }), [rows, filter, trigFilter]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Helmet><title>GitHub Workflows — Admin</title></Helmet>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">GitHub Workflow Registry</h1>
          <p className="text-muted-foreground">Inventar aller <code>.github/workflows/</code>-Dateien · Sync via <code>scripts/collect-github-workflows.ts</code></p>
        </div>
        <Button onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
      </div>

      {overview && (
        <div className="grid grid-cols-6 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{overview.total}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Active</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{overview.active}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Scheduled</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{overview.scheduled}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">PR-Triggered</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{overview.pr_triggered}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Push-Triggered</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{overview.push_triggered}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Manual Only</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{overview.manual_only}</CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex gap-2 items-center flex-wrap">
            <Input placeholder="Workflow filtern…" value={filter} onChange={e => setFilter(e.target.value)} className="max-w-sm" />
            {['all', 'scheduled', 'pr', 'push', 'manual'].map(t => (
              <Button key={t} size="sm" variant={trigFilter === t ? 'default' : 'outline'} onClick={() => setTrigFilter(t)}>{t}</Button>
            ))}
            <span className="text-xs text-muted-foreground ml-auto">Last Sync: {overview?.last_sync ? new Date(overview.last_sync).toLocaleString() : '—'}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Name</th>
                  <th className="p-2">Triggers</th>
                  <th className="p-2">Schedule</th>
                  <th className="p-2">Jobs</th>
                  <th className="p-2 text-right">KB</th>
                  <th className="p-2 text-right">LOC</th>
                  <th className="p-2">Cluster</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.name} className="border-b hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs">{r.name}{!r.is_active && <Badge variant="outline" className="ml-2">inactive</Badge>}</td>
                    <td className="p-2"><div className="flex gap-1 flex-wrap">{(r.triggers || []).map(t => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}</div></td>
                    <td className="p-2 font-mono text-xs">{(r.schedule_cron || []).join(' · ') || '—'}</td>
                    <td className="p-2 text-xs">{(r.jobs || []).join(', ')}</td>
                    <td className="p-2 text-right">{(r.file_bytes / 1024).toFixed(1)}</td>
                    <td className="p-2 text-right">{r.loc}</td>
                    <td className="p-2 text-xs">{r.cluster ?? '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">{loading ? 'Lade…' : 'Keine Workflows. Sync ausführen: bun scripts/collect-github-workflows.ts'}</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
