/**
 * P20 Cut 0A — Recommendation Policy Effectiveness Card (Intervention Tab)
 * Read-only via admin_get_recommendation_policy_effectiveness.
 * Keine Policy-Mutation. Keine Intervention-Buttons mit Wirkung.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { AlertCircle, Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PolicyRow {
  recommendation_type: string | null;
  reason_code: string | null;
  outcomes_total: number | null;
  positive_count: number | null;
  negative_count: number | null;
  positive_rate_pct: number | null;
  avg_mastery_delta: number | null;
  distinct_users: number | null;
  last_recorded_at: string | null;
}

export default function RecommendationPolicyEffectivenessCard() {
  const [filterType, setFilterType] = useState('');
  const [filterReason, setFilterReason] = useState('');

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'recommendation-policy-effectiveness'],
    queryFn: async (): Promise<PolicyRow[]> => {
      const { data, error } = await supabase.rpc(
        'admin_get_recommendation_policy_effectiveness' as any,
      );
      if (error) throw error;
      return (data ?? []) as PolicyRow[];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const rows = data ?? [];
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterType && !(r.recommendation_type ?? '').toLowerCase().includes(filterType.toLowerCase())) {
        return false;
      }
      if (filterReason && !(r.reason_code ?? '').toLowerCase().includes(filterReason.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [rows, filterType, filterReason]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" />
              Recommendation Policy Effectiveness
            </CardTitle>
            <CardDescription>
              Policy-Performance pro <code>recommendation_type × reason_code</code>. Read-only via{' '}
              <code>admin_get_recommendation_policy_effectiveness</code>. Policy-Mutationen erfolgen
              nicht hier — siehe Tab <em>Governance</em>.
            </CardDescription>
          </div>
          {isFetching && <Badge variant="outline" className="text-[10px]">refresh</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Filter recommendation_type"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="max-w-xs h-8 text-xs"
          />
          <Input
            placeholder="Filter reason_code"
            value={filterReason}
            onChange={(e) => setFilterReason(e.target.value)}
            className="max-w-xs h-8 text-xs"
          />
        </div>

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Effectiveness nicht ladbar</AlertTitle>
            <AlertDescription>
              <code className="text-xs">{(error as Error).message}</code>
              <button onClick={() => refetch()} className="ml-2 underline text-xs">
                Retry
              </button>
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <Alert>
            <AlertTitle>Keine Effectiveness-Daten</AlertTitle>
            <AlertDescription>
              Noch keine Recommendations mit Outcome-Tracking. Sobald{' '}
              <code>recommendation_outcomes</code> Daten erhält, erscheinen sie hier.
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !error && rows.length > 0 && (
          <>
            <div className="text-xs text-fg-muted">
              {filtered.length} / {rows.length} policies
            </div>
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Outcomes</TableHead>
                    <TableHead className="text-right">+ / −</TableHead>
                    <TableHead className="text-right">Pos %</TableHead>
                    <TableHead className="text-right">Δ Mastery</TableHead>
                    <TableHead className="text-right">Users</TableHead>
                    <TableHead>Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r, i) => (
                    <TableRow key={`${r.recommendation_type}-${r.reason_code}-${i}`}>
                      <TableCell className="font-mono text-xs">{r.recommendation_type ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.reason_code ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(r.outcomes_total ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {Number(r.positive_count ?? 0)} / {Number(r.negative_count ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(r.positive_rate_pct ?? 0).toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(r.avg_mastery_delta ?? 0).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(r.distinct_users ?? 0)}
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {r.last_recorded_at
                          ? new Date(r.last_recorded_at).toLocaleString()
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-fg-muted">
              Read-only policy effectiveness. Policy-Änderungen erfolgen nicht hier.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
