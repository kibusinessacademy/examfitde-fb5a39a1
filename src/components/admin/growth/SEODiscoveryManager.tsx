import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Globe, Rss, Zap, AlertTriangle, CheckCircle, RefreshCw, Send, FileText, XCircle, ExternalLink, Copy, RotateCcw, Activity } from 'lucide-react';
import { toast } from 'sonner';

// ── Types ──

interface SubmissionLog {
  id: string;
  provider: string;
  source_type: string;
  source_id: string;
  url: string;
  action: string;
  status: string;
  http_status: number | null;
  error_message: string | null;
  retry_count: number;
  submitted_at: string | null;
  created_at: string;
}

interface DiscoveryState {
  id: string;
  source_type: string;
  source_id: string;
  canonical_url: string;
  is_indexable: boolean;
  in_sitemap: boolean;
  in_feed: boolean;
  last_submitted_via_indexnow_at: string | null;
  last_sitemap_refresh_at: string | null;
  last_feed_refresh_at: string | null;
  last_discovery_hash: string | null;
  discovery_health_score: number;
  drift_issues: any[];
  updated_at: string;
}

// ── Hooks ──

function useSubmissionLogs(filter: string, providerFilter: string) {
  return useQuery({
    queryKey: ['seo-submission-logs', filter, providerFilter],
    queryFn: async () => {
      let q = supabase.from('seo_submission_logs' as any).select('*').order('created_at', { ascending: false }).limit(200);
      if (filter !== 'all') q = q.eq('status', filter);
      if (providerFilter !== 'all') q = q.eq('provider', providerFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as SubmissionLog[];
    },
  });
}

function useDiscoveryState() {
  return useQuery({
    queryKey: ['seo-discovery-state'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_discovery_state' as any)
        .select('*').order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as DiscoveryState[];
    },
  });
}

// ── Helpers ──

const SITEMAP_BASE = 'https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/generate-sitemap';
const FEED_BASE = 'https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/seo-refresh-feeds';

const SITEMAP_TYPES = [
  { key: 'index', label: 'Sitemap Index', desc: 'Referenziert alle Sub-Sitemaps' },
  { key: 'static', label: 'Static Pages', desc: 'Startseite, Hub-Seiten, etc.' },
  { key: 'blog', label: 'Blog', desc: 'Blog-Artikel' },
  { key: 'landing', label: 'Landingpages', desc: 'SEO Landingpages' },
  { key: 'products', label: 'Produkte', desc: 'Shop, Curriculum Products' },
  { key: 'berufe', label: 'Berufe', desc: 'Berufe + Zertifizierungen' },
  { key: 'content', label: 'Content', desc: 'SEO Docs, Content Pages' },
];

const FEED_TYPES = [
  { key: 'blog', label: 'Blog RSS', format: 'rss' },
  { key: 'atom_blog', label: 'Blog Atom', format: 'atom' },
  { key: 'landing', label: 'Landingpages RSS', format: 'rss' },
  { key: 'latest', label: 'Latest Content', format: 'rss' },
];

const providerIcon: Record<string, React.ReactNode> = {
  indexnow: <Zap className="h-3 w-3 text-amber-500" />,
  sitemap_refresh: <Globe className="h-3 w-3 text-blue-500" />,
  feed_refresh: <Rss className="h-3 w-3 text-orange-500" />,
};

const statusBadge: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
  success: { variant: 'default', label: 'Erfolg' },
  failed: { variant: 'destructive', label: 'Fehler' },
  pending: { variant: 'secondary', label: 'Ausstehend' },
  skipped: { variant: 'outline', label: 'Übersprungen' },
};

function formatDate(d: string | null): string {
  if (!d) return '–';
  return new Date(d).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Main Component ──

export default function SEODiscoveryManager() {
  const qc = useQueryClient();
  const [logFilter, setLogFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const { data: logs = [], isLoading: logsLoading } = useSubmissionLogs(logFilter, providerFilter);
  const { data: states = [], isLoading: statesLoading } = useDiscoveryState();

  // ── Mutations ──

  const indexNowMutation = useMutation({
    mutationFn: async (action: string) => {
      const { data, error } = await supabase.functions.invoke('seo-submit-indexnow', { body: { action } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['seo-submission-logs'] });
      qc.invalidateQueries({ queryKey: ['seo-discovery-state'] });
      toast.success(`IndexNow: ${data?.submitted || 0} URLs submitted, ${data?.skipped || 0} skipped`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const refreshStateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('seo-discovery-engine', { body: { action: 'refresh_discovery_state' } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['seo-discovery-state'] });
      toast.success(`${data?.synced || 0} Einträge synchronisiert`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const healthMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('seo-discovery-engine', { body: { action: 'health_scores' } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Health: ${data?.healthy || 0} healthy, ${data?.issues || 0} issues`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resubmitMutation = useMutation({
    mutationFn: async (params: { source_type: string; source_id: string; url: string }) => {
      const { data, error } = await supabase.functions.invoke('seo-handle-content-event', {
        body: { event: 'update', source_type: params.source_type, source_id: params.source_id, url: params.url, force: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-submission-logs'] });
      qc.invalidateQueries({ queryKey: ['seo-discovery-state'] });
      toast.success('Re-Submit erfolgreich');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Stats ──

  const totalTracked = states.length;
  const inSitemap = states.filter(s => s.in_sitemap).length;
  const inFeed = states.filter(s => s.in_feed).length;
  const failedLogs = logs.filter(l => l.status === 'failed').length;
  const healthAvg = totalTracked > 0 ? Math.round(states.reduce((s, d) => s + d.discovery_health_score, 0) / totalTracked) : 0;
  const driftCount = states.filter(s => (s.drift_issues as any[])?.length > 0).length;

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <Card><CardContent className="pt-3 pb-2 text-center">
          <div className="text-xl font-bold text-primary">{totalTracked}</div>
          <div className="text-[10px] text-muted-foreground">URLs tracked</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2 text-center">
          <div className="text-xl font-bold text-emerald-500">{inSitemap}</div>
          <div className="text-[10px] text-muted-foreground">In Sitemap</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2 text-center">
          <div className="text-xl font-bold text-orange-500">{inFeed}</div>
          <div className="text-[10px] text-muted-foreground">In Feed</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2 text-center">
          <div className="text-xl font-bold text-red-500">{failedLogs}</div>
          <div className="text-[10px] text-muted-foreground">Failed</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2 text-center">
          <div className={`text-xl font-bold ${healthAvg >= 80 ? 'text-emerald-500' : healthAvg >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
            {healthAvg}%
          </div>
          <div className="text-[10px] text-muted-foreground">Health</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2 text-center">
          <div className={`text-xl font-bold ${driftCount === 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
            {driftCount}
          </div>
          <div className="text-[10px] text-muted-foreground">Drift Issues</div>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="sitemaps" className="w-full">
        <TabsList className="h-8 flex-wrap">
          <TabsTrigger value="sitemaps" className="text-xs h-7 gap-1"><Globe className="h-3 w-3" /> Sitemaps</TabsTrigger>
          <TabsTrigger value="feeds" className="text-xs h-7 gap-1"><Rss className="h-3 w-3" /> Feeds</TabsTrigger>
          <TabsTrigger value="indexnow" className="text-xs h-7 gap-1"><Zap className="h-3 w-3" /> IndexNow</TabsTrigger>
          <TabsTrigger value="logs" className="text-xs h-7 gap-1"><FileText className="h-3 w-3" /> Logs</TabsTrigger>
          <TabsTrigger value="state" className="text-xs h-7 gap-1"><Activity className="h-3 w-3" /> Discovery</TabsTrigger>
          <TabsTrigger value="drift" className="text-xs h-7 gap-1"><AlertTriangle className="h-3 w-3" /> Drift</TabsTrigger>
        </TabsList>

        {/* ═══ Sitemaps Tab ═══ */}
        <TabsContent value="sitemaps" className="mt-3 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="h-7 text-xs gap-1" variant="outline"
              onClick={() => window.open(`${SITEMAP_BASE}?type=index`, '_blank')}>
              <ExternalLink className="h-3 w-3" /> Sitemap Index öffnen
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1" variant="outline"
              onClick={() => window.open(`${SITEMAP_BASE}?type=robots`, '_blank')}>
              <FileText className="h-3 w-3" /> robots.txt
            </Button>
          </div>
          <div className="grid gap-2">
            {SITEMAP_TYPES.map(sm => (
              <Card key={sm.key} className="hover:border-primary/30 transition-colors">
                <CardContent className="pt-3 pb-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">{sm.label}</div>
                    <div className="text-[10px] text-muted-foreground">{sm.desc}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => window.open(`${SITEMAP_BASE}?type=${sm.key}`, '_blank')}>
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => { navigator.clipboard.writeText(`${SITEMAP_BASE}?type=${sm.key}`); toast.success('URL kopiert'); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ═══ Feeds Tab ═══ */}
        <TabsContent value="feeds" className="mt-3 space-y-3">
          <div className="grid gap-2">
            {FEED_TYPES.map(f => (
              <Card key={f.key} className="hover:border-primary/30 transition-colors">
                <CardContent className="pt-3 pb-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium">{f.label}</div>
                    <div className="text-[10px] text-muted-foreground">Format: {f.format.toUpperCase()}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => window.open(`${FEED_BASE}?feed=${f.key}`, '_blank')}>
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => { navigator.clipboard.writeText(`${FEED_BASE}?feed=${f.key}`); toast.success('Feed-URL kopiert'); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ═══ IndexNow Tab ═══ */}
        <TabsContent value="indexnow" className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-8 text-xs gap-1"
              onClick={() => indexNowMutation.mutate('submit_new')}
              disabled={indexNowMutation.isPending}>
              <Send className="h-3 w-3" />
              {indexNowMutation.isPending ? 'Submitting...' : 'Neue/Aktualisierte URLs senden'}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
              onClick={() => indexNowMutation.mutate('retry_failed')}
              disabled={indexNowMutation.isPending}>
              <RotateCcw className="h-3 w-3" /> Fehlerhafte wiederholen
            </Button>
          </div>

          {/* IndexNow-specific stats */}
          {(() => {
            const inLogs = logs.filter(l => l.provider === 'indexnow');
            const success = inLogs.filter(l => l.status === 'success').length;
            const failed = inLogs.filter(l => l.status === 'failed').length;
            const lastSubmit = inLogs.find(l => l.status === 'success');
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Card><CardContent className="pt-3 pb-2 text-center">
                  <div className="text-lg font-bold text-emerald-500">{success}</div>
                  <div className="text-[10px] text-muted-foreground">Erfolgreiche Submits</div>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 text-center">
                  <div className="text-lg font-bold text-red-500">{failed}</div>
                  <div className="text-[10px] text-muted-foreground">Fehler</div>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 text-center">
                  <div className="text-lg font-bold">{states.filter(s => s.last_submitted_via_indexnow_at).length}</div>
                  <div className="text-[10px] text-muted-foreground">Unique URLs submitted</div>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 text-center">
                  <div className="text-xs font-medium">{lastSubmit ? formatDate(lastSubmit.submitted_at) : '–'}</div>
                  <div className="text-[10px] text-muted-foreground">Letzter Erfolg</div>
                </CardContent></Card>
              </div>
            );
          })()}

          {/* Recent IndexNow logs */}
          <Card>
            <CardHeader className="py-2 px-3"><CardTitle className="text-xs">Letzte IndexNow Submits</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="max-h-60 overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-[10px] h-7">URL</TableHead>
                    <TableHead className="text-[10px] h-7 w-16">Status</TableHead>
                    <TableHead className="text-[10px] h-7 w-16">HTTP</TableHead>
                    <TableHead className="text-[10px] h-7 w-28">Datum</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {logs.filter(l => l.provider === 'indexnow').slice(0, 20).map(l => (
                      <TableRow key={l.id}>
                        <TableCell className="text-[10px] truncate max-w-[200px]">{l.url}</TableCell>
                        <TableCell>{l.status === 'success'
                          ? <Badge className="text-[9px] bg-emerald-500/15 text-emerald-600">OK</Badge>
                          : <Badge variant="destructive" className="text-[9px]">Fail</Badge>}</TableCell>
                        <TableCell className="text-[10px]">{l.http_status || '–'}</TableCell>
                        <TableCell className="text-[10px]">{formatDate(l.submitted_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ Logs Tab ═══ */}
        <TabsContent value="logs" className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={logFilter} onValueChange={setLogFilter}>
              <SelectTrigger className="w-[110px] h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Status</SelectItem>
                <SelectItem value="success">Erfolg</SelectItem>
                <SelectItem value="failed">Fehler</SelectItem>
                <SelectItem value="pending">Ausstehend</SelectItem>
                <SelectItem value="skipped">Übersprungen</SelectItem>
              </SelectContent>
            </Select>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-[130px] h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Provider</SelectItem>
                <SelectItem value="indexnow">IndexNow</SelectItem>
                <SelectItem value="sitemap_refresh">Sitemap</SelectItem>
                <SelectItem value="feed_refresh">Feed</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[10px] text-muted-foreground">{logs.length} Einträge</span>
          </div>

          {logsLoading ? <Skeleton className="h-40 w-full" /> : (
            <Card>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className="text-[10px] h-7">Provider</TableHead>
                      <TableHead className="text-[10px] h-7">URL</TableHead>
                      <TableHead className="text-[10px] h-7 w-16">Action</TableHead>
                      <TableHead className="text-[10px] h-7 w-16">Status</TableHead>
                      <TableHead className="text-[10px] h-7 w-12">HTTP</TableHead>
                      <TableHead className="text-[10px] h-7 w-10">Retry</TableHead>
                      <TableHead className="text-[10px] h-7 w-28">Datum</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {logs.map(l => (
                        <TableRow key={l.id} className={l.status === 'failed' ? 'bg-red-500/5' : ''}>
                          <TableCell className="py-1">{providerIcon[l.provider] || <Send className="h-3 w-3" />}</TableCell>
                          <TableCell className="text-[10px] truncate max-w-[180px] py-1" title={l.url}>{l.url}</TableCell>
                          <TableCell className="text-[10px] py-1">{l.action}</TableCell>
                          <TableCell className="py-1">
                            <Badge variant={statusBadge[l.status]?.variant || 'outline'} className="text-[9px]">
                              {statusBadge[l.status]?.label || l.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[10px] py-1">{l.http_status || '–'}</TableCell>
                          <TableCell className="text-[10px] py-1">{l.retry_count || 0}</TableCell>
                          <TableCell className="text-[10px] py-1">{formatDate(l.submitted_at || l.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══ Discovery State Tab ═══ */}
        <TabsContent value="state" className="mt-3 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="h-7 text-xs gap-1" variant="outline"
              onClick={() => refreshStateMutation.mutate()} disabled={refreshStateMutation.isPending}>
              <RefreshCw className="h-3 w-3" /> State Refresh
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1" variant="outline"
              onClick={() => healthMutation.mutate()} disabled={healthMutation.isPending}>
              <Activity className="h-3 w-3" /> Health Scores berechnen
            </Button>
          </div>

          {statesLoading ? <Skeleton className="h-40 w-full" /> : (
            <Card>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className="text-[10px] h-7">URL</TableHead>
                      <TableHead className="text-[10px] h-7 w-14">Type</TableHead>
                      <TableHead className="text-[10px] h-7 w-10">Idx</TableHead>
                      <TableHead className="text-[10px] h-7 w-10">SM</TableHead>
                      <TableHead className="text-[10px] h-7 w-10">Feed</TableHead>
                      <TableHead className="text-[10px] h-7 w-12">Health</TableHead>
                      <TableHead className="text-[10px] h-7 w-24">IndexNow</TableHead>
                      <TableHead className="text-[10px] h-7 w-10">Act</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {states.map(s => (
                        <TableRow key={s.id}>
                          <TableCell className="text-[10px] truncate max-w-[160px] py-1" title={s.canonical_url}>
                            {s.canonical_url?.replace('https://examfit.de', '')}
                          </TableCell>
                          <TableCell className="text-[10px] py-1">{s.source_type?.replace('_', ' ').slice(0, 8)}</TableCell>
                          <TableCell className="py-1">{s.is_indexable ? <CheckCircle className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-red-400" />}</TableCell>
                          <TableCell className="py-1">{s.in_sitemap ? <CheckCircle className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-muted-foreground" />}</TableCell>
                          <TableCell className="py-1">{s.in_feed ? <CheckCircle className="h-3 w-3 text-orange-500" /> : <span className="text-[10px] text-muted-foreground">–</span>}</TableCell>
                          <TableCell className="py-1">
                            <span className={`text-[10px] font-medium ${s.discovery_health_score >= 80 ? 'text-emerald-500' : s.discovery_health_score >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                              {s.discovery_health_score}%
                            </span>
                          </TableCell>
                          <TableCell className="text-[10px] py-1">{formatDate(s.last_submitted_via_indexnow_at)}</TableCell>
                          <TableCell className="py-1">
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                              onClick={() => resubmitMutation.mutate({ source_type: s.source_type, source_id: s.source_id, url: s.canonical_url })}
                              disabled={resubmitMutation.isPending}>
                              <Send className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══ Drift Tab ═══ */}
        <TabsContent value="drift" className="mt-3 space-y-3">
          {driftCount === 0 ? (
            <Card><CardContent className="py-10 text-center">
              <CheckCircle className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
              <div className="text-xs text-muted-foreground">Keine Drift-Issues erkannt. Alle Content-Objekte synchron.</div>
            </CardContent></Card>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">{driftCount} Content-Objekte mit Drift-Issues</div>
              {states.filter(s => (s.drift_issues as any[])?.length > 0).map(s => (
                <Card key={s.id} className="border-amber-500/30">
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium truncate flex-1">{s.canonical_url?.replace('https://examfit.de', '')}</div>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 ml-2"
                        onClick={() => resubmitMutation.mutate({ source_type: s.source_type, source_id: s.source_id, url: s.canonical_url })}>
                        <Send className="h-3 w-3" /> Re-Submit
                      </Button>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(s.drift_issues as any[]).map((issue: any, i: number) => (
                        <Badge key={i} variant="outline" className="text-[9px] border-amber-500/50 text-amber-600">
                          <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                          {typeof issue === 'string' ? issue : JSON.stringify(issue)}
                        </Badge>
                      ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Health: {s.discovery_health_score}% · Type: {s.source_type} · Hash: {s.last_discovery_hash || '–'}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
