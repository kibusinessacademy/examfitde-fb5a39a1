/**
 * FailClusterDeltaCard — Observability Mini-Card
 * ──────────────────────────────────────────────
 * Compact view of structural fail clusters: 24h vs. 5d delta.
 * Read-only, admin-gated RPC, no client-side job_queue access.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Activity, AlertTriangle, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FAIL_CLUSTER_LABELS,
  type FailClusterRow,
} from '@/contracts/failClusters';

const STATUS_TONE: Record<FailClusterRow['status'], string> = {
  green: 'border-emerald-500/30 bg-emerald-500/5',
  watch: 'border-amber-500/40 bg-amber-500/10',
  critical: 'border-destructive/50 bg-destructive/10',
};

const STATUS_BADGE: Record<FailClusterRow['status'], string> = {
  green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  watch: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40',
  critical: 'bg-destructive/15 text-destructive border-destructive/40',
};

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const mins = Math.max(1, Math.floor((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function DeltaIcon({ delta }: { delta: number }) {
  if (delta > 0) return <TrendingUp className="h-3.5 w-3.5 text-destructive" aria-label="rising" />;
  if (delta < 0) return <TrendingDown className="h-3.5 w-3.5 text-emerald-500" aria-label="falling" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="stable" />;
}

export function FailClusterDeltaCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'fail-cluster-delta'],
    queryFn: async (): Promise<FailClusterRow[]> => {
      const { data, error } = await supabase.rpc('admin_get_fail_cluster_delta' as any);
      if (error) throw error;
      return (data ?? []) as FailClusterRow[];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const totalCritical = (data ?? []).filter(r => r.status === 'critical').length;
  const totalWatch = (data ?? []).filter(r => r.status === 'watch').length;
  const overallTone =
    totalCritical > 0 ? 'critical' : totalWatch > 0 ? 'watch' : 'green';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4" aria-hidden />
            Fail Cluster Delta
            <span className="text-xs font-normal text-muted-foreground">24h vs. 5d</span>
          </span>
          <Badge variant="outline" className={cn('text-xs', STATUS_BADGE[overallTone])}>
            {totalCritical > 0
              ? `${totalCritical} critical`
              : totalWatch > 0
              ? `${totalWatch} watch`
              : 'all green'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {(error as Error).message || 'Konnte Cluster-Delta nicht laden.'}
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !error && data && data.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Keine strukturellen Fail-Cluster in den letzten 5 Tagen.
          </p>
        )}

        {!isLoading && !error && data && data.map(row => (
          <div
            key={row.cluster_key}
            className={cn(
              'rounded-md border p-2.5 transition-colors',
              STATUS_TONE[row.status],
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Badge
                  variant="outline"
                  className={cn('text-[10px] uppercase tracking-wide shrink-0', STATUS_BADGE[row.status])}
                >
                  {row.status}
                </Badge>
                <span className="text-sm font-medium truncate">
                  {FAIL_CLUSTER_LABELS[row.cluster_key] ?? row.label}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                <span title="Last seen">{formatRelative(row.last_seen)}</span>
                <span className="flex items-center gap-1">
                  <DeltaIcon delta={row.delta} />
                  <span className={cn(row.delta > 0 && 'text-destructive', row.delta < 0 && 'text-emerald-600')}>
                    {row.delta > 0 ? '+' : ''}{row.delta}
                  </span>
                </span>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-3">
                <span>
                  <span className="font-semibold text-foreground">{row.count_24h}</span>
                  <span className="text-muted-foreground ml-1">/24h</span>
                </span>
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{row.count_5d}</span> /5d
                </span>
              </div>
            </div>
            {row.sample_error && row.count_24h > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-2 font-mono leading-snug">
                {row.sample_error}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default FailClusterDeltaCard;
