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
const RevenueCommandCenter = lazy(() => import('@/components/admin/command/RevenueCommandCenter'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { path: '/admin/business', label: 'Revenue SSOT' },
  { path: '/admin/business/costs', label: 'LLM-Kosten' },
  { path: '/admin/business/unit-economics', label: 'Unit Economics' },
  { path: '/admin/business/b2b', label: 'B2B Reporting' },
  { path: '/admin/business/monetization', label: 'Monetarisierung' },
  { path: '/admin/business/revenue', label: 'Umsatz-Detail' },
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

  // Cost-per-course calculation
  const COURSE_COST_ESTIMATE = 13.75; // EUR, based on optimized routing
  const COURSE_COST_OLD = 55; // EUR, with uniform model routing

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

      {/* Cost per Course */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="border-primary/30">
          <CardContent className="py-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">💡 Kosten pro Kurs (optimiert)</p>
            <p className="text-3xl font-bold text-primary">≈ €{COURSE_COST_ESTIMATE}</p>
            <p className="text-xs text-muted-foreground mt-1">14 LF, ~80 Kompetenzen, ~1.600 Fragen, ~400 Lektionen</p>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="text-[10px] border-success/50 text-success">-75% vs. alt</Badge>
              <span className="text-[10px] text-muted-foreground line-through">€{COURSE_COST_OLD} (altes Routing)</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">📊 Kurse im Budget</p>
            <p className="text-3xl font-bold text-foreground">{Math.floor((monthBudget - costMtd) / COURSE_COST_ESTIMATE)}</p>
            <p className="text-xs text-muted-foreground mt-1">noch generierbar bei €{COURSE_COST_ESTIMATE}/Kurs</p>
            <p className="text-[10px] text-muted-foreground mt-2">Restbudget: €{(monthBudget - costMtd).toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Model Performance + Pricing Matrix */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            ⚡ Modell-Matrix: Preis × Latenz × Durchsatz (März 2026)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1.5 px-2">Modell</th>
                  <th className="text-right py-1.5 px-2">€ In/1M</th>
                  <th className="text-right py-1.5 px-2">€ Out/1M</th>
                  <th className="text-right py-1.5 px-2">Latenz</th>
                  <th className="text-right py-1.5 px-2">Tok/s</th>
                  <th className="text-right py-1.5 px-2">RPM</th>
                  <th className="text-left py-1.5 px-2">Pipeline-Rolle</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { model: 'GPT-4.1 nano', input: 0.09, output: 0.37, latency: '0.3-0.6s', tps: '150-250', rpm: '10-20k', role: 'Routing, QC, Glossar, Minichecks', tier: 'green' as const },
                  { model: 'GPT-5 nano', input: 0.09, output: 0.37, latency: '0.3-0.6s', tps: '150-250', rpm: '10-20k', role: 'Fallback für Nano-Tier', tier: 'green' as const },
                  { model: 'GPT-4o-mini', input: 0.14, output: 0.55, latency: '0.5-1.0s', tps: '130-200', rpm: '3-10k', role: 'AI Tutor (Learning), Legacy', tier: 'green' as const },
                  { model: 'GPT-4.1 mini', input: 0.37, output: 1.47, latency: '0.5-1.2s', tps: '120-200', rpm: '3-10k', role: '✅ Content-Gen, Handbook, AutoFix', tier: 'green' as const },
                  { model: 'GPT-5 mini', input: 0.23, output: 1.84, latency: '0.8-1.5s', tps: '100-150', rpm: '3-10k', role: '✅ Exam-Pool, Council, Validation', tier: 'green' as const },
                  { model: 'GPT-4.1', input: 1.84, output: 7.36, latency: '1-2s', tps: '80-130', rpm: '1-5k', role: 'Legacy → Migration empfohlen', tier: 'yellow' as const },
                  { model: 'GPT-5', input: 2.30, output: 9.20, latency: '1.5-2.5s', tps: '70-110', rpm: '1-5k', role: 'QA Gate Fallback', tier: 'yellow' as const },
                  { model: 'GPT-5.2', input: 2.76, output: 11.04, latency: '2-3s', tps: '50-90', rpm: '1-3k', role: 'Elite Harden Fallback', tier: 'red' as const },
                  { model: 'GPT-5.4', input: 2.30, output: 13.80, latency: '2-4s', tps: '40-80', rpm: '500-2k', role: '🏆 Elite Harden (nur ~2%)', tier: 'red' as const },
                  { model: 'o4-mini', input: 3.68, output: 14.72, latency: '1.5-3s', tps: '60-100', rpm: '500-2k', role: '⚠️ Reasoning – extrem teuer', tier: 'red' as const },
                  { model: 'Claude Haiku 4.5', input: 0.80, output: 4.00, latency: '0.5-1.2s', tps: '100-180', rpm: '2-8k', role: 'Council Fallback (Provider-Mix)', tier: 'yellow' as const },
                  { model: 'Gemini 2.5 Flash', input: 0.07, output: 0.28, latency: '0.3-0.8s', tps: '120-200', rpm: '5-15k', role: '✅ Günstigster via Lovable AI', tier: 'green' as const },
                ].map(r => (
                  <tr key={r.model} className="border-b border-border/20">
                    <td className="py-1.5 px-2 font-medium whitespace-nowrap">{r.model}</td>
                    <td className="py-1.5 px-2 text-right font-mono">€{r.input.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">€{r.output.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{r.latency}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{r.tps}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{r.rpm}</td>
                    <td className={cn("py-1.5 px-2 text-xs",
                      r.tier === 'green' && 'text-success',
                      r.tier === 'yellow' && 'text-warning',
                      r.tier === 'red' && 'text-destructive',
                    )}>{r.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">
            Quelle: OpenAI Pricing + Benchmarks, März 2026. EUR ≈ 0.92×USD. Latenz = Time-to-First-Token. RPM = Tier 3-4.
          </p>
        </CardContent>
      </Card>

      {/* Pipeline Routing Matrix */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            🔀 ExamFit Routing-Matrix: Kosten pro Kurs ≈ €{COURSE_COST_ESTIMATE}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1.5 px-2">Pipeline-Step</th>
                  <th className="text-right py-1.5 px-2">Calls</th>
                  <th className="text-left py-1.5 px-2">Primary</th>
                  <th className="text-left py-1.5 px-2">Fallback</th>
                  <th className="text-right py-1.5 px-2">€/Call</th>
                  <th className="text-right py-1.5 px-2">Gesamt</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { step: 'Scaffold', calls: 1, primary: '4.1 nano', fallback: '5 nano', costCall: 0.0003, total: 0.00 },
                  { step: 'Glossar', calls: 14, primary: '4.1 nano', fallback: '5 nano', costCall: 0.0004, total: 0.01 },
                  { step: 'Learning Content', calls: 400, primary: '4.1 mini', fallback: '5 mini', costCall: 0.0107, total: 4.28 },
                  { step: 'Validate Content', calls: 400, primary: '5 mini', fallback: '4.1 mini', costCall: 0.0028, total: 1.10 },
                  { step: 'Exam-Pool', calls: 160, primary: '5 mini', fallback: '4.1 mini', costCall: 0.0202, total: 3.24 },
                  { step: 'Handbook', calls: 14, primary: '4.1 mini', fallback: '4o-mini', costCall: 0.0133, total: 0.19 },
                  { step: 'Minichecks', calls: 400, primary: '4.1 nano', fallback: '5 nano', costCall: 0.0003, total: 0.11 },
                  { step: 'Elite Harden', calls: 100, primary: '5.4', fallback: '5.2', costCall: 0.0414, total: 4.14 },
                  { step: 'Council (P+C)', calls: 100, primary: '5 mini', fallback: 'Haiku 4.5', costCall: 0.0056, total: 0.56 },
                  { step: 'Auto-Fix', calls: 20, primary: '4.1 mini', fallback: '5 mini', costCall: 0.0059, total: 0.12 },
                ].map(r => (
                  <tr key={r.step} className="border-b border-border/20">
                    <td className="py-1.5 px-2 font-medium">{r.step}</td>
                    <td className="py-1.5 px-2 text-right">{r.calls}</td>
                    <td className="py-1.5 px-2 text-success">{r.primary}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{r.fallback}</td>
                    <td className="py-1.5 px-2 text-right font-mono">€{r.costCall.toFixed(4)}</td>
                    <td className="py-1.5 px-2 text-right font-mono font-medium">€{r.total.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-bold">
                  <td className="py-2 px-2">GESAMT</td>
                  <td className="py-2 px-2 text-right">1.609</td>
                  <td colSpan={2} className="py-2 px-2 text-xs text-muted-foreground">90% Calls unter 1.5s TTFT</td>
                  <td className="py-2 px-2"></td>
                  <td className="py-2 px-2 text-right text-primary">≈ €{COURSE_COST_ESTIMATE}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-3 p-3 rounded-lg bg-muted/30 text-xs space-y-1">
            <p className="font-medium">📐 Architektur-Prinzip: nano → routing | mini → generation | balanced → exam | premium → validation</p>
            <p className="text-muted-foreground">• <strong>80-90%</strong> Kostenersparnis vs. Einheitsmodell • <strong>10×</strong> mehr Durchsatz • <strong>Keine</strong> Rate-Limit-Bottlenecks</p>
            <p className="text-muted-foreground">• Elite Harden (GPT-5.4) nur für &lt;2% der Calls aber höchste Qualität für Prüfungsinhalte</p>
          </div>
        </CardContent>
      </Card>

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
          <Route index element={<RevenueCommandCenter />} />
          <Route path="costs" element={<LLMCostDashboard />} />
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
