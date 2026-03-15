import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Loader2, Zap, Database, SkipForward, Clock, Layers, Filter } from 'lucide-react';
import { formatDistanceToNow, subDays, subHours } from 'date-fns';
import { de } from 'date-fns/locale';

const routingBadge: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  skipped: { label: '⏭️ Skipped', variant: 'secondary' },
  cache_hit: { label: '💾 Cache', variant: 'outline' },
  batch: { label: '📦 Batch', variant: 'default' },
  sync: { label: '⚡ Sync', variant: 'default' },
  template_only: { label: '📋 Template', variant: 'outline' },
};

const statusBadge: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  completed: { variant: 'default' },
  skipped: { variant: 'secondary' },
  cache_hit: { variant: 'outline' },
  queued: { variant: 'secondary' },
  batch_pending: { variant: 'secondary' },
  failed: { variant: 'destructive' },
};

const TIME_RANGES = [
  { value: 'all', label: 'Alle' },
  { value: '24h', label: '24 Stunden' },
  { value: '7d', label: '7 Tage' },
  { value: '30d', label: '30 Tage' },
] as const;

function getTimeCutoff(range: string): string | null {
  if (range === '24h') return subHours(new Date(), 24).toISOString();
  if (range === '7d') return subDays(new Date(), 7).toISOString();
  if (range === '30d') return subDays(new Date(), 30).toISOString();
  return null;
}

export default function AIGatewayDashboard() {
  const [filterJobType, setFilterJobType] = useState<string>('all');
  const [filterRouting, setFilterRouting] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTime, setFilterTime] = useState<string>('24h');

  // Recent requests with filters
  const { data: requests, isLoading, refetch } = useQuery({
    queryKey: ['ai-gateway-requests', filterJobType, filterRouting, filterStatus, filterTime],
    queryFn: async () => {
      let query = supabase
        .from('ai_generation_requests')
        .select('id, job_type, routing_mode, status, cache_key, deficit_result, created_at, completed_at, model, urgency, quality_tier')
        .order('created_at', { ascending: false })
        .limit(100);

      if (filterJobType !== 'all') query = query.eq('job_type', filterJobType);
      if (filterRouting !== 'all') query = query.eq('routing_mode', filterRouting);
      if (filterStatus !== 'all') query = query.eq('status', filterStatus);

      const cutoff = getTimeCutoff(filterTime);
      if (cutoff) query = query.gte('created_at', cutoff);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    refetchInterval: 15000,
  });

  // Aggregate stats (same time filter)
  const { data: stats } = useQuery({
    queryKey: ['ai-gateway-stats', filterTime],
    queryFn: async () => {
      let query = supabase
        .from('ai_generation_requests')
        .select('routing_mode, status, job_type');

      const cutoff = getTimeCutoff(filterTime);
      if (cutoff) query = query.gte('created_at', cutoff);

      const { data, error } = await query;
      if (error) throw error;

      const total = data?.length || 0;
      const byRouting: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      const jobTypes = new Set<string>();

      for (const r of data || []) {
        byRouting[r.routing_mode] = (byRouting[r.routing_mode] || 0) + 1;
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        if (r.job_type) jobTypes.add(r.job_type);
      }

      const pct = (key: string) => total > 0 ? ((byRouting[key] || 0) / total * 100).toFixed(1) : '0';

      return {
        total, byRouting, byStatus, jobTypes: Array.from(jobTypes).sort(),
        skipRate: pct('skipped'), cacheRate: pct('cache_hit'),
        batchRate: pct('batch'), syncRate: pct('sync'),
      };
    },
    refetchInterval: 30000,
  });

  // Policies
  const { data: policies } = useQuery({
    queryKey: ['ai-gateway-policies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_generation_policies')
        .select('*')
        .order('job_type');
      if (error) throw error;
      return data;
    },
  });

  // Cache stats
  const { data: cacheStats } = useQuery({
    queryKey: ['ai-gateway-cache-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_generation_cache')
        .select('id, job_type, hit_count, created_at')
        .order('hit_count', { ascending: false })
        .limit(20);
      if (error) throw error;
      const totalEntries = data?.length || 0;
      const totalHits = data?.reduce((sum, r) => sum + (r.hit_count || 0), 0) || 0;
      return { entries: totalEntries, totalHits, top: data?.slice(0, 5) };
    },
  });

  // Distinct values for filter dropdowns
  const routingModes = useMemo(() => {
    const modes = new Set<string>();
    requests?.forEach(r => { if (r.routing_mode) modes.add(r.routing_mode); });
    return Array.from(modes).sort();
  }, [requests]);

  const statuses = useMemo(() => {
    const s = new Set<string>();
    requests?.forEach(r => { if (r.status) s.add(r.status); });
    return Array.from(s).sort();
  }, [requests]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">AI Generation Gateway</h2>
          <p className="text-sm text-muted-foreground">Routing · Deficit · Cache · Batch/Sync · Observability</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Aktualisieren
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Layers className="h-3.5 w-3.5" /> Gesamt
            </div>
            <div className="text-2xl font-bold">{stats?.total ?? '–'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <SkipForward className="h-3.5 w-3.5" /> Skip-Rate
            </div>
            <div className="text-2xl font-bold text-amber-600">{stats?.skipRate ?? '–'}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Database className="h-3.5 w-3.5" /> Cache-Rate
            </div>
            <div className="text-2xl font-bold text-emerald-600">{stats?.cacheRate ?? '–'}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Clock className="h-3.5 w-3.5" /> Batch
            </div>
            <div className="text-2xl font-bold text-blue-600">{stats?.batchRate ?? '–'}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Zap className="h-3.5 w-3.5" /> Sync
            </div>
            <div className="text-2xl font-bold">{stats?.syncRate ?? '–'}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Cache Summary */}
      {cacheStats && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cache-Übersicht</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6 text-sm">
              <div><span className="text-muted-foreground">Einträge:</span> <strong>{cacheStats.entries}</strong></div>
              <div><span className="text-muted-foreground">Gesamte Hits:</span> <strong>{cacheStats.totalHits}</strong></div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Policies */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Aktive Policies</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job-Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Deficit</TableHead>
                  <TableHead>Cache</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Modell</TableHead>
                  <TableHead>Max Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies?.map((p: any) => (
                  <TableRow key={p.job_type}>
                    <TableCell className="font-mono text-xs">{p.job_type}</TableCell>
                    <TableCell>
                      <Badge variant={p.is_enabled ? 'default' : 'secondary'}>
                        {p.is_enabled ? 'Aktiv' : 'Aus'}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.prefer_batch ? '✅' : '–'}</TableCell>
                    <TableCell>{p.require_deficit ? '✅' : '–'}</TableCell>
                    <TableCell>{p.use_cache ? '✅' : '–'}</TableCell>
                    <TableCell>{p.template_first ? '✅' : '–'}</TableCell>
                    <TableCell className="font-mono text-xs">{p.default_model || '–'}</TableCell>
                    <TableCell>{p.max_tokens_out || '–'}</TableCell>
                  </TableRow>
                ))}
                {!policies?.length && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Keine Policies</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Filter className="h-4 w-4" /> Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Zeitraum</label>
              <Select value={filterTime} onValueChange={setFilterTime}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIME_RANGES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Job-Type</label>
              <Select value={filterJobType} onValueChange={setFilterJobType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  {(stats?.jobTypes || []).map(jt => <SelectItem key={jt} value={jt}>{jt}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Routing</label>
              <Select value={filterRouting} onValueChange={setFilterRouting}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  {routingModes.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Status</label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Requests */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Letzte Gateway-Requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zeit</TableHead>
                    <TableHead>Job-Type</TableHead>
                    <TableHead>Routing</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Modell</TableHead>
                    <TableHead>Deficit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests?.map((r: any) => {
                    const routing = routingBadge[r.routing_mode] || { label: r.routing_mode, variant: 'outline' as const };
                    const status = statusBadge[r.status] || { variant: 'outline' as const };
                    const deficit = r.deficit_result as any;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: de })}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.job_type}</TableCell>
                        <TableCell><Badge variant={routing.variant}>{routing.label}</Badge></TableCell>
                        <TableCell><Badge variant={status.variant}>{r.status}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{r.model || '–'}</TableCell>
                        <TableCell className="text-xs">
                          {deficit?.shouldGenerate === false
                            ? <span className="text-amber-600">Skip: {deficit.reason}</span>
                            : deficit?.reason
                              ? <span className="text-emerald-600">{deficit.reason}</span>
                              : '–'
                          }
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!requests?.length && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Keine Requests</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
