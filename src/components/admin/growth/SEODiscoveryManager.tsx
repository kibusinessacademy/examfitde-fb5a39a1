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
import {
  Globe, Rss, Zap, AlertTriangle, CheckCircle, RefreshCw, Send, FileText,
  XCircle, ExternalLink, Copy, RotateCcw, Activity, Search, Target,
  Link2, BarChart3, TrendingUp, Shield, Radar
} from 'lucide-react';
import { toast } from 'sonner';

// ── Types ──
interface SubmissionLog {
  id: string; provider: string; source_type: string; source_id: string;
  url: string; canonical_url: string | null; action: string; status: string;
  http_status: number | null; error_message: string | null; retry_count: number;
  priority: number; started_at: string | null; finished_at: string | null;
  request_payload: any; response_payload: any; created_at: string;
}

interface DiscoveryState {
  id: string; source_type: string; source_id: string; canonical_url: string;
  normalized_url: string | null; content_status: string;
  is_indexable: boolean; is_feed_relevant: boolean; is_sitemap_relevant: boolean;
  is_indexnow_relevant: boolean; in_sitemap: boolean; in_feed: boolean;
  last_submitted_via_indexnow_at: string | null; last_sitemap_refresh_at: string | null;
  last_feed_refresh_at: string | null; discovery_hash: string | null;
  last_discovery_hash: string | null; discovery_health_score: number;
  drift_status: string; drift_reasons: any[]; drift_issues: any[];
  last_hash_change_at: string | null; last_indexnow_status: string | null;
  updated_at: string;
}

interface ContentAudit {
  id: string; content_id: string; content_type: string;
  seo_score: number; intent_match_score: number; conversion_score: number;
  interlink_score: number; completeness_score: number; overall_score: number;
  issues: any; recommendations: any; audited_at: string;
}

interface Keyword {
  id: string; keyword: string; cluster_id: string | null;
  intent_type: string | null; funnel_stage: string | null; persona: string | null;
  search_volume: number | null; difficulty: number | null;
  keyword_difficulty: number | null; business_value: number | null;
  conversion_value: number | null; curriculum_fit: number | null;
  content_gap_score: number | null; opportunity_score: number | null;
  target_page_type: string | null; target_url: string | null;
  content_status: string | null; cannibalization_risk: boolean;
  status: string | null; notes: string | null;
}

interface KeywordCluster {
  id: string; cluster_name: string; parent_topic: string | null;
  persona: string; funnel_stage: string; business_priority: number;
  pillar_page_url: string | null; status: string;
}

interface ContentBrief {
  id: string; keyword_id: string; title: string | null; content_type: string;
  persona: string | null; primary_angle: string | null; status: string;
  created_at: string;
}

interface InternalLink {
  id: string; source_url: string; source_title: string | null;
  target_url: string; target_title: string | null; anchor_text: string;
  relevance_score: number; reason: string | null; status: string;
}

// ── Hooks ──
function useSubmissionLogs(filter: string, providerFilter: string) {
  return useQuery({
    queryKey: ['seo-submission-logs', filter, providerFilter],
    queryFn: async () => {
      let q = supabase.from('seo_submission_logs' as any).select('*')
        .order('created_at', { ascending: false }).limit(200);
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
        .select('*').order('updated_at', { ascending: false }).limit(500);
      if (error) throw error;
      return (data || []) as unknown as DiscoveryState[];
    },
  });
}

function useContentAudits() {
  return useQuery({
    queryKey: ['seo-content-audits'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_content_audits' as any)
        .select('*').order('overall_score', { ascending: true }).limit(200);
      if (error) throw error;
      return (data || []) as unknown as ContentAudit[];
    },
  });
}

function useKeywords() {
  return useQuery({
    queryKey: ['seo-keywords'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_keywords' as any)
        .select('*').order('opportunity_score', { ascending: false, nullsFirst: false }).limit(300);
      if (error) throw error;
      return (data || []) as unknown as Keyword[];
    },
  });
}

function useKeywordClusters() {
  return useQuery({
    queryKey: ['seo-keyword-clusters'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_keyword_clusters' as any)
        .select('*').order('business_priority', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as KeywordCluster[];
    },
  });
}

function useContentBriefs() {
  return useQuery({
    queryKey: ['seo-content-briefs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_content_briefs' as any)
        .select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as unknown as ContentBrief[];
    },
  });
}

function useInternalLinks() {
  return useQuery({
    queryKey: ['seo-internal-links'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_internal_link_suggestions' as any)
        .select('*').order('relevance_score', { ascending: false }).limit(200);
      if (error) throw error;
      return (data || []) as unknown as InternalLink[];
    },
  });
}

// ── Helpers ──
const SITEMAP_BASE = `https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/generate-sitemap`;
const FEED_BASE = `https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/seo-refresh-feeds`;

function fmt(d: string | null): string {
  if (!d) return '–';
  return new Date(d).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-medium">{Math.round(value)}</span>
    </div>
  );
}

// ── Main Component ──
export default function SEODiscoveryManager() {
  const qc = useQueryClient();
  const [logFilter, setLogFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const { data: logs = [], isLoading: logsLoading } = useSubmissionLogs(logFilter, providerFilter);
  const { data: states = [], isLoading: statesLoading } = useDiscoveryState();
  const { data: audits = [] } = useContentAudits();
  const { data: keywords = [] } = useKeywords();
  const { data: clusters = [] } = useKeywordClusters();
  const { data: briefs = [] } = useContentBriefs();
  const { data: links = [] } = useInternalLinks();

  // ── Mutations ──
  const recalcMutation = useMutation({
    mutationFn: async (action: string) => {
      const { data, error } = await supabase.functions.invoke('seo-recalculate-discovery-state', { body: { action } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, action) => {
      qc.invalidateQueries({ queryKey: ['seo-discovery-state'] });
      qc.invalidateQueries({ queryKey: ['seo-submission-logs'] });
      qc.invalidateQueries({ queryKey: ['seo-content-audits'] });
      const msgs: Record<string, string> = {
        recalculate_all: `${data?.synced || 0} Einträge neu berechnet`,
        detect_drift: `${data?.drift_count || 0} Drifts erkannt`,
        compute_scores: `${data?.computed || 0} Scores berechnet`,
        build_refresh: `${data?.queued || 0} Einträge in Refresh Queue`,
        dashboard_summary: 'Summary geladen',
      };
      toast.success(msgs[action] || 'Aktion ausgeführt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const indexNowMutation = useMutation({
    mutationFn: async (action: string) => {
      const { data, error } = await supabase.functions.invoke('seo-submit-indexnow', { body: { action } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['seo-submission-logs'] });
      qc.invalidateQueries({ queryKey: ['seo-discovery-state'] });
      toast.success(`IndexNow: ${data?.submitted || 0} URLs, ${data?.skipped || 0} skipped`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const retryMutation = useMutation({
    mutationFn: async (params: { action: string; log_id?: string }) => {
      const { data, error } = await supabase.functions.invoke('seo-retry-failed-submissions', { body: params });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['seo-submission-logs'] });
      toast.success(`${data?.retried || 0} Retries ausgeführt`);
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
  const indexable = states.filter(s => s.is_indexable).length;
  const inSitemap = states.filter(s => s.in_sitemap).length;
  const inFeed = states.filter(s => s.in_feed).length;
  const failedLogs = logs.filter(l => l.status === 'failed').length;
  const healthAvg = totalTracked > 0 ? Math.round(states.reduce((s, d) => s + (d.discovery_health_score || 0), 0) / totalTracked) : 0;
  const driftItems = states.filter(s => s.drift_status === 'drift' || (s.drift_reasons || s.drift_issues || []).length > 0);

  const isPending = recalcMutation.isPending || indexNowMutation.isPending || retryMutation.isPending;

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
        {[
          { v: totalTracked, l: 'URLs', c: 'text-primary', icon: Globe },
          { v: indexable, l: 'Indexable', c: 'text-emerald-500', icon: CheckCircle },
          { v: inSitemap, l: 'Sitemap', c: 'text-blue-500', icon: Globe },
          { v: inFeed, l: 'Feed', c: 'text-orange-500', icon: Rss },
          { v: failedLogs, l: 'Failed', c: 'text-red-500', icon: XCircle },
          { v: driftItems.length, l: 'Drift', c: driftItems.length === 0 ? 'text-emerald-500' : 'text-amber-500', icon: AlertTriangle },
          { v: healthAvg, l: 'Health %', c: healthAvg >= 80 ? 'text-emerald-500' : healthAvg >= 50 ? 'text-amber-500' : 'text-red-500', icon: Activity },
        ].map(({ v, l, c, icon: Icon }) => (
          <Card key={l}><CardContent className="pt-3 pb-2 text-center">
            <div className={`text-xl font-bold ${c}`}>{v}</div>
            <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
              <Icon className="h-2.5 w-2.5" /> {l}
            </div>
          </CardContent></Card>
        ))}
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" className="h-7 text-[10px] gap-1" variant="outline"
          onClick={() => recalcMutation.mutate('recalculate_all')} disabled={isPending}>
          <RefreshCw className="h-3 w-3" /> Recalculate All
        </Button>
        <Button size="sm" className="h-7 text-[10px] gap-1" variant="outline"
          onClick={() => recalcMutation.mutate('detect_drift')} disabled={isPending}>
          <Radar className="h-3 w-3" /> Drift Detection
        </Button>
        <Button size="sm" className="h-7 text-[10px] gap-1" variant="outline"
          onClick={() => recalcMutation.mutate('compute_scores')} disabled={isPending}>
          <BarChart3 className="h-3 w-3" /> Scores berechnen
        </Button>
        <Button size="sm" className="h-7 text-[10px] gap-1" variant="outline"
          onClick={() => indexNowMutation.mutate('submit_new')} disabled={isPending}>
          <Zap className="h-3 w-3" /> IndexNow
        </Button>
        <Button size="sm" className="h-7 text-[10px] gap-1" variant="outline"
          onClick={() => retryMutation.mutate({ action: 'retry_all' })} disabled={isPending}>
          <RotateCcw className="h-3 w-3" /> Retry Failed
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="state" className="w-full">
        <TabsList className="h-auto flex-wrap gap-0.5 p-1 bg-muted/50">
          {[
            { v: 'state', l: 'Discovery', i: Activity },
            { v: 'drift', l: 'Drift', i: AlertTriangle },
            { v: 'logs', l: 'Logs', i: FileText },
            { v: 'retry', l: 'Retry', i: RotateCcw },
            { v: 'sitemaps', l: 'Sitemaps', i: Globe },
            { v: 'indexnow', l: 'IndexNow', i: Zap },
            { v: 'scores', l: 'Scores', i: BarChart3 },
            { v: 'keywords', l: 'Keywords', i: Search },
            { v: 'clusters', l: 'Cluster', i: Target },
            { v: 'briefs', l: 'Briefs', i: FileText },
            { v: 'links', l: 'Links', i: Link2 },
          ].map(({ v, l, i: Icon }) => (
            <TabsTrigger key={v} value={v} className="text-[10px] py-1 px-2 gap-0.5 data-[state=active]:bg-background rounded-md">
              <Icon className="h-3 w-3" /> {l}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ═══ Discovery State ═══ */}
        <TabsContent value="state" className="mt-3">
          {statesLoading ? <Skeleton className="h-40 w-full" /> : (
            <Card><CardContent className="p-0"><div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-[10px] h-7">URL</TableHead>
                  <TableHead className="text-[10px] h-7 w-16">Typ</TableHead>
                  <TableHead className="text-[10px] h-7 w-14">Status</TableHead>
                  <TableHead className="text-[10px] h-7 w-10">Idx</TableHead>
                  <TableHead className="text-[10px] h-7 w-10">SM</TableHead>
                  <TableHead className="text-[10px] h-7 w-10">Feed</TableHead>
                  <TableHead className="text-[10px] h-7 w-12">Health</TableHead>
                  <TableHead className="text-[10px] h-7 w-14">Drift</TableHead>
                  <TableHead className="text-[10px] h-7 w-24">IndexNow</TableHead>
                  <TableHead className="text-[10px] h-7 w-8"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {states.map(s => (
                    <TableRow key={s.id} className={s.drift_status === 'drift' ? 'bg-amber-500/5' : ''}>
                      <TableCell className="text-[10px] truncate max-w-[180px] py-1" title={s.canonical_url}>
                        {s.canonical_url?.replace('https://examfit.de', '') || '?'}
                      </TableCell>
                      <TableCell className="py-1"><Badge variant="secondary" className="text-[9px]">{s.source_type?.replace('_', ' ')}</Badge></TableCell>
                      <TableCell className="text-[10px] py-1">{s.content_status || '–'}</TableCell>
                      <TableCell className="py-1">{s.is_indexable ? <CheckCircle className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-muted-foreground" />}</TableCell>
                      <TableCell className="py-1">{s.in_sitemap ? <CheckCircle className="h-3 w-3 text-blue-500" /> : <XCircle className="h-3 w-3 text-muted-foreground" />}</TableCell>
                      <TableCell className="py-1">{s.in_feed ? <CheckCircle className="h-3 w-3 text-orange-500" /> : <XCircle className="h-3 w-3 text-muted-foreground" />}</TableCell>
                      <TableCell className="py-1"><ScoreBar value={s.discovery_health_score || 0} /></TableCell>
                      <TableCell className="py-1">
                        {s.drift_status === 'drift'
                          ? <Badge variant="destructive" className="text-[9px]">Drift</Badge>
                          : <Badge variant="outline" className="text-[9px] text-emerald-600">OK</Badge>}
                      </TableCell>
                      <TableCell className="text-[10px] py-1">
                        {s.last_indexnow_status === 'success' ? <Badge className="text-[9px] bg-emerald-500/15 text-emerald-600">OK</Badge>
                          : s.last_indexnow_status === 'failed' ? <Badge variant="destructive" className="text-[9px]">Fail</Badge>
                          : <span className="text-muted-foreground">–</span>}
                        <span className="ml-1 text-muted-foreground">{fmt(s.last_submitted_via_indexnow_at)}</span>
                      </TableCell>
                      <TableCell className="py-1">
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                          onClick={() => resubmitMutation.mutate({ source_type: s.source_type, source_id: s.source_id, url: s.canonical_url })}>
                          <Send className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div></CardContent></Card>
          )}
        </TabsContent>

        {/* ═══ Drift & Issues ═══ */}
        <TabsContent value="drift" className="mt-3 space-y-3">
          <Card><CardHeader className="py-2 px-3"><CardTitle className="text-xs flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Drift & Probleme ({driftItems.length})
          </CardTitle></CardHeader>
          <CardContent className="p-0">
            {driftItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                <Shield className="h-6 w-6 mx-auto text-emerald-500 mb-2" />
                Keine Drifts erkannt. Alle Discovery States sind konsistent.
              </div>
            ) : (
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-[10px] h-7">URL</TableHead>
                    <TableHead className="text-[10px] h-7 w-16">Typ</TableHead>
                    <TableHead className="text-[10px] h-7">Drift-Gründe</TableHead>
                    <TableHead className="text-[10px] h-7 w-8"></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {driftItems.map(s => {
                      const reasons = s.drift_reasons?.length ? s.drift_reasons : s.drift_issues || [];
                      return (
                        <TableRow key={s.id} className="bg-amber-500/5">
                          <TableCell className="text-[10px] truncate max-w-[180px] py-1">{s.canonical_url?.replace('https://examfit.de', '')}</TableCell>
                          <TableCell className="py-1"><Badge variant="secondary" className="text-[9px]">{s.source_type}</Badge></TableCell>
                          <TableCell className="py-1">
                            <div className="flex flex-wrap gap-0.5">
                              {reasons.map((r: any, i: number) => (
                                <Badge key={i} variant="destructive" className="text-[9px]">
                                  {typeof r === 'string' ? r.replace(/_/g, ' ') : JSON.stringify(r)}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="py-1">
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                              onClick={() => resubmitMutation.mutate({ source_type: s.source_type, source_id: s.source_id, url: s.canonical_url })}>
                              <Send className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* ═══ Submission Logs ═══ */}
        <TabsContent value="logs" className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={logFilter} onValueChange={setLogFilter}>
              <SelectTrigger className="w-[100px] h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['all', 'success', 'failed', 'pending', 'skipped'].map(v => (
                  <SelectItem key={v} value={v}>{v === 'all' ? 'Alle' : v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-[120px] h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['all', 'indexnow', 'sitemap_refresh', 'feed_refresh', 'discovery_recalc'].map(v => (
                  <SelectItem key={v} value={v}>{v === 'all' ? 'Alle' : v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[10px] text-muted-foreground">{logs.length} Einträge</span>
          </div>
          {logsLoading ? <Skeleton className="h-40 w-full" /> : (
            <Card><CardContent className="p-0"><div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-[10px] h-7">Provider</TableHead>
                  <TableHead className="text-[10px] h-7">URL</TableHead>
                  <TableHead className="text-[10px] h-7 w-14">Action</TableHead>
                  <TableHead className="text-[10px] h-7 w-14">Status</TableHead>
                  <TableHead className="text-[10px] h-7 w-10">HTTP</TableHead>
                  <TableHead className="text-[10px] h-7 w-8">R</TableHead>
                  <TableHead className="text-[10px] h-7 w-24">Datum</TableHead>
                  <TableHead className="text-[10px] h-7 w-8"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {logs.map(l => (
                    <TableRow key={l.id} className={l.status === 'failed' ? 'bg-red-500/5' : ''}>
                      <TableCell className="text-[10px] py-1">{l.provider}</TableCell>
                      <TableCell className="text-[10px] truncate max-w-[160px] py-1" title={l.url}>{l.url?.replace('https://examfit.de', '') || '–'}</TableCell>
                      <TableCell className="text-[10px] py-1">{l.action}</TableCell>
                      <TableCell className="py-1">
                        <Badge variant={l.status === 'success' ? 'default' : l.status === 'failed' ? 'destructive' : 'secondary'} className="text-[9px]">
                          {l.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[10px] py-1">{l.http_status || '–'}</TableCell>
                      <TableCell className="text-[10px] py-1">{l.retry_count || 0}</TableCell>
                      <TableCell className="text-[10px] py-1">{fmt(l.started_at || l.created_at)}</TableCell>
                      <TableCell className="py-1">
                        {l.status === 'failed' && (
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                            onClick={() => retryMutation.mutate({ action: 'retry_one', log_id: l.id })}>
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div></CardContent></Card>
          )}
        </TabsContent>

        {/* ═══ Retry Queue ═══ */}
        <TabsContent value="retry" className="mt-3 space-y-3">
          {(() => {
            const failed = logs.filter(l => l.status === 'failed' && l.retry_count < 5);
            return (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="text-xs">{failed.length} fehlgeschlagen</Badge>
                  <Button size="sm" className="h-7 text-[10px] gap-1"
                    onClick={() => retryMutation.mutate({ action: 'retry_all' })} disabled={isPending || failed.length === 0}>
                    <RotateCcw className="h-3 w-3" /> Bulk Retry
                  </Button>
                </div>
                {failed.length === 0 ? (
                  <Card><CardContent className="py-8 text-center text-xs text-muted-foreground">
                    <CheckCircle className="h-6 w-6 mx-auto text-emerald-500 mb-2" />
                    Keine fehlgeschlagenen Submissions.
                  </CardContent></Card>
                ) : (
                  <Card><CardContent className="p-0"><div className="max-h-80 overflow-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead className="text-[10px] h-7">URL</TableHead>
                        <TableHead className="text-[10px] h-7 w-14">Provider</TableHead>
                        <TableHead className="text-[10px] h-7 w-10">Retry</TableHead>
                        <TableHead className="text-[10px] h-7 w-10">Prio</TableHead>
                        <TableHead className="text-[10px] h-7">Fehler</TableHead>
                        <TableHead className="text-[10px] h-7 w-8"></TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {failed.map(l => (
                          <TableRow key={l.id}>
                            <TableCell className="text-[10px] truncate max-w-[180px] py-1">{l.url?.replace('https://examfit.de', '')}</TableCell>
                            <TableCell className="text-[10px] py-1">{l.provider}</TableCell>
                            <TableCell className="text-[10px] py-1">{l.retry_count}</TableCell>
                            <TableCell className="text-[10px] py-1">{l.priority}</TableCell>
                            <TableCell className="text-[10px] py-1 truncate max-w-[150px]" title={l.error_message || ''}>{l.error_message || '–'}</TableCell>
                            <TableCell className="py-1">
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                                onClick={() => retryMutation.mutate({ action: 'retry_one', log_id: l.id })}>
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div></CardContent></Card>
                )}
              </>
            );
          })()}
        </TabsContent>

        {/* ═══ Sitemaps & Feeds ═══ */}
        <TabsContent value="sitemaps" className="mt-3 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Card><CardHeader className="py-2 px-3"><CardTitle className="text-xs">Sitemaps</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {['index', 'static', 'blog', 'landing', 'products', 'berufe', 'content'].map(t => (
                <div key={t} className="flex items-center justify-between py-1 border-b last:border-0">
                  <span className="text-[10px] font-medium">{t}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                      onClick={() => window.open(`${SITEMAP_BASE}?type=${t}`, '_blank')}>
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                      onClick={() => { navigator.clipboard.writeText(`${SITEMAP_BASE}?type=${t}`); toast.success('Kopiert'); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent></Card>

            <Card><CardHeader className="py-2 px-3"><CardTitle className="text-xs">Feeds</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {[
                { k: 'blog', l: 'Blog RSS' }, { k: 'atom_blog', l: 'Blog Atom' },
                { k: 'landing', l: 'Landingpages RSS' }, { k: 'latest', l: 'Latest Content' },
              ].map(f => (
                <div key={f.k} className="flex items-center justify-between py-1 border-b last:border-0">
                  <span className="text-[10px] font-medium">{f.l}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                      onClick={() => window.open(`${FEED_BASE}?feed=${f.k}`, '_blank')}>
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                      onClick={() => { navigator.clipboard.writeText(`${FEED_BASE}?feed=${f.k}`); toast.success('Kopiert'); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent></Card>
          </div>
        </TabsContent>

        {/* ═══ IndexNow ═══ */}
        <TabsContent value="indexnow" className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-7 text-[10px] gap-1"
              onClick={() => indexNowMutation.mutate('submit_new')} disabled={isPending}>
              <Send className="h-3 w-3" /> Neue URLs senden
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
              onClick={() => indexNowMutation.mutate('retry_failed')} disabled={isPending}>
              <RotateCcw className="h-3 w-3" /> Fehlerhafte wiederholen
            </Button>
          </div>
          {(() => {
            const inLogs = logs.filter(l => l.provider === 'indexnow');
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Card><CardContent className="pt-3 pb-2 text-center">
                  <div className="text-lg font-bold text-emerald-500">{inLogs.filter(l => l.status === 'success').length}</div>
                  <div className="text-[10px] text-muted-foreground">Erfolg</div>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 text-center">
                  <div className="text-lg font-bold text-red-500">{inLogs.filter(l => l.status === 'failed').length}</div>
                  <div className="text-[10px] text-muted-foreground">Fehler</div>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 text-center">
                  <div className="text-lg font-bold">{states.filter(s => s.last_submitted_via_indexnow_at).length}</div>
                  <div className="text-[10px] text-muted-foreground">URLs submitted</div>
                </CardContent></Card>
                <Card><CardContent className="pt-3 pb-2 text-center">
                  <div className="text-xs font-medium">{fmt(inLogs.find(l => l.status === 'success')?.started_at || null)}</div>
                  <div className="text-[10px] text-muted-foreground">Letzter Erfolg</div>
                </CardContent></Card>
              </div>
            );
          })()}
        </TabsContent>

        {/* ═══ Content Scores ═══ */}
        <TabsContent value="scores" className="mt-3 space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-[10px] gap-1" variant="outline"
              onClick={() => recalcMutation.mutate('compute_scores')} disabled={isPending}>
              <BarChart3 className="h-3 w-3" /> Scores neu berechnen
            </Button>
            <span className="text-[10px] text-muted-foreground">{audits.length} Audits</span>
          </div>
          <Card><CardContent className="p-0"><div className="max-h-[400px] overflow-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px] h-7">Content</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Typ</TableHead>
                <TableHead className="text-[10px] h-7 w-14">SEO</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Intent</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Conv</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Links</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Vollst.</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Gesamt</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {audits.map(a => (
                  <TableRow key={a.id} className={a.overall_score < 40 ? 'bg-red-500/5' : ''}>
                    <TableCell className="text-[10px] py-1 truncate max-w-[150px]">{a.content_id.slice(0, 8)}</TableCell>
                    <TableCell className="py-1"><Badge variant="secondary" className="text-[9px]">{a.content_type}</Badge></TableCell>
                    <TableCell className="py-1"><ScoreBar value={a.seo_score} /></TableCell>
                    <TableCell className="py-1"><ScoreBar value={a.intent_match_score} /></TableCell>
                    <TableCell className="py-1"><ScoreBar value={a.conversion_score} /></TableCell>
                    <TableCell className="py-1"><ScoreBar value={a.interlink_score} /></TableCell>
                    <TableCell className="py-1"><ScoreBar value={a.completeness_score} /></TableCell>
                    <TableCell className="py-1"><ScoreBar value={a.overall_score} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div></CardContent></Card>
        </TabsContent>

        {/* ═══ Keywords ═══ */}
        <TabsContent value="keywords" className="mt-3">
          <Card><CardContent className="p-0"><div className="max-h-[400px] overflow-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px] h-7">Keyword</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Intent</TableHead>
                <TableHead className="text-[10px] h-7 w-12">Vol</TableHead>
                <TableHead className="text-[10px] h-7 w-12">KD</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Opp.</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Typ</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Status</TableHead>
                <TableHead className="text-[10px] h-7 w-10">🔥</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {keywords.map(k => (
                  <TableRow key={k.id} className={k.cannibalization_risk ? 'bg-amber-500/5' : ''}>
                    <TableCell className="text-[10px] py-1 font-medium">{k.keyword}</TableCell>
                    <TableCell className="py-1"><Badge variant="outline" className="text-[9px]">{k.intent_type || '–'}</Badge></TableCell>
                    <TableCell className="text-[10px] py-1">{k.search_volume || '–'}</TableCell>
                    <TableCell className="text-[10px] py-1">{k.keyword_difficulty ?? k.difficulty ?? '–'}</TableCell>
                    <TableCell className="py-1"><ScoreBar value={k.opportunity_score || 0} /></TableCell>
                    <TableCell className="py-1"><Badge variant="secondary" className="text-[9px]">{k.target_page_type || '–'}</Badge></TableCell>
                    <TableCell className="py-1"><Badge variant={k.content_status === 'published' ? 'default' : 'outline'} className="text-[9px]">{k.content_status || '–'}</Badge></TableCell>
                    <TableCell className="py-1">{k.cannibalization_risk && <AlertTriangle className="h-3 w-3 text-amber-500" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div></CardContent></Card>
        </TabsContent>

        {/* ═══ Clusters ═══ */}
        <TabsContent value="clusters" className="mt-3">
          <div className="grid md:grid-cols-2 gap-2">
            {clusters.map(c => {
              const clusterKws = keywords.filter(k => k.cluster_id === c.id);
              return (
                <Card key={c.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-xs font-medium">{c.cluster_name}</div>
                        <div className="text-[10px] text-muted-foreground">{c.parent_topic || '–'}</div>
                        <div className="flex gap-1 mt-1">
                          <Badge variant="outline" className="text-[9px]">{c.persona}</Badge>
                          <Badge variant="outline" className="text-[9px]">{c.funnel_stage}</Badge>
                          <Badge variant="secondary" className="text-[9px]">{clusterKws.length} KW</Badge>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-primary">P{c.business_priority}</div>
                        <Badge variant={c.status === 'active' ? 'default' : 'secondary'} className="text-[9px]">{c.status}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {clusters.length === 0 && (
              <Card className="col-span-2"><CardContent className="py-8 text-center text-xs text-muted-foreground">
                Keine Keyword-Cluster vorhanden.
              </CardContent></Card>
            )}
          </div>
        </TabsContent>

        {/* ═══ Content Briefs ═══ */}
        <TabsContent value="briefs" className="mt-3">
          <Card><CardContent className="p-0"><div className="max-h-[400px] overflow-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px] h-7">Titel</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Typ</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Persona</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Status</TableHead>
                <TableHead className="text-[10px] h-7 w-24">Erstellt</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {briefs.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="text-[10px] py-1 font-medium">{b.title || b.primary_angle || b.keyword_id?.slice(0, 8)}</TableCell>
                    <TableCell className="py-1"><Badge variant="secondary" className="text-[9px]">{b.content_type}</Badge></TableCell>
                    <TableCell className="py-1"><Badge variant="outline" className="text-[9px]">{b.persona || '–'}</Badge></TableCell>
                    <TableCell className="py-1"><Badge variant={b.status === 'approved' ? 'default' : 'outline'} className="text-[9px]">{b.status}</Badge></TableCell>
                    <TableCell className="text-[10px] py-1">{fmt(b.created_at)}</TableCell>
                  </TableRow>
                ))}
                {briefs.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-[10px] py-6 text-muted-foreground">Keine Briefs vorhanden.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div></CardContent></Card>
        </TabsContent>

        {/* ═══ Internal Links ═══ */}
        <TabsContent value="links" className="mt-3">
          <Card><CardContent className="p-0"><div className="max-h-[400px] overflow-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px] h-7">Von</TableHead>
                <TableHead className="text-[10px] h-7">Nach</TableHead>
                <TableHead className="text-[10px] h-7 w-20">Anchor</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Score</TableHead>
                <TableHead className="text-[10px] h-7 w-14">Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {links.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="text-[10px] py-1 truncate max-w-[120px]">{l.source_title || l.source_url}</TableCell>
                    <TableCell className="text-[10px] py-1 truncate max-w-[120px]">{l.target_title || l.target_url}</TableCell>
                    <TableCell className="text-[10px] py-1">{l.anchor_text}</TableCell>
                    <TableCell className="py-1"><ScoreBar value={l.relevance_score} /></TableCell>
                    <TableCell className="py-1"><Badge variant={l.status === 'accepted' ? 'default' : 'outline'} className="text-[9px]">{l.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {links.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-[10px] py-6 text-muted-foreground">Keine Link-Vorschläge.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
