import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ByMode {
  tutor_mode: string;
  sessions: number;
  completed: number;
  abandoned: number;
  avg_readiness_delta: number | null;
}
interface ByIntervention {
  intervention_type: string;
  sessions: number;
  completion_rate_pct: number | null;
  avg_readiness_delta: number | null;
}
interface Health {
  window_days: number;
  totals: {
    sessions: number;
    completed: number;
    completion_rate_pct: number | null;
    avg_readiness_delta: number | null;
  };
  by_mode: ByMode[];
  by_intervention: ByIntervention[];
}

const MODE_TONE: Record<string, string> = {
  explainer: 'bg-info-bg-subtle text-info border-info-border',
  coach: 'bg-success-bg-subtle text-success border-success-border',
  examiner: 'bg-warning-bg-subtle text-warning border-warning-border',
  feedback: 'bg-muted text-text-secondary border-border',
};

function deltaTone(d: number | null) {
  if (d == null) return 'text-text-secondary';
  if (d > 0) return 'text-success font-semibold';
  if (d < 0) return 'text-destructive font-semibold';
  return 'text-text-primary';
}

export function TutorInterventionHealthCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['tutor-intervention-health'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('admin_get_tutor_intervention_health', { p_days: 14 });
      if (error) throw error;
      return data as Health;
    },
    refetchInterval: 120_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-primary" />
          AI Tutor v2 — NBA Executor (Bridge 8)
        </CardTitle>
        <div className="text-xs text-text-secondary mt-1">
          Tutor-Sessions als Empirical-NBA-Executor. SSOT-Pflicht: jede Session ist an Curriculum / Blueprint / Lesson / Competency / Exam gebunden.
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-md border bg-surface-subtle px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-text-secondary">Sessions ({data.window_days}d)</div>
                <div className="text-lg font-semibold">{data.totals?.sessions ?? 0}</div>
              </div>
              <div className="rounded-md border bg-surface-subtle px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-text-secondary">Completed</div>
                <div className="text-lg font-semibold">{data.totals?.completed ?? 0}</div>
              </div>
              <div className="rounded-md border bg-surface-subtle px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-text-secondary">Completion %</div>
                <div className="text-lg font-semibold">{data.totals?.completion_rate_pct ?? '—'}</div>
              </div>
              <div className="rounded-md border bg-surface-subtle px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-text-secondary">⌀ Readiness Δ</div>
                <div className={cn('text-lg', deltaTone(data.totals?.avg_readiness_delta ?? null))}>
                  {data.totals?.avg_readiness_delta ?? '—'}
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold mb-1.5">Per Tutor-Mode</div>
              <div className="flex flex-wrap gap-2">
                {(data.by_mode ?? []).map((m) => (
                  <Badge key={m.tutor_mode} variant="outline" className={cn('text-xs border', MODE_TONE[m.tutor_mode] ?? '')}>
                    {m.tutor_mode}: {m.sessions} · {m.completed}✓ · Δ {m.avg_readiness_delta ?? '—'}
                  </Badge>
                ))}
                {(data.by_mode ?? []).length === 0 && (
                  <span className="text-xs text-text-secondary">Noch keine Sessions.</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold mb-1.5">Per Intervention</div>
              <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                {(data.by_intervention ?? []).map((i) => (
                  <div
                    key={i.intervention_type}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-surface-subtle"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Badge variant="outline" className="font-mono text-xs">{i.intervention_type}</Badge>
                      <Badge variant="outline" className="text-xs">n={i.sessions}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-secondary">
                      <span>compl {i.completion_rate_pct ?? '—'}%</span>
                      <span className={deltaTone(i.avg_readiness_delta)}>
                        Δ {i.avg_readiness_delta ?? '—'}
                      </span>
                    </div>
                  </div>
                ))}
                {(data.by_intervention ?? []).length === 0 && (
                  <div className="text-xs text-text-secondary text-center py-3">Noch keine Tutor-Interventionen geloggt.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
