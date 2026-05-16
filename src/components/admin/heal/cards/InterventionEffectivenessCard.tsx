import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Row {
  intervention_type: string;
  risk_bucket: string;
  lf_code: string;
  sample_size: number;
  avg_readiness_delta: number | null;
  pass_rate_pct: number | null;
  baseline_pass_rate_pct: number | null;
  pass_rate_lift_pp: number | null;
  confidence_label: string | null;
  computed_at: string;
}

const CONF_TONE: Record<string, string> = {
  high: 'bg-success-bg-subtle text-success border-success-border',
  medium: 'bg-muted text-text-secondary border-border',
  low: 'bg-warning-bg-subtle text-warning border-warning-border',
};

export function InterventionEffectivenessCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['intervention-effectiveness'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('admin_get_intervention_effectiveness');
      if (error) throw error;
      return (data || []) as Row[];
    },
    refetchInterval: 120_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Intervention Effectiveness (Bridge 6)
        </CardTitle>
        <div className="text-xs text-text-secondary mt-1">
          Empirische Wirksamkeit pro Intervention × Risiko × LF. Lift in Prozentpunkten vs. Baseline-Pass-Rate.
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
          </div>
        ) : !data?.length ? (
          <div className="text-sm text-text-secondary text-center py-6">
            Noch keine aggregierten Scores. Nach Recompute (`fn_recompute_intervention_effectiveness`) erscheinen hier
            empirische Lift-Werte.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
            {data.map((r, i) => (
              <div
                key={`${r.intervention_type}-${r.risk_bucket}-${r.lf_code}-${i}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-surface-subtle"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Badge variant="outline" className="font-mono text-xs">{r.intervention_type}</Badge>
                  <Badge variant="outline" className="text-xs">risk: {r.risk_bucket}</Badge>
                  <Badge variant="outline" className="text-xs">lf: {r.lf_code}</Badge>
                  {r.confidence_label && (
                    <Badge variant="outline" className={cn('text-xs border', CONF_TONE[r.confidence_label] ?? '')}>
                      n={r.sample_size} · {r.confidence_label}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-text-secondary flex-shrink-0">
                  <span>Δready {r.avg_readiness_delta ?? '—'}</span>
                  <span>pass {r.pass_rate_pct ?? '—'}%</span>
                  <span
                    className={cn(
                      'font-semibold',
                      (r.pass_rate_lift_pp ?? 0) > 0 ? 'text-success' : (r.pass_rate_lift_pp ?? 0) < 0 ? 'text-destructive' : 'text-text-primary',
                    )}
                  >
                    lift {r.pass_rate_lift_pp != null ? `${r.pass_rate_lift_pp > 0 ? '+' : ''}${r.pass_rate_lift_pp}pp` : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
