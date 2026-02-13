import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  Loader2, DollarSign, TrendingUp, BarChart3, PieChart,
  Calculator, Target, ArrowUpRight
} from 'lucide-react';

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

interface CostSummary {
  package_id: string;
  certification_id: string | null;
  curriculum_id: string | null;
  certification_name: string;
  total_jobs: number;
  total_cost_eur: number;
  total_tokens_input: number;
  total_tokens_output: number;
  cost_exam_generation: number;
  cost_oral_generation: number;
  cost_handbook: number;
  cost_qa: number;
  cost_other: number;
  first_cost_at: string;
  last_cost_at: string;
}

interface CostSnapshot {
  id: string;
  certification_name: string;
  package_id: string;
  publish_version: number;
  total_cost_eur: number;
  cost_exam_generation: number;
  cost_oral_generation: number;
  cost_handbook: number;
  cost_qa: number;
  total_questions: number;
  total_domains: number;
  selling_price_eur: number | null;
  break_even_sales: number | null;
  created_at: string;
}

interface ProviderBreakdown {
  provider: string;
  total_cost: number;
  total_jobs: number;
  avg_latency: number;
}

export default function UnitEconomicsDashboard() {
  const [summaries, setSummaries] = useState<CostSummary[]>([]);
  const [snapshots, setSnapshots] = useState<CostSnapshot[]>([]);
  const [providerBreakdown, setProviderBreakdown] = useState<ProviderBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultPrice, setDefaultPrice] = useState(99);

  const load = useCallback(async () => {
    setLoading(true);
    const [summaryRes, snapshotRes, providerRes] = await Promise.all([
      (supabase as any).from('certification_cost_summary').select('*').order('total_cost_eur', { ascending: false }),
      (supabase as any).from('certification_cost_snapshots').select('*').order('created_at', { ascending: false }).limit(20),
      (supabase as any).from('job_costs').select('provider, cost_eur, latency_ms'),
    ]);

    setSummaries(summaryRes.data || []);
    setSnapshots(snapshotRes.data || []);

    // Aggregate provider breakdown
    const byProvider: Record<string, { cost: number; count: number; latency: number[] }> = {};
    for (const r of (providerRes.data || [])) {
      if (!byProvider[r.provider]) byProvider[r.provider] = { cost: 0, count: 0, latency: [] };
      byProvider[r.provider].cost += Number(r.cost_eur || 0);
      byProvider[r.provider].count += 1;
      if (r.latency_ms) byProvider[r.provider].latency.push(r.latency_ms);
    }
    setProviderBreakdown(
      Object.entries(byProvider).map(([provider, d]) => ({
        provider,
        total_cost: d.cost,
        total_jobs: d.count,
        avg_latency: d.latency.length > 0 ? d.latency.reduce((a, b) => a + b, 0) / d.latency.length : 0,
      })).sort((a, b) => b.total_cost - a.total_cost)
    );

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  const totalCost = summaries.reduce((s, r) => s + Number(r.total_cost_eur), 0);
  const totalJobs = summaries.reduce((s, r) => s + Number(r.total_jobs), 0);
  const totalTokensIn = summaries.reduce((s, r) => s + Number(r.total_tokens_input), 0);
  const totalTokensOut = summaries.reduce((s, r) => s + Number(r.total_tokens_output), 0);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gesamt-Investition</p>
            <p className="text-2xl font-bold text-foreground">€{totalCost.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground">{summaries.length} Zertifizierungen</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ø Kosten/Zertifizierung</p>
            <p className="text-2xl font-bold text-foreground">€{summaries.length > 0 ? (totalCost / summaries.length).toFixed(2) : '0'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Jobs</p>
            <p className="text-2xl font-bold text-foreground">{totalJobs.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tokens (In/Out)</p>
            <p className="text-lg font-bold text-foreground">{(totalTokensIn / 1000).toFixed(0)}k / {(totalTokensOut / 1000).toFixed(0)}k</p>
          </CardContent>
        </Card>
      </div>

      {/* Break-Even Calculator */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calculator className="h-4 w-4" /> Break-Even & Margen-Rechner
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs text-muted-foreground">Verkaufspreis:</span>
            <Input
              type="number"
              value={defaultPrice}
              onChange={e => setDefaultPrice(Number(e.target.value) || 0)}
              className="w-24 h-8 text-sm"
            />
            <span className="text-xs text-muted-foreground">€</span>
          </div>
        </CardContent>
      </Card>

      {/* Per-Certification Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="h-4 w-4" /> Kosten pro Zertifizierung
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Noch keine Kosten-Daten erfasst. Daten werden ab sofort bei jedem Job-Run geloggt.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Zertifizierung</th>
                    <th className="text-right py-2 px-2">Gesamt €</th>
                    <th className="text-right py-2 px-2">Exam</th>
                    <th className="text-right py-2 px-2">Oral</th>
                    <th className="text-right py-2 px-2">Handbuch</th>
                    <th className="text-right py-2 px-2">QA</th>
                    <th className="text-right py-2 px-2">Sonstig</th>
                    <th className="text-right py-2 px-2">Jobs</th>
                    <th className="text-right py-2 px-2">Break-Even</th>
                    <th className="text-right py-2 px-2">Marge @50</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map(s => {
                    const cost = Number(s.total_cost_eur);
                    const breakEven = defaultPrice > 0 ? Math.ceil(cost / defaultPrice) : 0;
                    const revenueAt50 = 50 * defaultPrice;
                    const marginAt50 = revenueAt50 - cost;
                    const marginPct = revenueAt50 > 0 ? (marginAt50 / revenueAt50) * 100 : 0;
                    return (
                      <tr key={s.package_id || s.certification_id || Math.random()} className="border-b border-border/30">
                        <td className="py-2 px-2 font-medium max-w-[200px] truncate" title={s.certification_name}>
                          {s.certification_name}
                        </td>
                        <td className="py-2 px-2 text-right font-bold">€{cost.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right">€{Number(s.cost_exam_generation).toFixed(2)}</td>
                        <td className="py-2 px-2 text-right">€{Number(s.cost_oral_generation).toFixed(2)}</td>
                        <td className="py-2 px-2 text-right">€{Number(s.cost_handbook).toFixed(2)}</td>
                        <td className="py-2 px-2 text-right">€{Number(s.cost_qa).toFixed(2)}</td>
                        <td className="py-2 px-2 text-right text-muted-foreground">€{Number(s.cost_other).toFixed(2)}</td>
                        <td className="py-2 px-2 text-right">{s.total_jobs}</td>
                        <td className="py-2 px-2 text-right">
                          <Badge variant={breakEven <= 20 ? 'default' : 'destructive'} className="text-[10px]">
                            {breakEven} Verkäufe
                          </Badge>
                        </td>
                        <td className={cn("py-2 px-2 text-right font-medium", marginAt50 > 0 ? "text-primary" : "text-destructive")}>
                          €{marginAt50.toFixed(0)} ({marginPct.toFixed(0)}%)
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

      {/* Provider Cost Breakdown */}
      {providerBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <PieChart className="h-4 w-4" /> Kosten nach Provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {providerBreakdown.map(pb => {
                const pct = totalCost > 0 ? (pb.total_cost / totalCost) * 100 : 0;
                return (
                  <div key={pb.provider} className="p-3 rounded-lg bg-muted/30 text-center">
                    <p className="text-xs font-medium uppercase">{pb.provider}</p>
                    <p className="text-xl font-bold">€{pb.total_cost.toFixed(2)}</p>
                    <Progress value={pct} className="h-1.5 mt-2" />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {pb.total_jobs} Jobs · Ø {pb.avg_latency > 0 ? `${(pb.avg_latency / 1000).toFixed(1)}s` : '–'}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ROI Projection */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> ROI-Projektion (12 Monate)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Keine Daten</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Zertifizierung</th>
                    <th className="text-right py-2 px-2">Investition</th>
                    <th className="text-right py-2 px-2">Break-Even</th>
                    <th className="text-right py-2 px-2">@100 Sales</th>
                    <th className="text-right py-2 px-2">@500 Sales</th>
                    <th className="text-right py-2 px-2">ROI @100</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map(s => {
                    const cost = Number(s.total_cost_eur);
                    const breakEven = defaultPrice > 0 ? Math.ceil(cost / defaultPrice) : 0;
                    const rev100 = 100 * defaultPrice;
                    const rev500 = 500 * defaultPrice;
                    const roi100 = cost > 0 ? ((rev100 - cost) / cost) * 100 : 0;
                    return (
                      <tr key={s.package_id || Math.random()} className="border-b border-border/30">
                        <td className="py-2 px-2 max-w-[200px] truncate">{s.certification_name}</td>
                        <td className="py-2 px-2 text-right">€{cost.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right">{breakEven}</td>
                        <td className={cn("py-2 px-2 text-right font-medium", rev100 - cost > 0 ? "text-primary" : "text-destructive")}>
                          €{(rev100 - cost).toFixed(0)}
                        </td>
                        <td className="py-2 px-2 text-right font-medium text-primary">
                          €{(rev500 - cost).toFixed(0)}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Badge variant={roi100 > 500 ? 'default' : roi100 > 0 ? 'secondary' : 'destructive'} className="text-[10px]">
                            {roi100.toFixed(0)}%
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

      {/* Historical Snapshots */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Publish-Snapshots
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Zertifizierung</th>
                    <th className="text-right py-2 px-2">Version</th>
                    <th className="text-right py-2 px-2">Kosten</th>
                    <th className="text-right py-2 px-2">Fragen</th>
                    <th className="text-right py-2 px-2">Domains</th>
                    <th className="text-right py-2 px-2">Break-Even</th>
                    <th className="text-right py-2 px-2">Datum</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map(s => (
                    <tr key={s.id} className="border-b border-border/30">
                      <td className="py-2 px-2">{s.certification_name}</td>
                      <td className="py-2 px-2 text-right">v{s.publish_version}</td>
                      <td className="py-2 px-2 text-right font-medium">€{Number(s.total_cost_eur).toFixed(2)}</td>
                      <td className="py-2 px-2 text-right">{s.total_questions}</td>
                      <td className="py-2 px-2 text-right">{s.total_domains}</td>
                      <td className="py-2 px-2 text-right">
                        {s.break_even_sales ? `${s.break_even_sales} Sales` : '–'}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString('de-DE')}
                      </td>
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
