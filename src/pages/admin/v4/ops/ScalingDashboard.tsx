import { useEffect, useState, useCallback } from 'react';
import { Server, Zap, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loading, MiniKPI } from './OpsShared';

export default function ScalingDashboard() {
  const [capacity, setCapacity] = useState<any>(null);
  const [limits, setLimits] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [capRes, limRes, sigRes] = await Promise.all([
      (supabase as any).from('pipeline_capacity').select('*').eq('id', true).maybeSingle(),
      (supabase as any).from('jobtype_limits').select('*').order('job_type'),
      (supabase as any).from('ops_runtime_signals').select('*').order('ts', { ascending: false }).limit(20),
    ]);
    setCapacity(capRes.data);
    setLimits(limRes.data || []);
    setSignals(sigRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  if (loading) return <Loading />;

  const lastDecision = capacity?.last_decision || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="Current WIP" value={capacity?.max_wip ?? '–'} sub={`min: ${capacity?.min_wip ?? 1}`} />
        <MiniKPI label="Last Action" value={lastDecision.action || '–'} sub={lastDecision.trigger || ''} />
        <MiniKPI label="Error Rate" value={`${lastDecision.error_rate ?? 0}%`} alert={(lastDecision.error_rate ?? 0) > 20} />
        <MiniKPI label="Rate Limits (10m)" value={lastDecision.rate_limit_errors_10m ?? 0} alert={(lastDecision.rate_limit_errors_10m ?? 0) > 5} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4" /> WIP Override</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">max_wip:</span>
            {[1, 2, 3, 4, 5, 6].map(v => (
              <Button key={v} size="sm" variant={capacity?.max_wip === v ? 'default' : 'outline'}
                className="h-7 w-8 text-xs"
                onClick={async () => {
                  await (supabase as any).from('pipeline_capacity').update({ max_wip: v, last_decision: { action: 'manual_override', set_by: 'admin' }, updated_at: new Date().toISOString() }).eq('id', true);
                  toast.success(`WIP → ${v}`);
                  load();
                }}>
                {v}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4" /> Job Type Concurrency Limits</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Job Type</th>
                  <th className="text-right py-2 px-3">Max Parallel</th>
                  <th className="text-right py-2 px-3">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {limits.map((l: any) => (
                  <tr key={l.job_type} className="border-b border-border/30">
                    <td className="py-2 px-3 font-mono">{l.job_type}</td>
                    <td className="py-2 px-3 text-right font-bold">{l.max_processing}</td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-xs" onClick={async () => {
                          if (l.max_processing <= 1) return;
                          await (supabase as any).from('jobtype_limits').update({ max_processing: l.max_processing - 1 }).eq('job_type', l.job_type);
                          load();
                        }}>−</Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-xs" onClick={async () => {
                          await (supabase as any).from('jobtype_limits').update({ max_processing: l.max_processing + 1 }).eq('job_type', l.job_type);
                          load();
                        }}>+</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {signals.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Scaling Signals (letzte 20)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {signals.map((s: any, i: number) => (
                <div key={i} className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground shrink-0 w-[100px]">
                    {new Date(s.ts).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                  </span>
                  <Badge variant="outline" className={cn("text-[10px]",
                    s.signal?.action === 'scale_down' ? 'bg-destructive/10 text-destructive' :
                    s.signal?.action === 'scale_up' ? 'bg-emerald-500/10 text-emerald-600' : ''
                  )}>{s.signal?.action || '–'}</Badge>
                  <span className="text-muted-foreground">{s.signal?.trigger || ''}</span>
                  <span className="text-foreground">err: {s.signal?.error_rate ?? 0}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
