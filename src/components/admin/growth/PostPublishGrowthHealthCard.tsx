import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, RefreshCw, Wrench, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Health = {
  status: 'OK' | 'WARN' | 'CRIT';
  total_published: number;
  coverage_blog_pct: number;
  coverage_og_image_pct: number;
  coverage_indexnow_pct: number;
  coverage_sitemap_pct: number;
  coverage_internal_links_pct: number;
  coverage_campaign_assets_pct: number;
  coverage_distribution_pct: number;
  stuck_pending_count: number;
  stuck_processing_count: number;
  ops_guard_growth_failures_24h: number;
  top_issues: { label: string; missing_count: number }[];
  last_run_at: string | null;
};

const COVERAGE_ROWS: { key: keyof Health; label: string }[] = [
  { key: 'coverage_blog_pct', label: 'Blog Articles' },
  { key: 'coverage_og_image_pct', label: 'OG Images' },
  { key: 'coverage_indexnow_pct', label: 'IndexNow Submissions' },
  { key: 'coverage_sitemap_pct', label: 'Sitemap Refresh' },
  { key: 'coverage_internal_links_pct', label: 'Internal Links' },
  { key: 'coverage_campaign_assets_pct', label: 'Campaign Assets' },
  { key: 'coverage_distribution_pct', label: 'Distribution Targets' },
];

function statusBadge(status: Health['status']) {
  if (status === 'OK') return <Badge className="bg-status-success-bg-subtle text-status-success-text border-status-success-border"><CheckCircle2 className="mr-1 h-3 w-3" />OK</Badge>;
  if (status === 'WARN') return <Badge className="bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border"><AlertTriangle className="mr-1 h-3 w-3" />WARN</Badge>;
  return <Badge className="bg-status-error-bg-subtle text-status-error-text border-status-error-border"><AlertCircle className="mr-1 h-3 w-3" />CRIT</Badge>;
}

export default function PostPublishGrowthHealthCard() {
  const qc = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['post-publish-growth-health'],
    queryFn: async (): Promise<Health> => {
      const { data, error } = await supabase.rpc('admin_get_post_publish_growth_health' as any);
      if (error) throw error;
      return data as Health;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const repair = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_run_post_publish_growth_repair' as any, { p_repair: true });
      if (error) throw error;
      return data as { repaired: number; drift_detected: number; skipped_cooldown: number };
    },
    onSuccess: (res) => {
      toast.success(`Repair: ${res.repaired} jobs enqueued`, {
        description: `${res.drift_detected} drift detected · ${res.skipped_cooldown} skipped (cooldown)`,
      });
      qc.invalidateQueries({ queryKey: ['post-publish-growth-health'] });
      qc.invalidateQueries({ queryKey: ['post-publish-growth-fanout'] });
    },
    onError: (err: any) => toast.error('Repair failed', { description: err?.message }),
  });

  const lastRun = useMemo(() => {
    if (!data?.last_run_at) return '—';
    const t = new Date(data.last_run_at);
    return `${t.toLocaleDateString()} ${t.toLocaleTimeString()}`;
  }, [data?.last_run_at]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            Post-Publish Growth Health
            {data && statusBadge(data.status)}
          </CardTitle>
          <CardDescription>
            Coverage je Artefakt für published packages · Cron alle 15 min · letzte Auto-Run: {lastRun}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? 'animate-spin' : ''}`} /> Health
          </Button>
          <Button size="sm" onClick={() => repair.mutate()} disabled={repair.isPending}>
            {repair.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wrench className="h-3 w-3 mr-1" />}
            Repair Top 25
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <div className="flex items-center gap-2 text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" />Lade Health…</div>}
        {error && <div className="text-sm text-status-error-text">Fehler: {(error as Error).message}</div>}
        {data && (
          <>
            <div className="text-xs text-text-secondary">
              Total published: <span className="font-mono text-text-primary">{data.total_published}</span> ·
              Stuck pending &gt;30min: <span className="font-mono text-text-primary">{data.stuck_pending_count}</span> ·
              Stuck processing &gt;20min: <span className="font-mono text-text-primary">{data.stuck_processing_count}</span> ·
              OPS_GUARD failures 24h: <span className={`font-mono ${data.ops_guard_growth_failures_24h > 0 ? 'text-status-error-text' : 'text-text-primary'}`}>{data.ops_guard_growth_failures_24h}</span>
            </div>

            <div className="space-y-2">
              {COVERAGE_ROWS.map(({ key, label }) => {
                const pct = (data[key] as number) ?? 0;
                const tone = pct >= 90 ? 'success' : pct >= 50 ? 'warning' : 'error';
                return (
                  <div key={key} className="grid grid-cols-12 items-center gap-2 text-xs">
                    <div className="col-span-4 text-text-secondary">{label}</div>
                    <div className="col-span-7"><Progress value={pct} className="h-2" /></div>
                    <div className={`col-span-1 text-right font-mono text-status-${tone}-text`}>{pct.toFixed(0)}%</div>
                  </div>
                );
              })}
            </div>

            {data.top_issues?.length > 0 && (
              <div className="rounded-md border border-border-subtle bg-surface-sunken p-3">
                <div className="text-xs font-medium text-text-primary mb-2">Top Drift</div>
                <div className="flex flex-wrap gap-2">
                  {data.top_issues.map((i) => (
                    <Badge key={i.label} variant="outline" className="text-xs">
                      {i.label}: {i.missing_count} fehlen
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
