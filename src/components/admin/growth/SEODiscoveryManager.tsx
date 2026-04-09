import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Globe, Rss, Zap, AlertTriangle, CheckCircle, RefreshCw, Send, FileText, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface SubmissionLog {
  id: string;
  provider: string;
  source_type: string;
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
  discovery_health_score: number;
  drift_issues: any[];
  updated_at: string;
}

function useSubmissionLogs(filter: string) {
  return useQuery({
    queryKey: ['seo-submission-logs', filter],
    queryFn: async () => {
      let q = supabase.from('seo_submission_logs' as any).select('*').order('created_at', { ascending: false }).limit(100);
      if (filter !== 'all') q = q.eq('status', filter);
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

const providerIcon: Record<string, React.ReactNode> = {
  indexnow: <Zap className="h-3 w-3 text-amber-500" />,
  sitemap_refresh: <Globe className="h-3 w-3 text-blue-500" />,
  feed_refresh: <Rss className="h-3 w-3 text-orange-500" />,
};

const statusIcon: Record<string, React.ReactNode> = {
  success: <CheckCircle className="h-3 w-3 text-emerald-500" />,
  failed: <XCircle className="h-3 w-3 text-red-500" />,
  pending: <RefreshCw className="h-3 w-3 text-amber-500 animate-spin" />,
  skipped: <AlertTriangle className="h-3 w-3 text-muted-foreground" />,
};

export default function SEODiscoveryManager() {
  const [logFilter, setLogFilter] = useState('all');
  const { data: logs = [], isLoading: logsLoading } = useSubmissionLogs(logFilter);
  const { data: states = [], isLoading: statesLoading } = useDiscoveryState();

  const healthScore = states.length > 0
    ? Math.round(states.reduce((s, d) => s + d.discovery_health_score, 0) / states.length)
    : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-primary">{states.length}</div>
          <div className="text-xs text-muted-foreground">Tracked URLs</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-emerald-500">{states.filter(s => s.in_sitemap).length}</div>
          <div className="text-xs text-muted-foreground">In Sitemap</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-amber-500">{logs.filter(l => l.status === 'failed').length}</div>
          <div className="text-xs text-muted-foreground">Failed Submissions</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className={`text-2xl font-bold ${healthScore >= 80 ? 'text-emerald-500' : healthScore >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
            {healthScore}%
          </div>
          <div className="text-xs text-muted-foreground">Health Score</div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="logs" className="w-full">
        <TabsList className="h-8">
          <TabsTrigger value="logs" className="text-xs h-7 gap-1"><FileText className="h-3 w-3" /> Submission Logs</TabsTrigger>
          <TabsTrigger value="state" className="text-xs h-7 gap-1"><Globe className="h-3 w-3" /> Discovery State</TabsTrigger>
          <TabsTrigger value="drift" className="text-xs h-7 gap-1"><AlertTriangle className="h-3 w-3" /> Drift</TabsTrigger>
        </TabsList>

        <TabsContent value="logs" className="mt-3 space-y-3">
          <div className="flex gap-2">
            <Select value={logFilter} onValueChange={setLogFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="success">Erfolg</SelectItem>
                <SelectItem value="failed">Fehler</SelectItem>
                <SelectItem value="pending">Ausstehend</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {logsLoading ? <Skeleton className="h-40 w-full" /> : logs.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">
              Keine Submission-Logs vorhanden. Logs werden bei Publish/Update automatisch erstellt.
            </CardContent></Card>
          ) : logs.map(log => (
            <Card key={log.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2 text-xs">
                  {providerIcon[log.provider] || <Send className="h-3 w-3" />}
                  <Badge variant="outline" className="text-[10px]">{log.provider}</Badge>
                  {statusIcon[log.status]}
                  <span className="truncate flex-1">{log.url}</span>
                  <Badge variant="secondary" className="text-[10px]">{log.action}</Badge>
                  {log.http_status && <span className="text-[10px] text-muted-foreground">{log.http_status}</span>}
                </div>
                {log.error_message && (
                  <div className="text-[10px] text-red-500 mt-1 truncate">{log.error_message}</div>
                )}
                <div className="text-[10px] text-muted-foreground mt-1">
                  {log.submitted_at ? new Date(log.submitted_at).toLocaleString('de') : 'Nicht submitted'}
                  {log.retry_count > 0 && <span className="ml-2">Retries: {log.retry_count}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="state" className="mt-3 space-y-2">
          {statesLoading ? <Skeleton className="h-40 w-full" /> : states.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">
              Kein Discovery State vorhanden. State wird bei Content-Veröffentlichung automatisch angelegt.
            </CardContent></Card>
          ) : states.map(s => (
            <Card key={s.id}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="truncate flex-1 font-medium">{s.canonical_url}</span>
                  {s.is_indexable ? <Badge className="text-[10px] bg-emerald-500/15 text-emerald-600">Indexable</Badge>
                    : <Badge className="text-[10px] bg-red-500/15 text-red-600">NoIndex</Badge>}
                  {s.in_sitemap && <Badge variant="outline" className="text-[10px]">Sitemap</Badge>}
                  {s.in_feed && <Badge variant="outline" className="text-[10px]">Feed</Badge>}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 flex gap-3">
                  <span>Type: {s.source_type}</span>
                  <span>Health: {s.discovery_health_score}%</span>
                  {s.last_submitted_via_indexnow_at && (
                    <span>IndexNow: {new Date(s.last_submitted_via_indexnow_at).toLocaleDateString('de')}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="drift" className="mt-3 space-y-2">
          {states.filter(s => (s.drift_issues as any[])?.length > 0).length === 0 ? (
            <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">
              <CheckCircle className="h-6 w-6 mx-auto text-emerald-500 mb-2" />
              Keine Drift-Issues erkannt. Alles synchron.
            </CardContent></Card>
          ) : states.filter(s => (s.drift_issues as any[])?.length > 0).map(s => (
            <Card key={s.id} className="border-amber-500/30">
              <CardContent className="pt-3 pb-3">
                <div className="text-xs font-medium">{s.canonical_url}</div>
                <div className="mt-1 space-y-1">
                  {(s.drift_issues as any[]).map((issue: any, i: number) => (
                    <div key={i} className="text-[10px] text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {typeof issue === 'string' ? issue : JSON.stringify(issue)}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
