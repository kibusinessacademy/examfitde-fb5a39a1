/**
 * LaunchQueueAlertsCard
 * ---------------------
 * Reads admin_get_launch_queue_health_alerts() and renders the alerts list.
 * Highlights pending_older_30m>0 / failed_24h>0 / stuck_processing>0.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';

type Alert = {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  action_label?: string;
};
type Payload = {
  generated_at: string;
  pending_older_30m: number;
  failed_24h: number;
  stuck_processing: number;
  is_healthy: boolean;
  alerts: Alert[];
};

const SEV_BG: Record<Alert['severity'], string> = {
  critical: 'border-destructive/40 bg-destructive-bg-subtle',
  high: 'border-orange-500/40 bg-orange-500/10',
  medium: 'border-amber-500/40 bg-amber-500/10',
  low: 'border-border bg-card',
};

export default function LaunchQueueAlertsCard() {
  const q = useQuery({
    queryKey: ['admin-launch-queue-health-alerts'],
    queryFn: async (): Promise<Payload> => {
      const { data, error } = await supabase.rpc('admin_get_launch_queue_health_alerts' as any);
      if (error) throw error;
      return data as Payload;
    },
    refetchInterval: 60_000,
  });

  const d = q.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {d?.is_healthy ? (
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          )}
          <CardTitle>Launch Queue Health</CardTitle>
          {d && (
            <Badge variant={d.is_healthy ? 'default' : 'destructive'} className="ml-2 uppercase">
              {d.is_healthy ? 'healthy' : 'attention'}
            </Badge>
          )}
        </div>
        <CardDescription>
          Alerts für verkaufsrelevante Jobs (lesson_generate_content, minichecks, exam_pool, auto_publish).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-text-secondary text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> lade …
          </div>
        ) : !d ? (
          <div className="text-sm text-text-secondary">keine Daten</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md border border-border-subtle p-2">
                <div className="text-text-tertiary">pending &gt;30m</div>
                <div className="text-base font-mono">{d.pending_older_30m}</div>
              </div>
              <div className="rounded-md border border-border-subtle p-2">
                <div className="text-text-tertiary">failed 24h</div>
                <div className="text-base font-mono">{d.failed_24h}</div>
              </div>
              <div className="rounded-md border border-border-subtle p-2">
                <div className="text-text-tertiary">stuck processing</div>
                <div className="text-base font-mono">{d.stuck_processing}</div>
              </div>
            </div>

            {d.alerts.length === 0 ? (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-500">
                Keine Launch-Queue-Alerts.
              </div>
            ) : (
              <div className="space-y-2">
                {d.alerts.map((a) => (
                  <div key={a.id} className={`rounded-md border p-3 ${SEV_BG[a.severity]}`}>
                    <div className="text-sm font-semibold">{a.title}</div>
                    <div className="text-xs text-text-secondary mt-1">{a.detail}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[10px] text-text-tertiary text-right">
              generiert {new Date(d.generated_at).toLocaleString('de-DE')}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
