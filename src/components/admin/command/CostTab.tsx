import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, Grid3X3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function CostTab() {
  const [costs, setCosts] = useState<any[]>([]);
  const [heatmap, setHeatmap] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabase as any;
      const [costRes, heatRes] = await Promise.all([
        sb.from('cost_intelligence').select('*').limit(30),
        sb.from('cost_quality_heatmap').select('*').limit(30),
      ]);
      setCosts(costRes.data || []);
      setHeatmap(heatRes.data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />)}</div>;

  const totalCost = costs.reduce((s: number, c: any) => s + (c.total_cost_eur || 0), 0);
  const totalCalls = costs.reduce((s: number, c: any) => s + (c.call_count || 0), 0);

  const quadrantColors: Record<string, string> = {
    optimal: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    premium: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
    bulk_acceptable: 'bg-muted text-muted-foreground border-border',
    expensive_low_quality: 'bg-destructive/10 text-destructive border-destructive/30',
  };

  const quadrantLabels: Record<string, string> = {
    optimal: '✅ Optimal',
    premium: '💎 Premium',
    bulk_acceptable: '📦 Bulk OK',
    expensive_low_quality: '🔥 Teuer & schlecht',
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Gesamt (30d)</p><p className="text-xl font-bold">€{totalCost.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">API Calls</p><p className="text-xl font-bold">{totalCalls.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Ø €/Call</p><p className="text-xl font-bold">€{totalCalls > 0 ? (totalCost / totalCalls).toFixed(4) : '0'}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Heatmap-Einträge</p><p className="text-xl font-bold">{heatmap.length}</p></CardContent></Card>
      </div>

      {/* Cost vs Quality Heatmap */}
      {heatmap.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Grid3X3 className="h-4 w-4 text-primary" /> Cost vs Quality Heatmap</CardTitle>
            <CardDescription>Strategische Modellbewertung: Kosten × Qualität</CardDescription>
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
                  <span className={cn("text-xs font-bold",
                    (h.avg_quality_score || 0) >= 80 ? 'text-emerald-600' :
                    (h.avg_quality_score || 0) >= 65 ? 'text-amber-600' : 'text-destructive'
                  )}>Q:{(h.avg_quality_score || 0).toFixed(0)}</span>
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
