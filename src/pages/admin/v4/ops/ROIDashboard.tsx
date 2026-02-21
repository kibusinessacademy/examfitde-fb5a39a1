import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loading, MiniKPI } from './OpsShared';

export default function ROIDashboard() {
  const [roi, setRoi] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('package_economics').select('*')
        .order('roi_30d', { ascending: false, nullsFirst: false }).limit(100);
      if (error) console.error('[ROIDashboard] Query error:', error.message);
      setRoi(data || []);
    } catch (e) {
      console.error('[ROIDashboard] Unexpected error:', e);
      setRoi([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  const totalRevenue = roi.reduce((s: number, r: any) => s + Number(r.revenue_eur_30d || 0), 0);
  const totalCost = roi.reduce((s: number, r: any) => s + Number(r.cost_eur_30d || 0), 0);
  const totalMargin = totalRevenue - totalCost;
  const profitable = roi.filter((r: any) => Number(r.gross_margin_eur_30d || 0) > 0).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="Revenue 30d" value={`€${totalRevenue.toFixed(2)}`} />
        <MiniKPI label="AI-Kosten 30d" value={`€${totalCost.toFixed(2)}`} />
        <MiniKPI label="Marge 30d" value={`€${totalMargin.toFixed(2)}`} alert={totalMargin < 0} />
        <MiniKPI label="Profitabel" value={`${profitable}/${roi.length}`} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">💰 ROI pro Package (30 Tage)</CardTitle></CardHeader>
        <CardContent>
          {roi.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Noch keine Daten vorhanden.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-3">Package</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-right py-2 px-3">Kosten (€)</th>
                    <th className="text-right py-2 px-3">Revenue (€)</th>
                    <th className="text-right py-2 px-3">Marge (€)</th>
                    <th className="text-right py-2 px-3">ROI</th>
                    <th className="text-right py-2 px-3">LLM Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {roi.map((r: any) => {
                    const margin = Number(r.gross_margin_eur_30d || 0);
                    return (
                      <tr key={r.package_id} className={cn("border-b border-border/30", margin < 0 && 'bg-destructive/5')}>
                        <td className="py-2 px-3 font-mono text-[11px]" title={r.package_id}>{r.package_id?.slice(0, 8)}…</td>
                        <td className="py-2 px-3"><Badge variant="outline" className="text-[10px]">{r.status || '–'}</Badge></td>
                        <td className="py-2 px-3 text-right tabular-nums">{Number(r.cost_eur_30d || 0).toFixed(2)}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{Number(r.revenue_eur_30d || 0).toFixed(2)}</td>
                        <td className={cn("py-2 px-3 text-right tabular-nums font-bold", margin >= 0 ? "text-emerald-600" : "text-destructive")}>{margin.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.roi_30d != null ? `${Number(r.roi_30d).toFixed(1)}x` : '—'}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{r.llm_calls_30d ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
