import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, AlertTriangle, ArrowRight, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';

type Funnel = {
  page_views: number;
  cta_visible: number;
  cta_clicked: number;
  heatmap_signals: number;
  quiz_started: number;
  quiz_completed: number;
  checkout_started: number;
  checkout_completed: number;
  unique_visitors: number;
};

type Breakdown = { event_type: string; count: number };

function pct(num: number, denom: number) {
  if (!denom) return null;
  return ((num / denom) * 100).toFixed(1) + '%';
}

function Step({ label, value, prev }: { label: string; value: number; prev?: number }) {
  const conv = prev != null ? pct(value, prev) : null;
  return (
    <div className="flex items-center gap-3">
      <div className="rounded-lg border border-border bg-surface-raised p-4 min-w-[10rem]">
        <div className="text-xs text-text-muted">{label}</div>
        <div className="text-2xl font-semibold text-text-primary">{value.toLocaleString('de-DE')}</div>
        {conv && <div className="text-[11px] text-text-muted mt-1">{conv} von vorher</div>}
      </div>
      <ArrowRight className="h-4 w-4 text-text-muted shrink-0" />
    </div>
  );
}

export default function AdminTrafficFunnelPage() {
  const funnelQ = useQuery({
    queryKey: ['admin-traffic-funnel-24h'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('admin_get_traffic_funnel_24h');
      if (error) throw error;
      return data as Funnel;
    },
    refetchInterval: 60_000,
  });

  const breakdownQ = useQuery({
    queryKey: ['admin-traffic-funnel-breakdown-24h'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('admin_get_traffic_funnel_breakdown_24h');
      if (error) throw error;
      return (data ?? []) as Breakdown[];
    },
    refetchInterval: 60_000,
  });

  const f = funnelQ.data;
  const isStall =
    !!f && f.cta_visible >= 50 && f.cta_clicked === 0 && f.quiz_started === 0 && f.checkout_started === 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Traffic Funnel · 24h</h1>
          <p className="text-sm text-text-secondary mt-1">
            CTA sichtbar → Klick → Quiz → Checkout → Purchase. SSOT: <code>conversion_events</code>.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { funnelQ.refetch(); breakdownQ.refetch(); }}>
          <RefreshCw className={`h-4 w-4 mr-1 ${funnelQ.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </header>

      {isStall && (
        <Card className="border-status-warning bg-status-warning-bg-subtle">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-status-warning shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-text-primary">Traffic-Stall erkannt</div>
              <div className="text-sm text-text-secondary">
                CTAs sind sichtbar ({f?.cta_visible}), aber 0 Klicks / 0 Quiz / 0 Checkouts. Sichtbarkeit ohne Engagement —
                prüfe CTA-Position, Copy oder Tracking-Drift.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Funnel-Kette</CardTitle></CardHeader>
        <CardContent>
          {funnelQ.isLoading || !f ? (
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          ) : (
            <div className="flex flex-wrap gap-y-3">
              <Step label="Page Views" value={f.page_views} />
              <Step label="CTA visible" value={f.cta_visible} prev={f.page_views} />
              <Step label="CTA clicked" value={f.cta_clicked} prev={f.cta_visible} />
              <Step label="Quiz started" value={f.quiz_started} prev={f.cta_clicked} />
              <Step label="Quiz completed" value={f.quiz_completed} prev={f.quiz_started} />
              <Step label="Checkout started" value={f.checkout_started} prev={f.quiz_completed} />
              <div className="rounded-lg border border-border bg-surface-raised p-4 min-w-[10rem]">
                <div className="text-xs text-text-muted">Checkout completed</div>
                <div className="text-2xl font-semibold text-text-primary">{f.checkout_completed.toLocaleString('de-DE')}</div>
                <div className="text-[11px] text-text-muted mt-1">{pct(f.checkout_completed, f.checkout_started) ?? '—'} von vorher</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Engagement-Signale</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-text-muted">Unique Visitors</span><span className="text-text-primary">{f?.unique_visitors ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Heatmap-Signale</span><span className="text-text-primary">{f?.heatmap_signals ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">CTR (clicked / visible)</span><span className="text-text-primary">{f ? pct(f.cta_clicked, f.cta_visible) ?? '—' : '—'}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Quiz-Start-Rate</span><span className="text-text-primary">{f ? pct(f.quiz_started, f.cta_clicked) ?? '—' : '—'}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Event-Breakdown 24h</CardTitle></CardHeader>
          <CardContent className="p-0">
            {breakdownQ.isLoading ? (
              <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>
            ) : !breakdownQ.data?.length ? (
              <p className="py-8 text-center text-text-muted">Keine Events in 24h.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {breakdownQ.data!.map((b) => (
                    <tr key={b.event_type} className="border-b border-border/60">
                      <td className="p-2 text-text-secondary">{b.event_type}</td>
                      <td className="p-2 text-right text-text-primary">{Number(b.count).toLocaleString('de-DE')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
