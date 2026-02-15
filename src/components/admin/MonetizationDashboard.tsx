import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  Loader2, TrendingUp, Target, DollarSign, Users,
  ArrowUpRight, ArrowDownRight, BarChart3, Zap
} from 'lucide-react';

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const recLabels: Record<string, { label: string; color: string; icon: string }> = {
  PRICE_INCREASE: { label: 'Preis erhöhen', color: 'text-destructive', icon: '⬆️' },
  OPTIMIZE_COST: { label: 'Kosten optimieren', color: 'text-amber-600', icon: '⚙️' },
  KEEP: { label: 'Beibehalten', color: 'text-emerald-600', icon: '✅' },
  UPSCALE_MARKETING: { label: 'Marketing pushen', color: 'text-primary', icon: '🚀' },
  NO_DATA: { label: 'Keine Daten', color: 'text-muted-foreground', icon: '—' },
};

const costLabels: Record<string, { label: string; color: string }> = {
  OPTIMAL: { label: 'Optimal', color: 'text-emerald-600' },
  OK: { label: 'OK', color: 'text-muted-foreground' },
  MODEL_REVIEW: { label: 'Modell prüfen', color: 'text-amber-600' },
  ESCALATION_CHECK: { label: 'Eskalation prüfen', color: 'text-destructive' },
};

export default function MonetizationDashboard() {
  const [priceRec, setPriceRec] = useState<any[]>([]);
  const [forecast, setForecast] = useState<any[]>([]);
  const [ltv, setLtv] = useState<any[]>([]);
  const [b2b, setB2b] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabase as any;
      const [prRes, fcRes, ltvRes, b2bRes] = await Promise.all([
        sb.from('v_price_recommendation').select('*').limit(30),
        sb.from('v_profit_forecast').select('*').order('net_profit_30d', { ascending: false }).limit(20),
        sb.from('v_ltv_user').select('*').order('net_ltv', { ascending: false }).limit(20),
        sb.from('v_b2b_metrics').select('*').order('total_spend', { ascending: false }).limit(20),
      ]);
      setPriceRec(prRes.data || []);
      setForecast(fcRes.data || []);
      setLtv(ltvRes.data || []);
      setB2b(b2bRes.data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loading />;

  // Aggregate KPIs
  const totalRevenue = forecast.reduce((s, f) => s + (f.revenue_30d || 0), 0);
  const totalCost = forecast.reduce((s, f) => s + (f.llm_cost_30d || 0), 0);
  const totalProfit = forecast.reduce((s, f) => s + (f.net_profit_30d || 0), 0);
  const avgMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0;
  const totalLTV = ltv.reduce((s, l) => s + (l.net_ltv || 0), 0);
  const avgLTV = ltv.length > 0 ? totalLTV / ltv.length : 0;
  const b2bCount = b2b.filter(b => b.customer_segment !== 'individual').length;

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Revenue (30d)</p>
            <p className="text-2xl font-bold text-foreground">€{totalRevenue.toFixed(0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">LLM Cost (30d)</p>
            <p className="text-2xl font-bold text-foreground">€{totalCost.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Netto-Profit</p>
            <p className={cn("text-2xl font-bold", totalProfit >= 0 ? "text-emerald-600" : "text-destructive")}>€{totalProfit.toFixed(0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Marge</p>
            <p className={cn("text-2xl font-bold", avgMargin >= 80 ? "text-emerald-600" : avgMargin >= 50 ? "text-amber-600" : "text-destructive")}>{avgMargin.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ø LTV/User</p>
            <p className="text-2xl font-bold text-foreground">€{avgLTV.toFixed(0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">B2B Kunden</p>
            <p className="text-2xl font-bold text-primary">{b2bCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Price Recommendations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Preisempfehlungen</CardTitle>
          <CardDescription>Automatische Handlungsempfehlung basierend auf ROI, Kosten & Qualität</CardDescription>
        </CardHeader>
        <CardContent>
          {priceRec.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Keine Daten vorhanden</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Zertifizierung</th>
                    <th className="text-right py-2 px-2">Revenue</th>
                    <th className="text-right py-2 px-2">Cost</th>
                    <th className="text-right py-2 px-2">ROI</th>
                    <th className="text-center py-2 px-2">Preis-Empfehlung</th>
                    <th className="text-center py-2 px-2">Kosten-Aktion</th>
                    <th className="text-center py-2 px-2">Qualität</th>
                  </tr>
                </thead>
                <tbody>
                  {priceRec.map((r, i) => {
                    const rec = recLabels[r.recommendation] || recLabels.NO_DATA;
                    const cost = costLabels[r.cost_action] || costLabels.OK;
                    return (
                      <tr key={i} className="border-b border-border/30">
                        <td className="py-2 px-2 font-medium max-w-[180px] truncate">{r.certification_name || r.package_id?.slice(0, 8)}</td>
                        <td className="py-2 px-2 text-right font-mono">€{(r.revenue_30d || 0).toFixed(0)}</td>
                        <td className="py-2 px-2 text-right font-mono">€{(r.llm_cost_30d || 0).toFixed(2)}</td>
                        <td className="py-2 px-2 text-right font-mono">{r.roi_ratio ? `${r.roi_ratio.toFixed(1)}x` : '–'}</td>
                        <td className="py-2 px-2 text-center">
                          <Badge variant="outline" className={cn("text-[10px]", rec.color)}>{rec.icon} {rec.label}</Badge>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className={cn("text-[10px] font-medium", cost.color)}>{cost.label}</span>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <Badge variant={r.quality_status === 'QUALITY_EXCELLENT' ? 'default' : r.quality_status === 'QUALITY_ALERT' ? 'destructive' : 'secondary'} className="text-[10px]">
                            {r.avg_quality_score ? r.avg_quality_score.toFixed(0) : '–'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Profit Forecast */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Gewinn-Forecast</CardTitle>
          <CardDescription>Projektion bei 2x/5x/10x Sales-Multiplikator</CardDescription>
        </CardHeader>
        <CardContent>
          {forecast.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Keine Daten</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Zertifizierung</th>
                    <th className="text-right py-2 px-2">Aktuell</th>
                    <th className="text-right py-2 px-2">@2x</th>
                    <th className="text-right py-2 px-2">@5x</th>
                    <th className="text-right py-2 px-2">@10x</th>
                    <th className="text-right py-2 px-2">Break-Even</th>
                    <th className="text-right py-2 px-2">Marge %</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((f, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-2 px-2 font-medium max-w-[180px] truncate">{f.certification_name || f.package_id?.slice(0, 8)}</td>
                      <td className={cn("py-2 px-2 text-right font-mono font-bold", (f.forecast_current || 0) >= 0 ? 'text-emerald-600' : 'text-destructive')}>€{(f.forecast_current || 0).toFixed(0)}</td>
                      <td className="py-2 px-2 text-right font-mono">€{(f.forecast_2x || 0).toFixed(0)}</td>
                      <td className="py-2 px-2 text-right font-mono">€{(f.forecast_5x || 0).toFixed(0)}</td>
                      <td className="py-2 px-2 text-right font-mono text-primary font-bold">€{(f.forecast_10x || 0).toFixed(0)}</td>
                      <td className="py-2 px-2 text-right">
                        {f.break_even_units ? <Badge variant="outline" className="text-[10px]">{f.break_even_units} Units</Badge> : '–'}
                      </td>
                      <td className={cn("py-2 px-2 text-right font-bold", (f.contribution_margin_pct || 0) >= 80 ? 'text-emerald-600' : (f.contribution_margin_pct || 0) >= 50 ? 'text-amber-600' : 'text-destructive')}>
                        {f.contribution_margin_pct != null ? `${f.contribution_margin_pct}%` : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Forecast Goal Simulator */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Ziel-Simulator</CardTitle>
          <CardDescription>Wie viele Sales brauchst du für dein Monatsziel?</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { goal: 10000, label: '10k/Monat' },
              { goal: 50000, label: '50k/Monat' },
              { goal: 100000, label: '100k/Monat' },
            ].map(({ goal, label }) => {
              const avgPrice = 59; // B2C avg
              const b2bAvg = 1690; // B2B avg
              const b2cNeeded = Math.ceil(goal * 0.6 / avgPrice);
              const b2bNeeded = Math.ceil(goal * 0.4 / b2bAvg);
              const pctReached = totalProfit > 0 ? Math.min(100, (totalProfit / goal) * 100) : 0;
              return (
                <div key={goal} className="p-4 rounded-lg bg-muted/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-foreground">{label}</p>
                    <Badge variant={pctReached >= 100 ? 'default' : 'secondary'} className="text-[10px]">{pctReached.toFixed(0)}% erreicht</Badge>
                  </div>
                  <Progress value={pctReached} className="h-2" />
                  <div className="text-xs space-y-1 text-muted-foreground">
                    <p>📱 B2C: ~{b2cNeeded} Sales/Monat à Ø €{avgPrice}</p>
                    <p>🏢 B2B: ~{b2bNeeded} Kunden/Monat à Ø €{b2bAvg}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* B2B Customer Segments */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> B2B Kundensegmente</CardTitle>
          <CardDescription>Klassifizierung nach Kaufverhalten</CardDescription>
        </CardHeader>
        <CardContent>
          {b2b.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Noch keine Kunden-Daten</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Käufer</th>
                    <th className="text-center py-2 px-2">Segment</th>
                    <th className="text-right py-2 px-2">Ausgaben</th>
                    <th className="text-right py-2 px-2">Orders</th>
                    <th className="text-right py-2 px-2">Ø Warenkorb</th>
                    <th className="text-right py-2 px-2">Zertif.</th>
                    <th className="text-right py-2 px-2">Letzter Kauf</th>
                  </tr>
                </thead>
                <tbody>
                  {b2b.map((b, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-2 px-2 font-mono text-[10px] max-w-[120px] truncate">{b.buyer_id?.slice(0, 8)}…</td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant={b.customer_segment === 'enterprise' ? 'default' : b.customer_segment === 'business' ? 'secondary' : 'outline'} className="text-[10px]">
                          {b.customer_segment === 'enterprise' ? '🏢 Enterprise' : b.customer_segment === 'business' ? '💼 Business' : '👤 Einzeln'}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-right font-mono font-bold">€{(b.total_spend || 0).toFixed(0)}</td>
                      <td className="py-2 px-2 text-right">{b.total_orders}</td>
                      <td className="py-2 px-2 text-right font-mono">€{(b.avg_order_value || 0).toFixed(0)}</td>
                      <td className="py-2 px-2 text-right">{b.certifications_bought}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground font-mono text-[10px]">
                        {b.last_purchase ? new Date(b.last_purchase).toLocaleDateString('de-DE') : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* LTV Leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" /> LTV Top-Kunden</CardTitle>
          <CardDescription>Lifetime Value nach Netto-Umsatz</CardDescription>
        </CardHeader>
        <CardContent>
          {ltv.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Keine LTV-Daten</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">User</th>
                    <th className="text-right py-2 px-2">Net LTV</th>
                    <th className="text-right py-2 px-2">Purchases</th>
                    <th className="text-right py-2 px-2">Renewals</th>
                    <th className="text-right py-2 px-2">Upsells</th>
                    <th className="text-right py-2 px-2">Refunds</th>
                    <th className="text-right py-2 px-2">Zertif.</th>
                  </tr>
                </thead>
                <tbody>
                  {ltv.slice(0, 15).map((l, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-2 px-2 font-mono text-[10px] max-w-[120px] truncate">{l.user_id?.slice(0, 8)}…</td>
                      <td className={cn("py-2 px-2 text-right font-mono font-bold", (l.net_ltv || 0) >= 100 ? 'text-emerald-600' : 'text-foreground')}>€{(l.net_ltv || 0).toFixed(0)}</td>
                      <td className="py-2 px-2 text-right">{l.purchases}</td>
                      <td className="py-2 px-2 text-right">{l.renewals}</td>
                      <td className="py-2 px-2 text-right">{l.upsells}</td>
                      <td className={cn("py-2 px-2 text-right", (l.total_refunds || 0) < 0 && 'text-destructive')}>€{Math.abs(l.total_refunds || 0).toFixed(0)}</td>
                      <td className="py-2 px-2 text-right">{l.unique_certifications}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
