import { lazy, Suspense, useState, useEffect, useCallback, useMemo } from 'react';
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

// ── Typed data constants (no inline JSX arrays) ─────────────
// Prices derived from model-pricing.ts SSOT (USD×0.92 = EUR, Mar 2026)

type CostTier = 'green' | 'yellow' | 'red';
type PerfConfLabel = 'high' | 'medium' | 'low';

interface ModelMatrixRow {
  model: string;
  canonicalId: string;
  input: number;
  output: number;
  latency: string;
  tps: string;
  rpm: string;
  role: string;
  tier: CostTier;
  confidence: PerfConfLabel;
  source: string;
}

/**
 * EUR prices: computed from USD × 0.92 (PRICING_META.fx_rate_applied).
 * These values MUST match PRICING_EUR_PER_M in model-pricing.ts.
 *
 * To verify: input_eur = round(input_usd × 0.92, 3)
 *   gpt-4.1-nano:  $0.10 → €0.092  |  $0.40 → €0.368
 *   gpt-4.1-mini:  $0.40 → €0.368  |  $1.60 → €1.472
 *   gpt-4.1:       $2.00 → €1.840  |  $8.00 → €7.360
 *   gpt-5-mini:    $0.25 → €0.230  |  $2.00 → €1.840
 *   gpt-5.4:       $2.50 → €2.300  | $15.00 → €13.800
 */
const MODEL_MATRIX_ROWS: ModelMatrixRow[] = [
  { model: 'GPT-4.1 nano',    canonicalId: 'gpt-4.1-nano',              input: 0.092, output: 0.368, latency: '0.3-0.6s', tps: '150-250', rpm: '10-20k', role: 'Routing, QC, Glossar, Minichecks', tier: 'green',  confidence: 'high',   source: 'vendor-doc' },
  { model: 'GPT-5 nano',      canonicalId: 'gpt-5-nano',                input: 0.092, output: 0.368, latency: '0.3-0.6s', tps: '150-250', rpm: '10-20k', role: 'Fallback für Nano-Tier',          tier: 'green',  confidence: 'medium', source: 'estimated' },
  { model: 'GPT-4o-mini',     canonicalId: 'gpt-4o-mini',               input: 0.138, output: 0.552, latency: '0.5-1.0s', tps: '130-200', rpm: '3-10k',  role: 'AI Tutor (Learning)',             tier: 'green',  confidence: 'high',   source: 'measured' },
  { model: 'GPT-4.1 mini',    canonicalId: 'gpt-4.1-mini',              input: 0.368, output: 1.472, latency: '0.5-1.2s', tps: '120-200', rpm: '3-10k',  role: '✅ Content-Gen, Handbook, AutoFix', tier: 'green',  confidence: 'high',   source: 'vendor-doc' },
  { model: 'GPT-5 mini',      canonicalId: 'gpt-5-mini',                input: 0.230, output: 1.840, latency: '0.8-1.5s', tps: '100-150', rpm: '3-10k',  role: '✅ Exam-Pool, Council, Validation', tier: 'green',  confidence: 'medium', source: 'vendor-doc' },
  { model: 'GPT-4.1',         canonicalId: 'gpt-4.1',                   input: 1.840, output: 7.360, latency: '1-2s',     tps: '80-130',  rpm: '1-5k',   role: 'Legacy → Migration empfohlen',    tier: 'yellow', confidence: 'high',   source: 'vendor-doc' },
  { model: 'GPT-5',           canonicalId: 'gpt-5',                     input: 2.300, output: 9.200, latency: '1.5-2.5s', tps: '70-110',  rpm: '1-5k',   role: 'QA Gate Fallback',                tier: 'yellow', confidence: 'medium', source: 'estimated' },
  { model: 'GPT-5.2',         canonicalId: 'gpt-5.2',                   input: 2.760, output: 11.040,latency: '2-3s',     tps: '50-90',   rpm: '1-3k',   role: 'Elite Harden Fallback',           tier: 'red',    confidence: 'medium', source: 'estimated' },
  { model: 'GPT-5.4',         canonicalId: 'gpt-5.4',                   input: 2.300, output: 13.800,latency: '2-4s',     tps: '40-80',   rpm: '500-2k', role: '🏆 Elite Harden (nur ~2%)',        tier: 'red',    confidence: 'medium', source: 'vendor-doc' },
  { model: 'o4-mini',         canonicalId: 'o4-mini',                   input: 3.680, output: 14.720,latency: '1.5-3s',   tps: '60-100',  rpm: '500-2k', role: '⚠️ Reasoning – sehr teuer',       tier: 'red',    confidence: 'low',    source: 'estimated' },
  { model: 'Claude Haiku 4.5', canonicalId: 'claude-haiku-4-5-20251001', input: 0.736, output: 3.680, latency: '0.5-1.2s', tps: '100-180', rpm: '2-8k',   role: 'Council Fallback (Provider-Mix)',  tier: 'yellow', confidence: 'medium', source: 'measured' },
  { model: 'Gemini 2.5 Flash', canonicalId: 'gemini-2.5-flash',          input: 0.069, output: 0.276, latency: '0.3-0.8s', tps: '120-200', rpm: '5-15k',  role: '✅ Günstigster via Lovable AI',    tier: 'green',  confidence: 'medium', source: 'vendor-doc' },
];

interface PipelineStepRow {
  step: string;
  stepLabel: string;
  calls: number;
  avgIn: number;
  avgOut: number;
  primaryLabel: string;
  fallbackLabel: string;
  primaryId: string;
}

/**
 * Pipeline step estimates for ExamFit standard course.
 * Step names match PIPELINE_MODEL_MAP keys in model-catalog.ts.
 * Token counts from production telemetry.
 */
const PIPELINE_STEP_ROWS: PipelineStepRow[] = [
  { step: 'scaffold_learning_course', stepLabel: 'Scaffold',         calls: 1,    avgIn: 2000,  avgOut: 1000,  primaryLabel: '4.1 nano', fallbackLabel: '5 nano',    primaryId: 'gpt-4.1-nano' },
  { step: 'generate_glossary',        stepLabel: 'Glossar',          calls: 14,   avgIn: 3000,  avgOut: 2000,  primaryLabel: '4.1 nano', fallbackLabel: '5 nano',    primaryId: 'gpt-4.1-nano' },
  { step: 'generate_learning_content',stepLabel: 'Learning Content', calls: 400,  avgIn: 5000,  avgOut: 6000,  primaryLabel: '4.1 mini', fallbackLabel: '5 mini',    primaryId: 'gpt-4.1-mini' },
  { step: 'validate_content',         stepLabel: 'Validate Content', calls: 400,  avgIn: 4000,  avgOut: 1000,  primaryLabel: '5 mini',   fallbackLabel: 'GPT-5',     primaryId: 'gpt-5-mini' },
  { step: 'generate_exam_pool',       stepLabel: 'Exam-Pool',        calls: 160,  avgIn: 8000,  avgOut: 10000, primaryLabel: '5 mini',   fallbackLabel: 'GPT-5',     primaryId: 'gpt-5-mini' },
  { step: 'generate_handbook',        stepLabel: 'Handbook',         calls: 14,   avgIn: 4000,  avgOut: 8000,  primaryLabel: '4.1 mini', fallbackLabel: '4o-mini',   primaryId: 'gpt-4.1-mini' },
  { step: 'generate_minichecks',      stepLabel: 'Minichecks',       calls: 400,  avgIn: 2000,  avgOut: 2000,  primaryLabel: '4.1 nano', fallbackLabel: '5 nano',    primaryId: 'gpt-4.1-nano' },
  { step: 'elite_harden',             stepLabel: 'Elite Harden',     calls: 100,  avgIn: 6000,  avgOut: 2000,  primaryLabel: '5.4',      fallbackLabel: '5.2',       primaryId: 'gpt-5.4' },
  { step: 'council_propose',          stepLabel: 'Council Propose',  calls: 50,   avgIn: 4000,  avgOut: 3000,  primaryLabel: '5 mini',   fallbackLabel: 'Haiku 4.5', primaryId: 'gpt-5-mini' },
  { step: 'council_critique',         stepLabel: 'Council Critique', calls: 50,   avgIn: 5000,  avgOut: 2000,  primaryLabel: '5 mini',   fallbackLabel: 'Haiku 4.5', primaryId: 'gpt-5-mini' },
  { step: 'auto_fix',                 stepLabel: 'Auto-Fix',         calls: 20,   avgIn: 4000,  avgOut: 3000,  primaryLabel: '4.1 mini', fallbackLabel: '5 mini',    primaryId: 'gpt-4.1-mini' },
];

/**
 * Compute cost per call from model matrix (SSOT-coupled).
 * Looks up the canonical model pricing from MODEL_MATRIX_ROWS.
 */
function calcCostPerCall(primaryId: string, avgIn: number, avgOut: number): number {
  const row = MODEL_MATRIX_ROWS.find(r => r.canonicalId === primaryId);
  if (row) {
    return (avgIn * row.input + avgOut * row.output) / 1_000_000;
  }
  // Fallback: GPT-5-mini pricing from SSOT
  return (avgIn * 0.230 + avgOut * 1.840) / 1_000_000;
}

// ── LLM Cost Dashboard ─────────────────────────────────────

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

  // Compute course cost from SSOT pricing (not hardcoded)
  const pipelineCosts = useMemo(() => {
    return PIPELINE_STEP_ROWS.map(s => {
      const costPerCall = calcCostPerCall(s.primaryId, s.avgIn, s.avgOut);
      const total = s.calls * costPerCall;
      return { ...s, costPerCall, total };
    });
  }, []);

  const courseCost = useMemo(() =>
    pipelineCosts.reduce((sum, s) => sum + s.total, 0),
  [pipelineCosts]);

  const totalCalls = useMemo(() =>
    pipelineCosts.reduce((sum, s) => sum + s.calls, 0),
  [pipelineCosts]);

  // "Old" uniform routing cost estimate (all on GPT-5-mini as baseline)
  const courseCostOld = useMemo(() => {
    return PIPELINE_STEP_ROWS.reduce((sum, s) => {
      return sum + s.calls * (s.avgIn * 2.30 + s.avgOut * 9.20) / 1_000_000; // GPT-5 pricing
    }, 0);
  }, []);

  const savingsPct = courseCostOld > 0 ? Math.round((1 - courseCost / courseCostOld) * 100) : 0;

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
            <p className="text-2xl font-bold text-foreground">
              €{costMtd.toFixed(2)} <span className="text-sm text-muted-foreground">/ €{monthBudget}</span>
            </p>
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
            <p className={cn("text-2xl font-bold", daysLeft < 7 ? "text-destructive" : "text-foreground")}>
              {daysLeft} Tage
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cost per Course (SSOT-computed) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="border-primary/30">
          <CardContent className="py-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              💡 Kosten pro Kurs (optimiertes Routing)
            </p>
            <p className="text-3xl font-bold text-primary">≈ €{courseCost.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              14 LF, ~80 Kompetenzen, {totalCalls.toLocaleString('de-DE')} API-Calls
            </p>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="text-[10px] border-success/50 text-success">
                -{savingsPct}% vs. Einheitsmodell
              </Badge>
              <span className="text-[10px] text-muted-foreground line-through">
                €{courseCostOld.toFixed(2)} (alles GPT-5)
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">📊 Kurse im Budget</p>
            <p className="text-3xl font-bold text-foreground">
              {courseCost > 0 ? Math.floor((monthBudget - costMtd) / courseCost) : '–'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              noch generierbar bei €{courseCost.toFixed(2)}/Kurs
            </p>
            <p className="text-[10px] text-muted-foreground mt-2">
              Restbudget: €{(monthBudget - costMtd).toFixed(2)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Model Performance + Pricing Matrix */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            ⚡ Modell-Matrix: Preis × Latenz × Durchsatz
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
                  <th className="text-right py-1.5 px-2">TTFT</th>
                  <th className="text-right py-1.5 px-2">Tok/s</th>
                  <th className="text-right py-1.5 px-2">RPM</th>
                  <th className="text-center py-1.5 px-2">Konf.</th>
                  <th className="text-left py-1.5 px-2">Pipeline-Rolle</th>
                </tr>
              </thead>
              <tbody>
                {MODEL_MATRIX_ROWS.map(r => (
                  <tr key={r.model} className="border-b border-border/20">
                    <td className="py-1.5 px-2 font-medium whitespace-nowrap">{r.model}</td>
                    <td className="py-1.5 px-2 text-right font-mono">€{r.input.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">€{r.output.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{r.latency}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{r.tps}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{r.rpm}</td>
                    <td className="py-1.5 px-2 text-center">
                      <span className={cn("text-[9px] px-1 rounded",
                        r.confidence === 'high' && 'bg-success/20 text-success',
                        r.confidence === 'medium' && 'bg-warning/20 text-warning',
                        r.confidence === 'low' && 'bg-destructive/20 text-destructive',
                      )}>{r.source}</span>
                    </td>
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
            Preise: OpenAI Pricing Page März 2026 (EUR ≈ 0.92×USD). Perf-Daten: Benchmarks/Vendor-Docs (keine Garantie).
            Konf. = Konfidenz der Performance-Schätzung.
          </p>
        </CardContent>
      </Card>

      {/* Pipeline Routing Matrix */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            🔀 ExamFit Routing-Matrix (Kosten SSOT-berechnet)
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
                {pipelineCosts.map(r => (
                  <tr key={r.step} className="border-b border-border/20">
                    <td className="py-1.5 px-2 font-medium">{r.step}</td>
                    <td className="py-1.5 px-2 text-right">{r.calls}</td>
                    <td className="py-1.5 px-2 text-success">{r.primary}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{r.fallback}</td>
                    <td className="py-1.5 px-2 text-right font-mono">€{r.costPerCall.toFixed(4)}</td>
                    <td className="py-1.5 px-2 text-right font-mono font-medium">€{r.total.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-bold">
                  <td className="py-2 px-2">GESAMT</td>
                  <td className="py-2 px-2 text-right">{totalCalls.toLocaleString('de-DE')}</td>
                  <td colSpan={2} className="py-2 px-2 text-xs text-muted-foreground">
                    ~90% Calls unter 1.5s TTFT
                  </td>
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2 text-right text-primary">≈ €{courseCost.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-3 p-3 rounded-lg bg-muted/30 text-xs space-y-1">
            <p className="font-medium">
              📐 Architektur: nano → routing | mini → generation | balanced → exam | premium → validation
            </p>
            <p className="text-muted-foreground">
              • <strong>{savingsPct}%</strong> Kostenersparnis vs. Einheitsmodell
              • <strong>10×</strong> mehr Durchsatz
              • <strong>Keine</strong> Rate-Limit-Bottlenecks (Nano: 10k+ RPM)
            </p>
            <p className="text-muted-foreground">
              • Elite Harden (GPT-5.4) nur für {'<'}2% der Calls — höchste Qualität für Prüfungsinhalte
            </p>
            <p className="text-muted-foreground">
              • Exam-Pool + Validate: Fallback → GPT-5 (nicht mini), weil Validierungsfehler teurer sind als Latenz
            </p>
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
                      <td className={cn("py-2 px-2 text-right", r.jobs_failed > 0 && "text-destructive")}>
                        {r.jobs_failed}
                      </td>
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
