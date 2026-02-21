import { useEffect, useState, useCallback } from 'react';
import { Clock, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Loading } from './OpsShared';

export default function ThroughputDashboard() {
  const [data, setData] = useState<{
    curricula: Record<string, number>;
    packages: Record<string, number>;
    backpressure: any[];
    budget: any;
    activeSlots: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [currRes, pkgRes, bpRes, mtdCostRes, budgetRes, lockRes] = await Promise.all([
      (supabase as any).rpc('count_curricula_by_status'),
      (supabase as any).rpc('count_packages_by_status'),
      (supabase as any).from('backpressure_snapshots').select('*').order('snapshot_at', { ascending: false }).limit(30),
      (supabase as any).from('llm_cost_events').select('cost_eur').gte('ts', monthStart.toISOString()),
      (supabase as any).from('ai_cost_budgets').select('budget_eur').order('month', { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from('pipeline_lock').select('active_package_ids, max_active_packages').eq('id', 1).maybeSingle(),
    ]);
    const mtdCosts = (mtdCostRes.data || []) as { cost_eur: number }[];
    const spentEur = mtdCosts.reduce((s, c) => s + (c.cost_eur || 0), 0);
    const budgetEur = budgetRes.data?.budget_eur ?? 200;

    const currMap: Record<string, number> = {};
    for (const r of (currRes.data || [])) currMap[r.status] = Number(r.count);
    const pkgMap: Record<string, number> = {};
    for (const r of (pkgRes.data || [])) pkgMap[r.status] = Number(r.count);

    setData({
      curricula: currMap,
      packages: pkgMap,
      backpressure: bpRes.data || [],
      budget: { spent_eur: spentEur, budget_eur: budgetEur, hard_stop: spentEur >= budgetEur },
      activeSlots: lockRes.data?.active_package_ids || [],
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  if (loading) return <Loading />;
  if (!data) return null;

  const totalCurricula = Object.values(data.curricula).reduce((s, v) => s + v, 0);
  const frozenCount = data.curricula['frozen'] || 0;
  const draftCount = data.curricula['draft'] || 0;
  const freezePct = totalCurricula > 0 ? (frozenCount / totalCurricula) * 100 : 0;

  const publishedPkgs = data.packages['published'] || 0;
  const buildingPkgs = data.packages['building'] || 0;
  const queuedPkgs = data.packages['queued'] || 0;
  const failedPkgs = data.packages['failed'] || 0;
  const totalPkgs = Object.values(data.packages).reduce((s, v) => s + v, 0);

  const latestBp = data.backpressure[0];
  const throughput = latestBp?.throughput_per_min ?? 0;
  const etaMinutes = latestBp?.eta_clear_minutes ?? 0;
  const freezeEtaMin = throughput > 0 ? draftCount / throughput : 0;
  const buildEtaMin = throughput > 0 ? queuedPkgs * 15 : 0;
  const budgetPct = data.budget ? (data.budget.spent_eur / data.budget.budget_eur) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className={cn(draftCount > 50 && "border-yellow-500/50")}>
          <CardContent className="py-4 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Freeze-Fortschritt</p>
            <p className="text-2xl font-bold text-foreground">{freezePct.toFixed(0)}%</p>
            <Progress value={freezePct} className="h-1.5 mt-2" />
            <p className="text-[10px] text-muted-foreground mt-1">{frozenCount}/{totalCurricula} frozen · {draftCount} drafts übrig</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Build-Pipeline</p>
            <p className="text-2xl font-bold text-foreground">{buildingPkgs}/{data.activeSlots.length > 0 ? data.activeSlots.length : 1}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{queuedPkgs} queued · {publishedPkgs} published · {failedPkgs} failed</p>
            <p className="text-[10px] text-muted-foreground">WIP-Slots: {data.activeSlots.length}/{(data as any).activeSlots?.length ?? 2}</p>
          </CardContent>
        </Card>
        <Card className={cn(etaMinutes > 120 && "border-yellow-500/50")}>
          <CardContent className="py-4 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">ETA Queue Clear</p>
            <p className="text-2xl font-bold text-foreground">
              {etaMinutes > 0 ? (etaMinutes > 60 ? `${(etaMinutes / 60).toFixed(1)}h` : `${etaMinutes.toFixed(0)}min`) : '–'}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {throughput.toFixed(1)} Jobs/min · Trend: {latestBp?.forecast_trend === 'rising' ? '📈 Rising' : latestBp?.forecast_trend === 'falling' ? '📉 Falling' : '→ Stable'}
            </p>
          </CardContent>
        </Card>
        <Card className={cn(budgetPct >= 80 && "border-destructive/50")}>
          <CardContent className="py-4 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">LLM Budget</p>
            <p className={cn("text-2xl font-bold", budgetPct >= 90 ? "text-destructive" : budgetPct >= 70 ? "text-yellow-600" : "text-foreground")}>
              €{data.budget?.spent_eur?.toFixed(2) ?? '0.00'}
            </p>
            <Progress value={budgetPct} className="h-1.5 mt-2" />
            <p className="text-[10px] text-muted-foreground mt-1">/ €{data.budget?.budget_eur ?? 200} · {data.budget?.hard_stop ? '🛑 HARD STOP' : '✅ aktiv'}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" /> Phasen-Prognose</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Phase 1: Freeze</p>
              <div className="flex items-center justify-between">
                <span className="text-sm">{draftCount} Curricula übrig</span>
                <Badge variant="outline" className="text-[10px]">{freezeEtaMin > 60 ? `~${(freezeEtaMin / 60).toFixed(1)}h` : `~${freezeEtaMin.toFixed(0)}min`}</Badge>
              </div>
              <Progress value={freezePct} className="h-2" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Phase 2: Build</p>
              <div className="flex items-center justify-between">
                <span className="text-sm">{queuedPkgs} Pakete in Queue</span>
                <Badge variant="outline" className="text-[10px]">{buildEtaMin > 60 ? `~${(buildEtaMin / 60).toFixed(1)}h` : `~${buildEtaMin.toFixed(0)}min`}</Badge>
              </div>
              <Progress value={totalPkgs > 0 ? (publishedPkgs / totalPkgs) * 100 : 0} className="h-2" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Gesamt-Fortschritt</p>
              <div className="flex items-center justify-between">
                <span className="text-sm">{publishedPkgs} von {totalPkgs} publiziert</span>
                <Badge variant="outline" className={cn("text-[10px]", totalPkgs > 0 && publishedPkgs === totalPkgs && "bg-emerald-500/10 text-emerald-600")}>
                  {totalPkgs > 0 ? `${((publishedPkgs / totalPkgs) * 100).toFixed(0)}%` : '0%'}
                </Badge>
              </div>
              <Progress value={totalPkgs > 0 ? (publishedPkgs / totalPkgs) * 100 : 0} className="h-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Curricula nach Status</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(data.curricula).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2.5 h-2.5 rounded-full",
                      status === 'frozen' ? 'bg-emerald-500' : status === 'draft' ? 'bg-muted-foreground' :
                      status === 'extracting' ? 'bg-primary' : 'bg-yellow-500'
                    )} />
                    <span className="text-foreground">{status}</span>
                  </div>
                  <span className="font-mono font-medium text-foreground">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Packages nach Status</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(data.packages).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2.5 h-2.5 rounded-full",
                      status === 'published' ? 'bg-emerald-500' : status === 'building' ? 'bg-primary' :
                      status === 'queued' ? 'bg-yellow-500' : status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground'
                    )} />
                    <span className="text-foreground">{status}</span>
                  </div>
                  <span className="font-mono font-medium text-foreground">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {data.backpressure.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Throughput Timeline (letzte 30 Snapshots)</CardTitle></CardHeader>
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
                  </tr>
                </thead>
                <tbody>
                  {data.backpressure.map((bp: any) => (
                    <tr key={bp.id} className={cn("border-b border-border/30", bp.throttle_active && "bg-destructive/5")}>
                      <td className="py-1.5 px-2 text-muted-foreground">{new Date(bp.snapshot_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="py-1.5 px-2 text-right font-medium text-foreground">{bp.pending_count}</td>
                      <td className="py-1.5 px-2 text-right text-foreground">{bp.processing_count}</td>
                      <td className="py-1.5 px-2 text-right text-emerald-600">{bp.completed_1h}</td>
                      <td className="py-1.5 px-2 text-right text-destructive">{bp.failed_1h}</td>
                      <td className="py-1.5 px-2 text-right text-foreground">{bp.throughput_per_min?.toFixed(1)}</td>
                      <td className="py-1.5 px-2 text-right text-foreground">{bp.eta_clear_minutes?.toFixed(0)}m</td>
                      <td className="py-1.5 px-2 text-center">{bp.forecast_trend === 'rising' ? '📈' : bp.forecast_trend === 'falling' ? '📉' : '→'}</td>
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
