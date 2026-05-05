import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, Grid3X3, TrendingUp, Target, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function CostTab() {
  const [costs, setCosts] = useState<any[]>([]);
  const [heatmap, setHeatmap] = useState<any[]>([]);
  const [unitEcon, setUnitEcon] = useState<any[]>([]);
  const [costPerQ, setCostPerQ] = useState<any[]>([]);
  const [escalation, setEscalation] = useState<any[]>([]);
  const [revenueRatio, setRevenueRatio] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabase as any;
      const [costRes, heatRes, unitRes, cpqRes, escRes, rcrRes] = await Promise.all([
        sb.from('cost_intelligence').select('*').limit(30),
        sb.from('cost_quality_heatmap').select('*').limit(30),
        sb.from('v_unit_economics_package').select('*').order('net_profit_30d', { ascending: false }).limit(20),
        sb.from('v_cost_per_question').select('*').order('cost_per_question', { ascending: true }).limit(20),
        sb.from('v_escalation_rate').select('*').limit(14),
        sb.from('v_revenue_cost_ratio').select('*').limit(20),
      ]);
      setCosts(costRes.data || []);
      setHeatmap(heatRes.data || []);
      setUnitEcon(unitRes.data || []);
      setCostPerQ(cpqRes.data || []);
      setEscalation(escRes.data || []);
      setRevenueRatio(rcrRes.data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />)}</div>;

  const totalCost = costs.reduce((s: number, c: any) => s + (c.total_cost_eur || 0), 0);
  const totalCalls = costs.reduce((s: number, c: any) => s + (c.call_count || 0), 0);
  const avgCpq = costPerQ.length > 0 ? costPerQ.reduce((s: number, c: any) => s + (c.cost_per_question || 0), 0) / costPerQ.length : 0;
  const latestEsc = escalation.length > 0 ? escalation[0] : null;

  const quadrantColors: Record<string, string> = {
    optimal: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    premium: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
    bulk_acceptable: 'bg-muted text-muted-foreground border-border',
    expensive_low_quality: 'bg-destructive-bg-subtle text-destructive border-destructive/30',
  };
  const quadrantLabels: Record<string, string> = {
    optimal: '✅ Optimal', premium: '💎 Premium',
    bulk_acceptable: '📦 Bulk OK', expensive_low_quality: '🔥 Teuer & schlecht',
  };

  return (
    <div className="space-y-4">
      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">LLM Kosten (30d)</p><p className="text-xl font-bold">€{totalCost.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">API Calls</p><p className="text-xl font-bold">{totalCalls.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Ø €/Call</p><p className="text-xl font-bold">€{totalCalls > 0 ? (totalCost / totalCalls).toFixed(4) : '0'}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Ø €/Frage</p><p className={cn("text-xl font-bold", avgCpq <= 0.1 ? 'text-emerald-600' : avgCpq <= 0.2 ? 'text-amber-600' : 'text-destructive')}>€{avgCpq.toFixed(3)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Eskalationsrate</p><p className={cn("text-xl font-bold", (latestEsc?.escalation_pct || 0) <= 12 ? 'text-emerald-600' : 'text-amber-600')}>{latestEsc?.escalation_pct || 0}%</p></CardContent></Card>
      </div>

      {/* Unit Economics per Package */}
      {unitEcon.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Unit Economics pro Package</CardTitle>
            <CardDescription>Revenue − Refunds − LLM = Netto-Profit (30d)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-2">Zertifizierung</th>
                  <th className="text-right py-2 px-2">Revenue</th>
                  <th className="text-right py-2 px-2">LLM Cost</th>
                  <th className="text-right py-2 px-2">Netto</th>
                  <th className="text-right py-2 px-2">€/Frage</th>
                  <th className="text-right py-2 px-2">Fragen</th>
                  <th className="text-right py-2 px-2">Quality</th>
                  <th className="text-right py-2 px-2">ROI</th>
                </tr></thead>
                <tbody>
                  {unitEcon.map((u: any, i: number) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1.5 px-2 font-medium max-w-[180px] truncate">{u.certification_name || u.package_id?.slice(0, 8)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">€{(u.revenue_30d || 0).toFixed(0)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">€{(u.llm_cost_30d || 0).toFixed(2)}</td>
                      <td className={cn("py-1.5 px-2 text-right font-bold", (u.net_profit_30d || 0) >= 0 ? 'text-emerald-600' : 'text-destructive')}>€{(u.net_profit_30d || 0).toFixed(0)}</td>
                      <td className={cn("py-1.5 px-2 text-right font-mono", (u.cost_per_question || 0) <= 0.1 ? 'text-emerald-600' : (u.cost_per_question || 0) <= 0.2 ? 'text-amber-600' : 'text-destructive')}>
                        {u.cost_per_question != null ? `€${u.cost_per_question.toFixed(3)}` : '–'}
                      </td>
                      <td className="py-1.5 px-2 text-right">{u.question_count || 0}</td>
                      <td className="py-1.5 px-2 text-right">
                        {u.avg_quality_score != null ? (
                          <Badge variant={u.avg_quality_score >= 80 ? 'default' : u.avg_quality_score >= 65 ? 'secondary' : 'destructive'} className="text-[10px]">{u.avg_quality_score.toFixed(0)}</Badge>
                        ) : '–'}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono">{u.roi_ratio != null ? `${u.roi_ratio.toFixed(1)}x` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue/Cost Ratio */}
      {revenueRatio.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Revenue/Cost Ratio</CardTitle>
            <CardDescription>Ziel: 5x = gesund, 10x = stark, 20x = Skalierungsphase</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {revenueRatio.map((r: any, i: number) => {
                const ratio = r.revenue_cost_ratio || 0;
                return (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-48 truncate font-medium text-xs">{r.certification_name}</span>
                    <Badge variant={ratio >= 10 ? 'default' : ratio >= 5 ? 'secondary' : 'destructive'} className="text-[10px] w-16 justify-center">{ratio > 0 ? `${ratio}x` : '–'}</Badge>
                    <span className="text-xs text-muted-foreground">Rev: €{(r.revenue_total || 0).toFixed(0)} / Cost: €{(r.llm_cost_total || 0).toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Escalation Trend */}
      {escalation.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-primary" /> Eskalationsrate (14 Tage)</CardTitle>
            <CardDescription>Ziel: 5–12%. Höher = Modell/Prompt prüfen</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {escalation.map((e: any, i: number) => (
                <div key={i} className="text-center px-3 py-2 rounded bg-muted/30">
                  <p className="text-[10px] text-muted-foreground">{new Date(e.day).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</p>
                  <p className={cn("text-sm font-bold", (e.escalation_pct || 0) <= 12 ? 'text-emerald-600' : (e.escalation_pct || 0) <= 20 ? 'text-amber-600' : 'text-destructive')}>{e.escalation_pct}%</p>
                  <p className="text-[9px] text-muted-foreground">{e.escalated_calls}/{e.total_calls}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cost vs Quality Heatmap */}
      {heatmap.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Grid3X3 className="h-4 w-4 text-primary" /> Cost vs Quality Heatmap</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {heatmap.map((h: any, i: number) => (
                <div key={i} className="flex items-center gap-3 text-sm border-b border-border/30 pb-2">
                  <Badge variant="outline" className={cn("text-[10px] w-32 justify-center", quadrantColors[h.quadrant] || '')}>
                    {quadrantLabels[h.quadrant] || h.quadrant}
                  </Badge>
                  <span className="font-medium text-xs w-32 truncate">{h.job_type}</span>
                  <span className="font-mono text-xs text-muted-foreground w-28 truncate">{h.model || '—'}</span>
                  <span className="text-xs">{h.call_count}×</span>
                  <span className="text-xs font-mono">€{(h.total_cost_eur || 0).toFixed(2)}</span>
                  <span className={cn("text-xs font-bold", (h.avg_quality_score || 0) >= 80 ? 'text-emerald-600' : (h.avg_quality_score || 0) >= 65 ? 'text-amber-600' : 'text-destructive')}>Q:{(h.avg_quality_score || 0).toFixed(0)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cost Intelligence Detail */}
      {costs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" /> Cost Intelligence Detail</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-2">Job-Typ</th><th className="text-left py-2 px-2">Modell</th>
                  <th className="text-right py-2 px-2">Calls</th><th className="text-right py-2 px-2">Kosten €</th>
                  <th className="text-right py-2 px-2">Ø €/Call</th><th className="text-right py-2 px-2">Tokens</th>
                </tr></thead>
                <tbody>
                  {costs.slice(0, 20).map((c: any, i: number) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1.5 px-2 font-medium">{c.job_type}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{c.model || '—'}</td>
                      <td className="py-1.5 px-2 text-right">{c.call_count}</td>
                      <td className="py-1.5 px-2 text-right font-mono">€{(c.total_cost_eur || 0).toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground">€{(c.avg_cost_eur || 0).toFixed(4)}</td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground">{(c.total_tokens || 0).toLocaleString()}</td>
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
