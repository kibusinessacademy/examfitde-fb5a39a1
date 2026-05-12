import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight, CheckCircle2, AlertTriangle, XCircle, Loader2, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';

type AxisStatus = 'green' | 'yellow' | 'red' | 'grey';

interface Axis {
  axis: 'orders' | 'traffic' | 'seo' | 'growth' | 'pipeline';
  status: AxisStatus;
  reasons: string[];
  metrics: Record<string, number>;
  route: string;
  cta: string;
}

interface Drilldown {
  taken_at: string;
  overall_status: string;
  can_soft_launch: boolean;
  can_public_launch: boolean;
  axes: Axis[];
}

const AXIS_LABEL: Record<Axis['axis'], string> = {
  orders: 'Orders & Grants',
  traffic: 'Traffic & Engagement',
  seo: 'SEO',
  growth: 'Growth & Pricing',
  pipeline: 'Pipeline / Jobs',
};

const STATUS_STYLE: Record<AxisStatus, { dot: string; badge: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  green: { dot: 'bg-success', badge: 'default', label: 'OK' },
  yellow: { dot: 'bg-warning', badge: 'secondary', label: 'Warning' },
  red: { dot: 'bg-destructive', badge: 'destructive', label: 'Critical' },
  grey: { dot: 'bg-muted-foreground', badge: 'outline', label: '—' },
};

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="h-4 w-4 text-success" />
  ) : (
    <XCircle className="h-4 w-4 text-destructive" />
  );
}

export default function LaunchReadinessDrilldownCard() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-launch-readiness-drilldown'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('admin_get_launch_readiness_drilldown');
      if (error) throw error;
      return data as Drilldown;
    },
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent>
      </Card>
    );
  }
  if (error || !data || (data as any).error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Launch-Readiness Snapshot nicht verfügbar.
        </CardContent>
      </Card>
    );
  }

  const blockers = data.axes.filter((a) => a.status === 'red').length;
  const warnings = data.axes.filter((a) => a.status === 'yellow').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Launch Readiness Drilldown</CardTitle>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1"><StatusIcon ok={data.can_soft_launch} /> soft</span>
            <span className="flex items-center gap-1"><StatusIcon ok={data.can_public_launch} /> public</span>
            <Badge variant={blockers > 0 ? 'destructive' : warnings > 0 ? 'secondary' : 'default'}>
              {blockers > 0 ? `${blockers} blocker` : warnings > 0 ? `${warnings} warning` : 'all clear'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.axes.map((axis) => {
          const style = STATUS_STYLE[axis.status];
          return (
            <div
              key={axis.axis}
              className="flex items-start gap-3 p-3 rounded-md border border-border bg-surface-raised"
            >
              <span className={cn('h-2.5 w-2.5 rounded-full mt-1.5 shrink-0', style.dot)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-text-primary text-sm">{AXIS_LABEL[axis.axis]}</div>
                  <Badge variant={style.badge}>{style.label}</Badge>
                </div>
                {axis.reasons.length > 0 ? (
                  <ul className="text-xs text-text-secondary mt-1 space-y-0.5">
                    {axis.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <AlertTriangle className={cn('h-3 w-3 mt-0.5 shrink-0', axis.status === 'red' ? 'text-destructive' : 'text-warning')} />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-text-muted mt-1">Keine Befunde.</div>
                )}
                <div className="text-[10.5px] text-text-muted mt-1 font-mono">
                  {Object.entries(axis.metrics).map(([k, v]) => `${k}=${v}`).join(' · ')}
                </div>
              </div>
              <Button
                size="sm"
                variant={axis.status === 'red' ? 'default' : 'outline'}
                className="shrink-0"
                onClick={() => navigate(axis.route)}
              >
                {axis.cta} <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          );
        })}
        <div className="text-[10px] text-text-muted text-right">
          Stand: {new Date(data.taken_at).toLocaleString('de-DE')}
        </div>
      </CardContent>
    </Card>
  );
}
