import { lazy, Suspense, useEffect, useState, useRef } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Activity, CheckCircle2, XCircle, Clock, RotateCcw, Download,
  Terminal, Copy, Filter, Trash2, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';

const SystemHealthPage = lazy(() => import('@/pages/admin/SystemHealthPage'));
const AIWorkersPage = lazy(() => import('@/pages/admin/AIWorkersPage'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { path: '/admin/ops', label: 'Queue' },
  { path: '/admin/ops/logs', label: 'Live Logs' },
  { path: '/admin/ops/deadletter', label: 'Dead Letter' },
  { path: '/admin/ops/health', label: 'Health' },
  { path: '/admin/ops/ai-workers', label: 'AI Workers' },
];

/* ── Queue Dashboard ── */
function QueueDashboard() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await (supabase as any).from('job_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    setJobs(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, []);

  if (loading) return <Loading />;

  const statusCounts = jobs.reduce((acc: any, j) => {
    acc[j.status] = (acc[j.status] || 0) + 1; return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {['pending', 'processing', 'completed', 'failed'].map(s => (
          <Card key={s}>
            <CardContent className="py-3 px-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s}</p>
              <p className={cn("text-xl font-bold mt-1",
                s === 'failed' ? 'text-destructive' : s === 'completed' ? 'text-success' :
                s === 'processing' ? 'text-primary' : 'text-muted-foreground'
              )}>{statusCounts[s] || 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 px-3">Job Type</th>
              <th className="text-left py-2 px-3">Status</th>
              <th className="text-left py-2 px-3">Attempts</th>
              <th className="text-left py-2 px-3">Package</th>
              <th className="text-left py-2 px-3">Fehler</th>
              <th className="text-left py-2 px-3">Erstellt</th>
            </tr>
          </thead>
          <tbody>
            {jobs.slice(0, 50).map(j => (
              <tr key={j.id} className="border-b border-border/30 hover:bg-muted/30">
                <td className="py-2 px-3 font-mono">{j.job_type}</td>
                <td className="py-2 px-3">
                  <Badge variant="outline" className={cn("text-[10px]",
                    j.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                    j.status === 'completed' ? 'bg-success/10 text-success' :
                    j.status === 'processing' ? 'bg-primary/10 text-primary' : ''
                  )}>{j.status}</Badge>
                </td>
                <td className="py-2 px-3">{j.attempts}/{j.max_attempts}</td>
                <td className="py-2 px-3 font-mono text-muted-foreground truncate max-w-[120px]">
                  {j.payload?.package_id?.substring(0, 8) || '–'}
                </td>
                <td className="py-2 px-3 text-destructive truncate max-w-[200px]">{j.last_error || '–'}</td>
                <td className="py-2 px-3 text-muted-foreground">
                  {new Date(j.created_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Live Logs ── */
function LiveLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data } = await (supabase as any).from('job_queue')
      .select('id, job_type, status, last_error, created_at, payload')
      .order('created_at', { ascending: false })
      .limit(200);
    setLogs(data || []);
  };

  useEffect(() => { load(); const i = setInterval(load, 2000); return () => clearInterval(i); }, []);

  const filtered = filter === 'all' ? logs :
    filter === 'error' ? logs.filter(l => l.status === 'failed') :
    filter === 'warn' ? logs.filter(l => l.status === 'processing') :
    logs.filter(l => l.status === 'completed');

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(filtered.slice(0, 50), null, 2));
    toast.success('Logs kopiert');
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `logs-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1">
          {['all', 'error', 'warn', 'info'].map(f => (
            <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" className="text-xs h-7"
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'Alle' : f === 'error' ? '❌ Error' : f === 'warn' ? '⚠ Warn' : '✅ Info'}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleCopy}><Copy className="h-3 w-3 mr-1" /> Kopieren</Button>
          <Button variant="ghost" size="sm" onClick={handleDownload}><Download className="h-3 w-3 mr-1" /> JSON</Button>
        </div>
      </div>

      <ScrollArea className="h-[500px] rounded-md border border-border/30 bg-muted/20">
        <div className="font-mono text-xs p-3 space-y-1">
          {filtered.slice(0, 100).map((log, i) => (
            <div key={`${log.id}-${i}`} className={cn("flex gap-2 py-1 px-2 rounded",
              log.status === 'failed' ? 'bg-destructive/5' :
              log.status === 'processing' ? 'bg-primary/5' : ''
            )}>
              <span className="text-muted-foreground shrink-0 w-[44px]">
                {new Date(log.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={cn("shrink-0 w-12",
                log.status === 'failed' ? 'text-destructive' :
                log.status === 'completed' ? 'text-success' :
                log.status === 'processing' ? 'text-primary' : 'text-muted-foreground'
              )}>{log.status}</span>
              <span className="text-foreground">{log.job_type}</span>
              {log.last_error && <span className="text-destructive truncate max-w-[300px]">– {log.last_error}</span>}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

/* ── Dead Letter Center ── */
function DeadLetterCenter() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data } = await (supabase as any).from('job_queue')
      .select('*')
      .eq('status', 'failed')
      .order('created_at', { ascending: false });
    setJobs(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleRetrySelected = async () => {
    if (selected.size === 0) return;
    await (supabase as any).from('job_queue')
      .update({ status: 'pending', attempts: 0, run_after: new Date().toISOString() })
      .in('id', Array.from(selected));
    toast.success(`${selected.size} Jobs werden erneut versucht`);
    setSelected(new Set());
    load();
  };

  const handleRetryAll = async () => {
    await (supabase as any).from('job_queue')
      .update({ status: 'pending', attempts: 0, run_after: new Date().toISOString() })
      .eq('status', 'failed');
    toast.success('Alle fehlgeschlagenen Jobs werden erneut versucht');
    load();
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `dead-letter-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">{jobs.length} fehlgeschlagene Jobs</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRetrySelected} disabled={selected.size === 0}>
            <RotateCcw className="h-3 w-3 mr-1" /> Auswahl retrien ({selected.size})
          </Button>
          <Button variant="outline" size="sm" onClick={handleRetryAll} disabled={jobs.length === 0}>
            <RefreshCw className="h-3 w-3 mr-1" /> Alle retrien
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            <Download className="h-3 w-3 mr-1" /> JSON
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {jobs.map(j => (
          <Card key={j.id} className={cn("border-l-4 border-l-destructive cursor-pointer transition-colors",
            selected.has(j.id) && "ring-2 ring-primary"
          )} onClick={() => {
            const next = new Set(selected);
            next.has(j.id) ? next.delete(j.id) : next.add(j.id);
            setSelected(next);
          }}>
            <CardContent className="py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-mono font-medium">{j.job_type}</span>
                <span className="text-xs text-muted-foreground">{j.attempts}/{j.max_attempts} Versuche</span>
              </div>
              {j.last_error && (
                <p className="text-xs text-destructive mt-1 truncate">{j.last_error}</p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                {new Date(j.created_at).toLocaleString('de-DE')}
              </p>
            </CardContent>
          </Card>
        ))}
        {jobs.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
              Keine fehlgeschlagenen Jobs 🎉
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function OpsPage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname === t.path)?.path ||
    tabs.find(t => location.pathname.startsWith(t.path) && t.path !== '/admin/ops')?.path ||
    tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">System & Betrieb</h1>
        <p className="text-sm text-muted-foreground">Queue, Logs, Dead Letter, Health, AI Workers</p>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<QueueDashboard />} />
          <Route path="logs" element={<LiveLogs />} />
          <Route path="deadletter" element={<DeadLetterCenter />} />
          <Route path="health" element={<SystemHealthPage />} />
          <Route path="ai-workers" element={<AIWorkersPage />} />
        </Routes>
      </Suspense>
    </div>
  );
}
