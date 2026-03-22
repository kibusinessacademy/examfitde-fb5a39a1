import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Eye, ThumbsUp, Share2, Target, TrendingUp, DollarSign, AlertTriangle, Clock, CheckCircle2, Zap } from 'lucide-react';

export default function ContentKPITab() {
  // Pipeline stats from content_jobs
  const { data: pipelineStats, isLoading: pipelineLoading } = useQuery({
    queryKey: ['content-pipeline-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_jobs')
        .select('status, content_category, created_at, approved_at, published_at');
      if (error) throw error;
      const d = data || [];
      const total = d.length;
      const byStatus = (s: string) => d.filter(j => j.status === s).length;
      const failed = byStatus('failed');
      const generated = d.filter(j => !['queued', 'running', 'failed'].includes(j.status)).length;

      return {
        total,
        queued: byStatus('queued'),
        running: byStatus('running'),
        generated: byStatus('generated'),
        needs_review: byStatus('needs_review'),
        approved: byStatus('approved'),
        publish_queued: byStatus('publish_queued'),
        published: byStatus('published'),
        failed,
        archived: byStatus('archived'),
        failRate: total > 0 ? ((failed / total) * 100).toFixed(1) : '0',
        throughput: generated,
        approvalBacklog: byStatus('generated') + byStatus('needs_review'),
        publishBacklog: byStatus('approved') + byStatus('publish_queued'),
      };
    },
  });

  // Performance metrics from content_performance
  const { data: contentStats, isLoading: perfLoading } = useQuery({
    queryKey: ['content-aggregate-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_performance')
        .select('views, likes, comments, shares, saves, conversions, revenue_eur, clicks, link_clicks');
      if (error) throw error;
      if (!data || data.length === 0) return null;

      const totalViews = data.reduce((s, r) => s + (r.views || 0), 0);
      const totalClicks = data.reduce((s, r) => s + (r.clicks || 0), 0);
      const totalConversions = data.reduce((s, r) => s + (r.conversions || 0), 0);
      const totalRevenue = data.reduce((s, r) => s + (r.revenue_eur || 0), 0);

      return {
        totalViews,
        totalLikes: data.reduce((s, r) => s + (r.likes || 0), 0),
        totalComments: data.reduce((s, r) => s + (r.comments || 0), 0),
        totalShares: data.reduce((s, r) => s + (r.shares || 0), 0),
        totalSaves: data.reduce((s, r) => s + (r.saves || 0), 0),
        totalConversions,
        totalRevenue,
        totalClicks,
        totalLinkClicks: data.reduce((s, r) => s + (r.link_clicks || 0), 0),
        avgCTR: totalViews > 0 ? (totalClicks / totalViews * 100) : 0,
        avgConversionRate: totalClicks > 0 ? (totalConversions / totalClicks * 100) : 0,
        revenuePerContent: data.length > 0 ? totalRevenue / data.length : 0,
        snapshots: data.length,
      };
    },
  });

  // Top hooks by usage
  const { data: topHooks } = useQuery({
    queryKey: ['content-top-hooks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_hooks')
        .select('hook_text, category, usage_count')
        .order('usage_count', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  // Top content performers
  const { data: topContent } = useQuery({
    queryKey: ['content-top-performers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_performance')
        .select('content_job_id, views, likes, shares, conversions, revenue_eur, platform')
        .order('views', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  if (pipelineLoading || perfLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* Pipeline Throughput */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Pipeline Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-2">
            {[
              { label: 'Gesamt', value: pipelineStats?.total || 0 },
              { label: 'Queued', value: pipelineStats?.queued || 0 },
              { label: 'Running', value: pipelineStats?.running || 0 },
              { label: 'Generiert', value: pipelineStats?.generated || 0 },
              { label: 'Review', value: pipelineStats?.needs_review || 0 },
              { label: 'Approved', value: pipelineStats?.approved || 0 },
              { label: 'Pub Queue', value: pipelineStats?.publish_queued || 0 },
              { label: 'Published', value: pipelineStats?.published || 0 },
              { label: 'Failed', value: pipelineStats?.failed || 0 },
              { label: 'Archiviert', value: pipelineStats?.archived || 0 },
            ].map(s => (
              <div key={s.label} className="text-center p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold">{s.value}</div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Operational KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">Throughput</div>
              <div className="text-xl font-bold">{pipelineStats?.throughput || 0}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div>
              <div className="text-xs text-muted-foreground">Fail Rate</div>
              <div className="text-xl font-bold">{pipelineStats?.failRate || 0}%</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-amber-500" />
            <div>
              <div className="text-xs text-muted-foreground">Approval Backlog</div>
              <div className="text-xl font-bold">{pipelineStats?.approvalBacklog || 0}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div>
              <div className="text-xs text-muted-foreground">Publish Backlog</div>
              <div className="text-xl font-bold">{pipelineStats?.publishBacklog || 0}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: 'Views', value: contentStats?.totalViews?.toLocaleString() || '0', icon: Eye, color: 'text-blue-600' },
          { label: 'Likes', value: contentStats?.totalLikes?.toLocaleString() || '0', icon: ThumbsUp, color: 'text-pink-600' },
          { label: 'Shares', value: contentStats?.totalShares?.toLocaleString() || '0', icon: Share2, color: 'text-purple-600' },
          { label: 'Conversions', value: contentStats?.totalConversions?.toLocaleString() || '0', icon: Target, color: 'text-green-600' },
          { label: 'Revenue', value: `${(contentStats?.totalRevenue || 0).toFixed(2)}€`, icon: DollarSign, color: 'text-emerald-600' },
          { label: '€/Content', value: `${(contentStats?.revenuePerContent || 0).toFixed(2)}€`, icon: DollarSign, color: 'text-emerald-500' },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
              <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
              <div>
                <div className="text-xs text-muted-foreground">{kpi.label}</div>
                <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Conversion Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Conversion Funnel
          </CardTitle>
          <CardDescription>Views → Clicks → Conversions → Revenue</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 flex-wrap">
            {[
              { value: contentStats?.totalViews?.toLocaleString() || '0', label: 'Views', sub: '' },
              { value: contentStats?.totalClicks?.toLocaleString() || '0', label: 'Clicks', sub: `${contentStats?.avgCTR?.toFixed(1) || 0}% CTR` },
              { value: contentStats?.totalConversions?.toLocaleString() || '0', label: 'Conversions', sub: `${contentStats?.avgConversionRate?.toFixed(1) || 0}% CR`, color: 'text-green-600' },
              { value: `${(contentStats?.totalRevenue || 0).toFixed(2)}€`, label: 'Revenue', sub: '', color: 'text-emerald-600' },
            ].map((step, i, arr) => (
              <div key={step.label} className="flex items-center gap-4">
                <div className="text-center">
                  <div className={`text-2xl font-bold ${step.color || ''}`}>{step.value}</div>
                  <div className="text-xs text-muted-foreground">{step.label}</div>
                  {step.sub && <div className="text-[10px] text-muted-foreground">{step.sub}</div>}
                </div>
                {i < arr.length - 1 && <div className="text-muted-foreground">→</div>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top Hooks */}
      {topHooks && topHooks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Hooks</CardTitle>
            <CardDescription>Meistgenutzte Hooks nach Usage Count</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topHooks.map((hook, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-muted-foreground w-5">#{i + 1}</span>
                    <span className="text-sm">„{hook.hook_text}"</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">{hook.category}</Badge>
                    <span className="text-xs text-muted-foreground">{hook.usage_count}×</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Content */}
      <Card>
        <CardHeader>
          <CardTitle>Top Content</CardTitle>
          <CardDescription>Sortiert nach Views</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Content</TableHead>
                <TableHead>Plattform</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Likes</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead className="text-right">Conv.</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topContent?.map((item) => (
                <TableRow key={`${item.content_job_id}-${item.platform}`}>
                  <TableCell className="font-mono text-xs">{item.content_job_id?.slice(0, 8)}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{item.platform}</Badge></TableCell>
                  <TableCell className="text-right font-medium">{item.views?.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{item.likes?.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{item.shares?.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-green-600">{item.conversions}</TableCell>
                  <TableCell className="text-right">{(item.revenue_eur || 0).toFixed(2)}€</TableCell>
                </TableRow>
              ))}
              {(!topContent || topContent.length === 0) && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Noch keine Performance-Daten
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}