import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, TrendingUp } from 'lucide-react';

interface DriverRow {
  curriculum_id: string;
  attempts: number;
  passes: number;
  fails: number;
  pass_rate_pct: number | null;
  avg_score: number | null;
  avg_readiness_at_attempt: number | null;
  avg_days_since_activation: number | null;
  top_failure_drivers: Array<{ competency_id: string; fail_rate_when_weak: number; appears_in_attempts: number }> | null;
}

export function ExamSuccessDriversCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['exam-success-drivers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('admin_get_exam_success_drivers');
      if (error) throw error;
      return (data || []) as DriverRow[];
    },
    refetchInterval: 60_000,
  });

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Exam Success Drivers (Bridge 5)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Outcome-Events erfasst. Sobald Prüfungssimulationen abgeschlossen werden, erscheinen hier statistische Erfolgs-/Misserfolgs-Treiber.</p>
        ) : (
          <div className="space-y-2">
            {data.slice(0, 10).map((r) => (
              <div key={r.curriculum_id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-surface-1">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground truncate">{r.curriculum_id}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline">{r.attempts} Attempts</Badge>
                    <Badge variant="secondary">{r.pass_rate_pct ?? '—'}% Pass</Badge>
                    {r.avg_readiness_at_attempt != null && (
                      <Badge variant="outline">⌀ Readiness {Number(r.avg_readiness_at_attempt).toFixed(0)}</Badge>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Top Failure Drivers</p>
                  <p className="text-sm font-medium">{r.top_failure_drivers?.length ?? 0}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
