import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Loader2, Target, ExternalLink, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Row = {
  run_id: string;
  package_id: string;
  package_title: string | null;
  package_key: string | null;
  subscore: 'cta' | 'funnel_events';
  status: string;
  verdict: 'red' | 'yellow' | 'green' | null;
  recommended_action:
    | 'check_landing_page_cta_render'
    | 'review_cta_copy_for_engagement'
    | 'verify_checkout_event_wiring'
    | 'verify_lead_form_wiring';
  reason_code: string | null;
  artifact_ref: any;
  created_at: string;
  severity_rank: number;
};

const ACTION_LABEL: Record<Row['recommended_action'], string> = {
  check_landing_page_cta_render: 'Landingpage / CTA-Render prüfen',
  review_cta_copy_for_engagement: 'CTA-Copy auf Engagement reviewen',
  verify_checkout_event_wiring: 'Checkout-Event-Verkabelung prüfen',
  verify_lead_form_wiring: 'Lead-Form-Verkabelung prüfen',
};

const REASON_LABEL: Record<string, string> = {
  missing_checkout_events: 'Pflicht-Checkout-Events fehlen',
  missing_lead_form_events: 'Lead-/Quiz-Events fehlen',
  missing_landing_or_cta_visible: 'Landing- oder CTA-Visible fehlt',
  no_cta_assets_published: 'Keine CTA-Assets veröffentlicht',
  cta_visible_but_no_clicks: 'CTA wird gesehen, aber nicht geklickt',
  cta_assets_present_but_no_impressions: 'CTA-Assets ohne Impressions',
  cta_engagement_below_threshold: 'CTA-Engagement unter Schwelle',
};

function verdictBadge(v: Row['verdict']) {
  if (v === 'red') return <Badge variant="destructive">red</Badge>;
  if (v === 'yellow') return <Badge className="bg-warning-bg-subtle text-warning border-warning/30">yellow</Badge>;
  if (v === 'green') return <Badge className="bg-success-bg-subtle text-success border-success/30">green</Badge>;
  return <Badge variant="outline">—</Badge>;
}

export default function GrowthNextBestFixCard() {
  const q = useQuery({
    queryKey: ['growth-next-best-fix'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_growth_next_best_fix' as any, { p_limit: 50 });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          Next Best Growth Fix
        </CardTitle>
        <CardDescription>
          Aggregierte Empfehlungen aus den jüngsten CTA-/Funnel-Audits. Kein Content wird mutiert — nur klassifiziert und priorisiert.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : q.error ? (
          <p className="text-sm text-destructive">Fehler: {(q.error as Error).message}</p>
        ) : !q.data?.length ? (
          <p className="text-sm text-muted-foreground">Keine offenen Empfehlungen — alle Audits grün oder ungeklärt.</p>
        ) : (
          <ScrollArea className="h-[420px] pr-3">
            <ul className="space-y-2">
              {q.data.map((r) => (
                <li
                  key={r.run_id}
                  className="rounded-lg border border-border bg-surface-elev1 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {r.package_title ?? r.package_key ?? r.package_id.slice(0, 8)}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {r.subscore} · {new Date(r.created_at).toLocaleString()}
                      </div>
                    </div>
                    {verdictBadge(r.verdict)}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <ExternalLink className="h-3.5 w-3.5 text-primary" />
                    <span className="font-semibold text-foreground">
                      {ACTION_LABEL[r.recommended_action] ?? r.recommended_action}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {REASON_LABEL[r.reason_code ?? ''] ?? r.reason_code ?? '—'}
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
