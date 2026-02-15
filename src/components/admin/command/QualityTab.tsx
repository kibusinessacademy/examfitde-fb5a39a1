import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Award, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function QualityTab() {
  const [summaries, setSummaries] = useState<any[]>([]);
  const [drift, setDrift] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabase as any;
      const [sumRes, driftRes] = await Promise.all([
        sb.from('package_quality_summary').select('*').order('quality_score', { ascending: true }).limit(30),
        sb.from('quality_drift_monitor').select('*').limit(60),
      ]);
      setSummaries(sumRes.data || []);
      setDrift(driftRes.data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />)}</div>;

  const badgeColor = (badge: string) => {
    switch (badge) {
      case 'platin': return 'bg-violet-500/10 text-violet-600 border-violet-500/20';
      case 'gold': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      case 'silber': return 'bg-gray-300/20 text-gray-500 border-gray-400/20';
      default: return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    }
  };

  interface ModelDriftData { days: any[]; avgScore: number; avgEscRate: number }

  // Aggregate drift by model
  const modelDrift: Record<string, ModelDriftData> = drift.reduce((acc: Record<string, ModelDriftData>, d: any) => {
    if (!acc[d.model]) acc[d.model] = { days: [], avgScore: 0, avgEscRate: 0 };
    acc[d.model].days.push(d);
    return acc;
  }, {} as Record<string, ModelDriftData>);

  for (const m of Object.values(modelDrift)) {
    m.avgScore = m.days.reduce((s: number, d: any) => s + (d.avg_quality_score || 0), 0) / m.days.length;
    m.avgEscRate = m.days.reduce((s: number, d: any) => s + (d.escalation_rate_pct || 0), 0) / m.days.length;
  }

  // Calculate overall stats
  const totalPackages = summaries.length;
  const avgScore = totalPackages > 0 ? Math.round(summaries.reduce((s, p) => s + (p.quality_score || 0), 0) / totalPackages) : 0;
  const avgDupRate = totalPackages > 0 ? (summaries.reduce((s, p) => s + (p.duplicate_rate || 0), 0) / totalPackages).toFixed(1) : '0';
  const totalEscalations = drift.reduce((s: number, d: any) => s + (d.escalation_count || 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Ø Quality Score</p><p className={cn("text-xl font-bold", avgScore >= 85 ? 'text-emerald-600' : avgScore >= 70 ? 'text-amber-600' : 'text-destructive')}>{avgScore}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Ø Duplicate Rate</p><p className="text-xl font-bold">{avgDupRate}%</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Packages bewertet</p><p className="text-xl font-bold">{totalPackages}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3"><p className="text-[10px] text-muted-foreground uppercase">Escalations (30d)</p><p className="text-xl font-bold">{totalEscalations}</p></CardContent></Card>
      </div>

      {/* Quality Drift Monitor */}
      {Object.keys(modelDrift).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Quality Drift Monitor</CardTitle>
            <CardDescription>Qualitätstrend pro Modell (30 Tage)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(modelDrift).map(([model, data]) => {
                const trend = data.days.length >= 2
                  ? (data.days[0]?.avg_quality_score || 0) - (data.days[data.days.length - 1]?.avg_quality_score || 0)
                  : 0;
                return (
                  <div key={model} className="flex items-center gap-3 text-sm border-b border-border/30 pb-2">
                    <span className="font-mono text-xs w-40 truncate">{model}</span>
                    <span className={cn("text-lg font-bold w-12 text-center",
                      data.avgScore >= 80 ? 'text-emerald-600' : data.avgScore >= 65 ? 'text-amber-600' : 'text-destructive'
                    )}>{data.avgScore.toFixed(0)}</span>
                    <div className="flex items-center gap-1">
                      {trend > 2 ? <TrendingUp className="h-3 w-3 text-emerald-500" /> : trend < -2 ? <TrendingDown className="h-3 w-3 text-destructive" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
                      <span className={cn("text-xs", trend > 2 ? 'text-emerald-600' : trend < -2 ? 'text-destructive' : 'text-muted-foreground')}>{trend > 0 ? '+' : ''}{trend.toFixed(1)}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Esc: {data.avgEscRate.toFixed(1)}%</span>
                    <span className="text-xs text-muted-foreground">{data.days.reduce((s: number, d: any) => s + (d.question_count || 0), 0)} Fragen</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Package Quality Scores */}
      {summaries.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Award className="h-4 w-4 text-primary" /> Fragenqualität pro Package</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summaries.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 text-sm border-b border-border/30 pb-2">
                  <span className={cn("text-lg font-bold w-10 text-center",
                    s.quality_score >= 85 ? 'text-emerald-600' : s.quality_score >= 70 ? 'text-amber-600' : 'text-destructive'
                  )}>{s.quality_score}</span>
                  <Badge variant="outline" className={cn("text-[10px]", badgeColor(s.quality_badge))}>{s.quality_badge}</Badge>
                  <span className="text-muted-foreground text-xs flex-1 truncate">{s.package_id?.substring(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">Dup: {s.duplicate_rate}%</span>
                  <span className="text-xs text-muted-foreground">BP: {((s.avg_blueprint_alignment || 0) * 100).toFixed(0)}%</span>
                  <span className="text-xs text-muted-foreground">⚠ {s.flagged_count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
