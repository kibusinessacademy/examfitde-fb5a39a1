import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';

type EconRow = {
  package_id: string;
  course_id: string | null;
  status: string | null;
  cost_eur_30d: number | null;
  revenue_eur_30d: number | null;
  gross_margin_eur_30d: number | null;
  roi_30d: number | null;
  llm_calls_30d: number | null;
  quality_score: number | null;
  quality_badge: string | null;
};

export default function RoiTab() {
  const [rows, setRows] = useState<EconRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error: err } = await supabase
        .from('package_economics')
        .select('*')
        .order('roi_30d', { ascending: false, nullsFirst: false })
        .limit(100);

      if (!mounted) return;
      if (err) setError(err.message);
      setRows((data as EconRow[]) ?? []);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const totalCost = rows.reduce((s, r) => s + (r.cost_eur_30d ?? 0), 0);
  const totalRevenue = rows.reduce((s, r) => s + (r.revenue_eur_30d ?? 0), 0);
  const totalMargin = totalRevenue - totalCost;

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    return <Card className="p-4"><p className="text-sm text-destructive">{error}</p></Card>;
  }

  return (
    <div className="space-y-4">
      {/* KPI Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">AI-Kosten 30d</p>
            <p className="text-lg font-bold text-foreground">{totalCost.toFixed(2)} €</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Revenue 30d</p>
            <p className="text-lg font-bold text-foreground">{totalRevenue.toFixed(2)} €</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Marge 30d</p>
            <p className={`text-lg font-bold ${totalMargin >= 0 ? 'text-primary' : 'text-destructive'}`}>
              {totalMargin.toFixed(2)} €
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">ROI pro Package (30 Tage)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Package</th>
                  <th className="py-2 pr-3 font-medium text-right">Kosten</th>
                  <th className="py-2 pr-3 font-medium text-right">Revenue</th>
                  <th className="py-2 pr-3 font-medium text-right">Marge</th>
                  <th className="py-2 pr-3 font-medium text-right">ROI</th>
                  <th className="py-2 pr-3 font-medium text-right">Quality</th>
                  <th className="py-2 font-medium text-right">Calls</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const margin = r.gross_margin_eur_30d ?? 0;
                  const MarginIcon = margin > 0 ? TrendingUp : margin < 0 ? TrendingDown : Minus;

                  return (
                    <tr key={r.package_id} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-mono text-xs truncate max-w-[180px]" title={r.package_id}>
                        {r.package_id.slice(0, 8)}…
                        {r.status && <Badge variant="outline" className="ml-1 text-[10px]">{r.status}</Badge>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{(r.cost_eur_30d ?? 0).toFixed(2)} €</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{(r.revenue_eur_30d ?? 0).toFixed(2)} €</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        <span className={`inline-flex items-center gap-1 ${margin >= 0 ? 'text-primary' : 'text-destructive'}`}>
                          <MarginIcon className="h-3 w-3" />
                          {margin.toFixed(2)} €
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.roi_30d != null ? `${r.roi_30d.toFixed(1)}x` : '—'}</td>
                      <td className="py-2 pr-3 text-right">
                        {r.quality_score != null ? (
                          <Badge variant={r.quality_score >= 80 ? 'default' : 'secondary'} className="text-[10px]">
                            {r.quality_score}
                          </Badge>
                        ) : '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums">{r.llm_calls_30d ?? 0}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Keine Daten</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
