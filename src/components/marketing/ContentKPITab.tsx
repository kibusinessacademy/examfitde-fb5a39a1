import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Eye, ThumbsUp, MessageCircle, Share2, Target, TrendingUp, DollarSign } from 'lucide-react';

export default function ContentKPITab() {
  const { data: performance, isLoading: perfLoading } = useQuery({
    queryKey: ['content-performance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_performance')
        .select('*')
        .order('snapshot_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: topContent } = useQuery({
    queryKey: ['content-top-performers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_performance')
        .select('content_job_id, views, likes, shares, conversions, conversion_rate, revenue_eur, platform')
        .order('views', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const { data: contentStats } = useQuery({
    queryKey: ['content-aggregate-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_performance')
        .select('views, likes, comments, shares, saves, conversions, revenue_eur, clicks');
      if (error) throw error;

      if (!data || data.length === 0) return null;

      return {
        totalViews: data.reduce((s, r) => s + (r.views || 0), 0),
        totalLikes: data.reduce((s, r) => s + (r.likes || 0), 0),
        totalComments: data.reduce((s, r) => s + (r.comments || 0), 0),
        totalShares: data.reduce((s, r) => s + (r.shares || 0), 0),
        totalSaves: data.reduce((s, r) => s + (r.saves || 0), 0),
        totalConversions: data.reduce((s, r) => s + (r.conversions || 0), 0),
        totalRevenue: data.reduce((s, r) => s + (r.revenue_eur || 0), 0),
        totalClicks: data.reduce((s, r) => s + (r.clicks || 0), 0),
        avgCTR: data.length > 0 ? data.reduce((s, r) => s + (r.views || 0), 0) > 0
          ? (data.reduce((s, r) => s + (r.clicks || 0), 0) / data.reduce((s, r) => s + (r.views || 0), 0) * 100)
          : 0 : 0,
        avgConversionRate: data.length > 0
          ? data.reduce((s, r) => s + (r.clicks || 0), 0) > 0
            ? (data.reduce((s, r) => s + (r.conversions || 0), 0) / data.reduce((s, r) => s + (r.clicks || 0), 0) * 100)
            : 0
          : 0,
        snapshots: data.length,
      };
    },
  });

  if (perfLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* Aggregate KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {[
          { label: 'Views', value: contentStats?.totalViews?.toLocaleString() || '0', icon: Eye, color: 'text-blue-600' },
          { label: 'Likes', value: contentStats?.totalLikes?.toLocaleString() || '0', icon: ThumbsUp, color: 'text-pink-600' },
          { label: 'Shares', value: contentStats?.totalShares?.toLocaleString() || '0', icon: Share2, color: 'text-purple-600' },
          { label: 'Conversions', value: contentStats?.totalConversions?.toLocaleString() || '0', icon: Target, color: 'text-green-600' },
          { label: 'Revenue', value: `${(contentStats?.totalRevenue || 0).toFixed(2)}€`, icon: DollarSign, color: 'text-emerald-600' },
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
          <CardDescription>Views → Clicks → Conversions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-center">
              <div className="text-2xl font-bold">{contentStats?.totalViews?.toLocaleString() || 0}</div>
              <div className="text-xs text-muted-foreground">Views</div>
            </div>
            <div className="text-muted-foreground">→</div>
            <div className="text-center">
              <div className="text-2xl font-bold">{contentStats?.totalClicks?.toLocaleString() || 0}</div>
              <div className="text-xs text-muted-foreground">Clicks ({contentStats?.avgCTR?.toFixed(1) || 0}%)</div>
            </div>
            <div className="text-muted-foreground">→</div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{contentStats?.totalConversions?.toLocaleString() || 0}</div>
              <div className="text-xs text-muted-foreground">Conversions ({contentStats?.avgConversionRate?.toFixed(1) || 0}%)</div>
            </div>
            <div className="text-muted-foreground">→</div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-600">{(contentStats?.totalRevenue || 0).toFixed(2)}€</div>
              <div className="text-xs text-muted-foreground">Revenue</div>
            </div>
          </div>
        </CardContent>
      </Card>

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
