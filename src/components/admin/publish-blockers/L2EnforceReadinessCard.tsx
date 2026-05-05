/**
 * L2EnforceReadinessCard
 * ----------------------
 * Promotion-Metrik für den Course Publish Guard Level 2.
 * Zeigt: ready_to_publish %, Blocker-Cluster, pending/failed Minicheck-Jobs,
 * 24h-Audit (warned/blocked/bypassed) und ein safe_to_enforce-Signal.
 *
 * Source: admin_get_l2_enforce_readiness() (SECURITY DEFINER, has_role gated)
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Gauge, ShieldCheck, ShieldAlert } from 'lucide-react';

type Blocker = { readiness_level: string; primary_blocker: string | null; count: number };
type Readiness = {
  total_published: number;
  ready_to_publish: number;
  ready_pct: number;
  blockers: Blocker[];
  minicheck_jobs_pending: number;
  minicheck_jobs_failed: number;
  l2_warned_24h: number;
  l2_blocked_24h: number;
  l2_bypassed_24h: number;
  safe_to_enforce: boolean;
  computed_at: string;
};

export default function L2EnforceReadinessCard() {
  const q = useQuery({
    queryKey: ['admin-l2-enforce-readiness'],
    queryFn: async (): Promise<Readiness> => {
      const { data, error } = await supabase.rpc('admin_get_l2_enforce_readiness' as any);
      if (error) throw error;
      return data as Readiness;
    },
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-text-secondary" />
          L2 Enforce-Readiness
          {q.data?.safe_to_enforce ? (
            <Badge variant="default" className="ml-2 gap-1">
              <ShieldCheck className="h-3 w-3" /> safe to enforce
            </Badge>
          ) : (
            <Badge variant="secondary" className="ml-2 gap-1">
              <ShieldAlert className="h-3 w-3" /> noch nicht
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Wann darf <code>app.publish_guard_level2</code> von <code>warn</code> auf{' '}
          <code>enforce</code> wechseln? Datenbasiert — kein Bauchgefühl.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading || !q.data ? (
          <div className="flex items-center gap-2 text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> lade …
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric label="ready_to_publish %" value={`${q.data.ready_pct}%`}
                hint={`${q.data.ready_to_publish}/${q.data.total_published}`} />
              <Metric label="minicheck pending" value={q.data.minicheck_jobs_pending} />
              <Metric label="minicheck failed" value={q.data.minicheck_jobs_failed}
                tone={q.data.minicheck_jobs_failed > 0 ? 'warn' : 'ok'} />
              <Metric label="L2 warned (24h)" value={q.data.l2_warned_24h}
                hint={`bypassed ${q.data.l2_bypassed_24h} · blocked ${q.data.l2_blocked_24h}`} />
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-text-tertiary mb-2">
                Blocker-Cluster
              </div>
              {q.data.blockers.length === 0 ? (
                <div className="text-sm text-text-secondary">
                  Keine Blocker — alle published Kurse sind ready_to_publish. ✅
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {q.data.blockers.map((b, i) => (
                    <Badge key={i} variant="outline" className="font-mono text-xs">
                      {b.primary_blocker ?? b.readiness_level}: {b.count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="text-[10px] text-text-tertiary">
              berechnet {new Date(q.data.computed_at).toLocaleString('de-DE')} · Promotion-Bedingung:{' '}
              <code>minicheck_failed=0</code> &amp; <code>empty=0</code>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label, value, hint, tone = 'neutral',
}: { label: string; value: number | string; hint?: string; tone?: 'ok' | 'warn' | 'neutral' }) {
  const toneClass =
    tone === 'warn' ? 'text-status-warning' : tone === 'ok' ? 'text-status-success' : '';
  return (
    <div className="border border-border-subtle rounded-md p-3 bg-surface-1">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="text-[10px] text-text-tertiary mt-1">{hint}</div>}
    </div>
  );
}
