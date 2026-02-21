import { useEffect, useState, useCallback } from 'react';
import { Server, Brain, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Loading, MiniKPI } from './OpsShared';

export default function ProviderAutopilotDashboard() {
  const [providers, setProviders] = useState<any[]>([]);
  const [affinity, setAffinity] = useState<any[]>([]);
  const [backpressure, setBackpressure] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [provRes, affRes, bpRes] = await Promise.all([
      (supabase as any).from('provider_status').select('*').order('priority'),
      (supabase as any).from('provider_job_affinity').select('*').order('job_type'),
      (supabase as any).from('backpressure_snapshots').select('*').order('snapshot_at', { ascending: false }).limit(20),
    ]);
    setProviders(provRes.data || []);
    setAffinity(affRes.data || []);
    setBackpressure(bpRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  if (loading) return <Loading />;

  const totalSlots = providers.reduce((s: number, p: any) => s + (p.max_concurrency || 0), 0);
  const usedSlots = providers.reduce((s: number, p: any) => s + (p.current_load || 0), 0);
  const healthyCount = providers.filter((p: any) => p.is_healthy).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {providers.map((p: any) => {
          const loadPct = p.max_concurrency > 0 ? (p.current_load / p.max_concurrency) * 100 : 0;
          const isRL = p.rate_limited_until && new Date(p.rate_limited_until) > new Date();
          return (
            <Card key={p.provider} className={cn("border-l-4",
              !p.is_healthy ? "border-l-destructive" :
              loadPct > 80 ? "border-l-yellow-500" : "border-l-emerald-500"
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    {p.provider.charAt(0).toUpperCase() + p.provider.slice(1)}
                  </span>
                  <Badge variant="outline" className={cn("text-[10px]",
                    p.is_healthy ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
                  )}>
                    {p.is_healthy ? '✓ Healthy' : '✗ Down'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Load</span><span>{p.current_load}/{p.max_concurrency} Slots</span>
                  </div>
                  <Progress value={loadPct} className="h-2" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Routing Score</p>
                    <p className={cn("font-bold text-lg",
                      (p.routing_score ?? 0) >= 80 ? "text-emerald-600" :
                      (p.routing_score ?? 0) >= 50 ? "text-yellow-600" : "text-destructive"
                    )}>{(p.routing_score ?? 0).toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Reliability</p>
                    <p className={cn("font-bold text-lg",
                      (p.reliability_score ?? 100) >= 90 ? "text-emerald-600" :
                      (p.reliability_score ?? 100) >= 70 ? "text-yellow-600" : "text-destructive"
                    )}>{(p.reliability_score ?? 100).toFixed(0)}%</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1 text-[10px]">
                  <div className="text-center"><p className="text-muted-foreground">24h ✓</p><p className="font-medium text-emerald-600">{p.total_success_24h || 0}</p></div>
                  <div className="text-center"><p className="text-muted-foreground">24h ✗</p><p className="font-medium text-destructive">{p.total_errors_24h || 0}</p></div>
                  <div className="text-center"><p className="text-muted-foreground">Latenz</p><p className="font-medium">{p.avg_latency_ms || 0}ms</p></div>
                </div>
                {isRL && (
                  <div className="bg-destructive/10 rounded px-2 py-1 text-xs text-destructive">
                    ⏳ Cooldown bis {new Date(p.rate_limited_until).toLocaleTimeString('de-DE')}
                    {p.cooldown_multiplier > 1 && ` (×${p.cooldown_multiplier})`}
                  </div>
                )}
                {p.consecutive_failures > 0 && <p className="text-[10px] text-destructive">{p.consecutive_failures} consecutive failure{p.consecutive_failures > 1 ? 's' : ''}</p>}
                {p.last_error && <p className="text-[10px] text-muted-foreground truncate" title={p.last_error}>Last: {p.last_error}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="Healthy Providers" value={`${healthyCount}/${providers.length}`} alert={healthyCount < 2} />
        <MiniKPI label="Slots genutzt" value={`${usedSlots}/${totalSlots}`} alert={usedSlots >= totalSlots * 0.9} />
        <MiniKPI label="Backpressure" value={backpressure[0]?.forecast_trend === 'rising' ? '📈 Rising' : backpressure[0]?.forecast_trend === 'falling' ? '📉 Falling' : '→ Stable'} alert={backpressure[0]?.forecast_trend === 'rising'} />
        <MiniKPI label="ETA Queue Clear" value={backpressure[0]?.eta_clear_minutes ? `${backpressure[0].eta_clear_minutes.toFixed(0)} min` : '–'} sub={`${backpressure[0]?.throughput_per_min?.toFixed(1) ?? 0} Jobs/min`} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4" /> Intent-Based Routing ({affinity.length} Rules)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Job Type</th>
                  <th className="text-left py-2 px-3">Provider</th>
                  <th className="text-left py-2 px-3">Grund</th>
                  <th className="text-right py-2 px-3">Weight</th>
                </tr>
              </thead>
              <tbody>
                {affinity.map((a: any) => (
                  <tr key={a.id} className="border-b border-border/30">
                    <td className="py-2 px-3 font-mono">{a.job_type}</td>
                    <td className="py-2 px-3"><Badge variant="outline" className="text-[10px]">{a.preferred_provider}</Badge></td>
                    <td className="py-2 px-3 text-muted-foreground">{a.reason}</td>
                    <td className="py-2 px-3 text-right font-medium">{a.weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {backpressure.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Backpressure Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Zeit</th>
                    <th className="text-right py-2 px-2">Pending</th>
                    <th className="text-right py-2 px-2">Processing</th>
                    <th className="text-right py-2 px-2">✓/h</th>
                    <th className="text-right py-2 px-2">✗/h</th>
                    <th className="text-right py-2 px-2">Jobs/min</th>
                    <th className="text-right py-2 px-2">ETA</th>
                    <th className="text-center py-2 px-2">Trend</th>
                    <th className="text-center py-2 px-2">Throttle</th>
                  </tr>
                </thead>
                <tbody>
                  {backpressure.map((bp: any) => (
                    <tr key={bp.id} className={cn("border-b border-border/30", bp.throttle_active && "bg-destructive/5")}>
                      <td className="py-1.5 px-2 text-muted-foreground">{new Date(bp.snapshot_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="py-1.5 px-2 text-right font-medium">{bp.pending_count}</td>
                      <td className="py-1.5 px-2 text-right">{bp.processing_count}</td>
                      <td className="py-1.5 px-2 text-right text-emerald-600">{bp.completed_1h}</td>
                      <td className="py-1.5 px-2 text-right text-destructive">{bp.failed_1h}</td>
                      <td className="py-1.5 px-2 text-right">{bp.throughput_per_min?.toFixed(1)}</td>
                      <td className="py-1.5 px-2 text-right">{bp.eta_clear_minutes?.toFixed(0)}m</td>
                      <td className="py-1.5 px-2 text-center">{bp.forecast_trend === 'rising' ? '📈' : bp.forecast_trend === 'falling' ? '📉' : '→'}</td>
                      <td className="py-1.5 px-2 text-center">{bp.throttle_active ? <Badge variant="destructive" className="text-[9px]">ON</Badge> : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
