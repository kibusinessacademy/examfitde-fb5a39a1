import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PerAction {
  nba_action: string;
  decision: string;
  n: number;
  avg_lift_pp: number | null;
  avg_priority_shift: number | null;
}
interface Health {
  decisions_count: Record<string, number>;
  per_action: PerAction[];
  recent_audit: Array<{ at: string; details: any }>;
}

const DECISION_TONE: Record<string, string> = {
  prefer: 'bg-success-bg-subtle text-success border-success-border',
  neutral: 'bg-muted text-text-secondary border-border',
  downrank: 'bg-warning-bg-subtle text-warning border-warning-border',
  block: 'bg-destructive-bg-subtle text-destructive border-destructive-border',
  safety_fallback: 'bg-warning-bg-subtle text-warning border-warning-border',
};

export function NbaWeightingHealthCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['nba-weighting-health'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('admin_get_nba_weighting_health');
      if (error) throw error;
      return data as Health;
    },
    refetchInterval: 120_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          NBA Weighting Health (Bridge 7)
        </CardTitle>
        <div className="text-xs text-text-secondary mt-1">
          Empirische Gewichtung der NBA-Aktionen. Safety-Fallbacks (rescue/exam/activate) werden bei AT_RISK/CRITICAL nie geblockt.
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
          </div>
        ) : !data ? (
          <div className="text-sm text-text-secondary text-center py-6">Keine Daten.</div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.decisions_count ?? {}).map(([k, v]) => (
                <Badge key={k} variant="outline" className={cn('text-xs border', DECISION_TONE[k] ?? '')}>
                  {k}: {v}
                </Badge>
              ))}
              {(!data.decisions_count || Object.keys(data.decisions_count).length === 0) && (
                <span className="text-xs text-text-secondary">Noch keine NBA-Zeilen.</span>
              )}
            </div>
            <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
              {(data.per_action ?? []).map((r, i) => (
                <div
                  key={`${r.nba_action}-${r.decision}-${i}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-surface-subtle"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge variant="outline" className="font-mono text-xs">{r.nba_action}</Badge>
                    <Badge variant="outline" className={cn('text-xs border', DECISION_TONE[r.decision] ?? '')}>
                      {r.decision}
                    </Badge>
                    <Badge variant="outline" className="text-xs">n={r.n}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-secondary">
                    <span>⌀ lift {r.avg_lift_pp ?? '—'}pp</span>
                    <span
                      className={cn(
                        'font-semibold',
                        (r.avg_priority_shift ?? 0) > 0 ? 'text-success' :
                        (r.avg_priority_shift ?? 0) < 0 ? 'text-destructive' : 'text-text-primary',
                      )}
                    >
                      shift {r.avg_priority_shift != null && r.avg_priority_shift > 0 ? '+' : ''}
                      {r.avg_priority_shift ?? '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
