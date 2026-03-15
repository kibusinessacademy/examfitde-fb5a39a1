import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, Zap, Database, SkipForward, Clock, Layers } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
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

export default function AIGatewayDashboard() {
  // Recent requests
  const { data: requests, isLoading, refetch } = useQuery({
    queryKey: ['ai-gateway-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_generation_requests')
        .select('id, job_type, routing_mode, status, cache_key, deficit_result, created_at, completed_at, model, urgency, quality_tier')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    refetchInterval: 15000,
  });

  // Aggregate stats
  const { data: stats } = useQuery({
    queryKey: ['ai-gateway-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_generation_requests')
        .select('routing_mode, status');
      if (error) throw error;

      const total = data?.length || 0;
      const byRouting: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      for (const r of data || []) {
        byRouting[r.routing_mode] = (byRouting[r.routing_mode] || 0) + 1;
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      }
      const skipRate = total > 0 ? ((byRouting['skipped'] || 0) / total * 100).toFixed(1) : '0';
      const cacheRate = total > 0 ? ((byRouting['cache_hit'] || 0) / total * 100).toFixed(1) : '0';
      const batchRate = total > 0 ? ((byRouting['batch'] || 0) / total * 100).toFixed(1) : '0';
      const syncRate = total > 0 ? ((byRouting['sync'] || 0) / total * 100).toFixed(1) : '0';

      return { total, byRouting, byStatus, skipRate, cacheRate, batchRate, syncRate };
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
