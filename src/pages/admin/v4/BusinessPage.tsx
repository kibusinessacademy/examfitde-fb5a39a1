import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  DollarSign, TrendingUp, TrendingDown, Loader2, RefreshCw,
  AlertTriangle, BarChart3, PieChart
} from 'lucide-react';
import PageExplainer from '@/components/admin/PageExplainer';
import { Routes, Route, Link, useLocation } from 'react-router-dom';

const FinanceDashboard = lazy(() => import('@/pages/admin/FinanceDashboard'));
const EnterpriseSeatManagement = lazy(() => import('@/pages/admin/EnterpriseSeatManagement'));
const AuditExportsPage = lazy(() => import('@/pages/admin/AuditExportsPage'));
const UnitEconomicsDashboard = lazy(() => import('@/components/admin/UnitEconomicsDashboard'));
const MonetizationDashboard = lazy(() => import('@/components/admin/MonetizationDashboard'));
const B2BReportingDashboard = lazy(() => import('@/components/admin/B2BReportingDashboard'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { path: '/admin/business', label: 'LLM-Kosten' },
  { path: '/admin/business/unit-economics', label: 'Unit Economics' },
  { path: '/admin/business/b2b', label: 'B2B Reporting' },
  { path: '/admin/business/monetization', label: 'Monetarisierung' },
  { path: '/admin/business/revenue', label: 'Umsatz' },
  { path: '/admin/business/licenses', label: 'Lizenzen' },
  { path: '/admin/business/exports', label: 'Steuer-Export' },
];

function LLMCostDashboard() {
  const [kpis, setKpis] = useState<any>(null);
  const [rollups, setRollups] = useState<any[]>([]);
  const [costToday, setCostToday] = useState(0);
  const [costMtd, setCostMtd] = useState(0);
  const [cost7d, setCost7d] = useState(0);
  const [budgetRow, setBudgetRow] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const sb = supabase as any;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 86400_000);

    const [kpiRes, rollupRes, todayCostRes, mtdCostRes, weekCostRes, budgetRes] = await Promise.all([
      sb.rpc('get_production_kpis').catch(() => ({ data: null })),
      sb.from('kpi_daily_rollup').select('*').order('day', { ascending: false }).limit(14),
      sb.from('llm_cost_events').select('cost_eur').gte('ts', todayStart.toISOString()),
      sb.from('llm_cost_events').select('cost_eur').gte('ts', monthStart.toISOString()),
      sb.from('llm_cost_events').select('cost_eur').gte('ts', weekAgo.toISOString()),
      sb.from('ai_cost_budgets').select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1),
    ]);
    setKpis(kpiRes.data);
    setRollups(rollupRes.data || []);
    const todayCosts = (todayCostRes.data || []) as { cost_eur: number }[];
    setCostToday(todayCosts.reduce((s, c) => s + (c.cost_eur || 0), 0));
    const mtdCosts = (mtdCostRes.data || []) as { cost_eur: number }[];
    setCostMtd(mtdCosts.reduce((s, c) => s + (c.cost_eur || 0), 0));
    const weekCosts = (weekCostRes.data || []) as { cost_eur: number }[];
    setCost7d(weekCosts.reduce((s, c) => s + (c.cost_eur || 0), 0));
    setBudgetRow((budgetRes.data || [])[0]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  const monthBudget = budgetRow?.budget_eur ?? 200;
  const budgetPct = monthBudget > 0 ? Math.round((costMtd / monthBudget) * 100) : 0;
  const burnPerDay = cost7d / 7;
  const daysLeft = monthBudget > 0 ? Math.round((monthBudget - costMtd) / Math.max(burnPerDay, 0.01)) : 999;

  return (
    <div className="space-y-6">
      {/* Budget overview */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Budget MTD</p>
            <p className="text-2xl font-bold text-foreground">€{costMtd.toFixed(2)} <span className="text-sm text-muted-foreground">/ €{monthBudget}</span></p>
            <Progress value={budgetPct} className={cn("h-2 mt-2", budgetPct > 80 && "[&>div]:bg-destructive")} />
            <p className="text-[10px] text-muted-foreground mt-1">{budgetPct}% verbraucht</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Heute</p>
            <p className="text-2xl font-bold text-foreground">€{costToday.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ø Burn/Tag (7d)</p>
            <p className="text-2xl font-bold text-foreground">€{burnPerDay.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className={cn(daysLeft < 7 && "border-destructive/50")}>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Forecast Rest</p>
            <p className={cn("text-2xl font-bold", daysLeft < 7 ? "text-destructive" : "text-foreground")}>{daysLeft} Tage</p>
          </CardContent>
        </Card>
      </div>

      {/* Provider costs (from rate_limits) */}
      {kpis?.rate_limits?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <PieChart className="h-4 w-4" /> Provider Auslastung
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {kpis.rate_limits.map((rl: any) => {
                const running = kpis.provider_load?.find((p: any) => p.provider === rl.provider)?.running ?? 0;
                return (
                  <div key={rl.provider} className="text-center p-3 rounded-lg bg-muted/30">
                    <p className="text-xs font-medium uppercase">{rl.provider}</p>
                    <p className="text-lg font-bold">{running}/{rl.max_concurrent}</p>
                    <p className="text-[10px] text-muted-foreground">Cooldown: {rl.cooldown_seconds}s</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Daily history */}
      {rollups.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Letzte 14 Tage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Tag</th>
                    <th className="text-right py-2 px-2">Kosten</th>
                    <th className="text-right py-2 px-2">OpenAI</th>
                    <th className="text-right py-2 px-2">Anthro.</th>
                    <th className="text-right py-2 px-2">Jobs ✅</th>
                    <th className="text-right py-2 px-2">Jobs ❌</th>
                    <th className="text-right py-2 px-2">Packages</th>
                    <th className="text-right py-2 px-2">Backlog</th>
                    <th className="text-right py-2 px-2">Top Error</th>
                  </tr>
                </thead>
                <tbody>
                  {rollups.map(r => (
                    <tr key={r.day} className="border-b border-border/30">
                      <td className="py-2 px-2 font-mono">{r.day}</td>
                      <td className="py-2 px-2 text-right font-medium">€{Number(r.cost_total_eur).toFixed(2)}</td>
                      <td className="py-2 px-2 text-right">€{Number(r.cost_openai_eur).toFixed(2)}</td>
                      <td className="py-2 px-2 text-right">€{Number(r.cost_anthropic_eur).toFixed(2)}</td>
                      <td className="py-2 px-2 text-right text-success">{r.jobs_completed}</td>
                      <td className={cn("py-2 px-2 text-right", r.jobs_failed > 0 && "text-destructive")}>{r.jobs_failed}</td>
                      <td className="py-2 px-2 text-right">{r.packages_completed}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{r.backlog_jobs}</td>
                      <td className="py-2 px-2 text-right text-destructive">{r.top_error_code || '–'}</td>
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

/* CSV export */
function SteuerExport() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('orders')
        .select('*').order('created_at', { ascending: false }).limit(500);
      setOrders(data || []);
      setLoading(false);
    })();
  }, []);

  const handleCSVExport = () => {
    const headers = ['Datum', 'OrderID', 'Produkt', 'Betrag', 'Netto', 'Steuer', 'Brutto', 'Land', 'Rechnungsempfänger'];
    const rows = orders.map(o => [
      new Date(o.created_at).toLocaleDateString('de-DE'), o.id,
      o.product_name || o.product_id || '–',
      `${((o.amount_cents || 0) / 100).toFixed(2).replace('.', ',')} €`,
      `${((o.net_cents || o.amount_cents || 0) / 100).toFixed(2).replace('.', ',')} €`,
      `${((o.tax_cents || 0) / 100).toFixed(2).replace('.', ',')} €`,
      `${((o.gross_cents || o.amount_cents || 0) / 100).toFixed(2).replace('.', ',')} €`,
      o.country || 'DE', o.customer_name || o.customer_email || '–',
    ]);
    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `steuer-export-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV-Export heruntergeladen');
  };

  if (loading) return <Loading />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Steuer-Export</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">UTF-8, Semikolon-getrennt, EUR-Format.</p>
        <Button onClick={handleCSVExport} size="sm">CSV exportieren ({orders.length})</Button>
      </CardContent>
    </Card>
  );
}

export default function BusinessPage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname === t.path)?.path ||
    tabs.find(t => location.pathname.startsWith(t.path) && t.path !== '/admin/business')?.path ||
    tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Finanzen & LLM-Budget</h1>
        <p className="text-sm text-muted-foreground">Kosten/Tag, Burn Rate, Provider, Forecast</p>
      </div>

      <PageExplainer
        title="Finanzen & Budget"
        description="LLM-Kosten pro Tag und Provider, Budget-Forecast, tägliche Rollups. Steuer-Export für DATEV."
        workflow={[
          { label: 'Leitstelle' },
          { label: 'Studio' },
          { label: 'Quality' },
          { label: 'Ops' },
          { label: 'Business', active: true },
        ]}
      />

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link key={tab.path} to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}>
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<LLMCostDashboard />} />
          <Route path="unit-economics" element={<UnitEconomicsDashboard />} />
          <Route path="b2b" element={<B2BReportingDashboard />} />
          <Route path="monetization" element={<MonetizationDashboard />} />
          <Route path="revenue" element={<FinanceDashboard />} />
          <Route path="licenses" element={<EnterpriseSeatManagement />} />
          <Route path="exports" element={<SteuerExport />} />
        </Routes>
      </Suspense>
    </div>
  );
}
