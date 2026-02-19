import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  Loader2, Shield, AlertTriangle, TrendingUp, Users,
  Target, Activity, ThermometerSun
} from 'lucide-react';

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

interface PRIEntry {
  user_id: string;
  curriculum_id: string;
  curriculum_name: string;
  pri_score: number;
  pass_probability: number;
  theta: number;
  total_items_seen: number;
}

interface EarlyWarning {
  user_id: string;
  curriculum_id: string;
  curriculum_name: string;
  pass_probability: number;
  risk_score: number;
  risk_level: string;
  total_items_seen: number;
  last_activity_at: string;
}

interface HeatmapEntry {
  curriculum_id: string;
  competency_id: string;
  competency_name: string;
  learning_field_name: string;
  fragility_level: string;
  fail_rate_pct: number;
  repeat_fail_rate_pct: number;
  avg_score_pct: number;
  total_attempts: number;
  trusted_attempts: number;
  unique_learners: number;
  frozen: boolean;
}

export default function B2BReportingDashboard() {
  const [pri, setPri] = useState<PRIEntry[]>([]);
  const [warnings, setWarnings] = useState<EarlyWarning[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = supabase as any;
    const [priRes, warnRes, heatRes] = await Promise.all([
      sb.from('v_pruefungsreife_index').select('*').order('pri_score', { ascending: true }).limit(50),
      sb.from('v_early_warning').select('*').order('risk_score', { ascending: false }).limit(30),
      sb.from('v_competency_heatmap').select('*').limit(50),
    ]);
    setPri(priRes.data || []);
    setWarnings(warnRes.data || []);
    setHeatmap(heatRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  const criticalCount = warnings.filter(w => w.risk_level === 'critical').length;
  const atRiskCount = warnings.filter(w => w.risk_level === 'at_risk').length;
  const avgPRI = pri.length > 0 ? pri.reduce((s, r) => s + Number(r.pri_score), 0) / pri.length : 0;
  const criticalComps = heatmap.filter(h => h.fragility_level === 'critical').length;
  const fragileComps = heatmap.filter(h => h.fragility_level === 'fragile').length;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-4 text-center">
            <Target className="h-4 w-4 mx-auto mb-1 text-primary" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ø Prüfungsreife (PRI)</p>
            <p className="text-2xl font-bold text-foreground">{avgPRI.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground">{pri.length} Lernende</p>
          </CardContent>
        </Card>
        <Card className={cn(criticalCount > 0 && "border-destructive/50")}>
          <CardContent className="py-4 text-center">
            <AlertTriangle className="h-4 w-4 mx-auto mb-1 text-destructive" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Risiko-Kandidaten</p>
            <p className="text-2xl font-bold text-destructive">{criticalCount}</p>
            <p className="text-[10px] text-muted-foreground">{atRiskCount} gefährdet</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <ThermometerSun className="h-4 w-4 mx-auto mb-1 text-yellow-500" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Fragile Kompetenzen</p>
            <p className="text-2xl font-bold text-foreground">{fragileComps + criticalComps}</p>
            <p className="text-[10px] text-muted-foreground">{criticalComps} kritisch</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <Users className="h-4 w-4 mx-auto mb-1 text-primary" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Aktive Lernende</p>
            <p className="text-2xl font-bold text-foreground">{pri.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Frühwarnung */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Frühwarnung — Risiko-Kandidaten
          </CardTitle>
        </CardHeader>
        <CardContent>
          {warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              ✅ Keine Risiko-Kandidaten. Alle Lernenden sind auf Kurs.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">User</th>
                    <th className="text-left py-2 px-2">Zertifizierung</th>
                    <th className="text-right py-2 px-2">Risiko</th>
                    <th className="text-right py-2 px-2">Bestehenschance</th>
                    <th className="text-right py-2 px-2">Aktivität</th>
                    <th className="text-right py-2 px-2">Letzte Aktivität</th>
                  </tr>
                </thead>
                <tbody>
                  {warnings.map(w => (
                    <tr key={`${w.user_id}-${w.curriculum_id}`} className="border-b border-border/30">
                      <td className="py-2 px-2 font-mono text-[10px]">{w.user_id.slice(0, 8)}…</td>
                      <td className="py-2 px-2 max-w-[200px] truncate">{w.curriculum_name || '–'}</td>
                      <td className="py-2 px-2 text-right">
                        <Badge variant={w.risk_level === 'critical' ? 'destructive' : 'secondary'} className="text-[10px]">
                          {w.risk_level === 'critical' ? '🔴' : '🟡'} {Number(w.risk_score).toFixed(0)}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-right font-medium">
                        {(Number(w.pass_probability) * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 px-2 text-right">{w.total_items_seen} Items</td>
                      <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                        {w.last_activity_at ? new Date(w.last_activity_at).toLocaleDateString('de-DE') : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* PRI Übersicht */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4" /> Prüfungsreife-Index (PRI)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pri.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Noch keine Learner-Daten verfügbar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">User</th>
                    <th className="text-left py-2 px-2">Zertifizierung</th>
                    <th className="text-right py-2 px-2">PRI</th>
                    <th className="text-right py-2 px-2">Bestehenschance</th>
                    <th className="text-right py-2 px-2">Theta</th>
                    <th className="text-right py-2 px-2">Items</th>
                  </tr>
                </thead>
                <tbody>
                  {pri.map(p => {
                    const score = Number(p.pri_score);
                    return (
                      <tr key={`${p.user_id}-${p.curriculum_id}`} className="border-b border-border/30">
                        <td className="py-2 px-2 font-mono text-[10px]">{p.user_id.slice(0, 8)}…</td>
                        <td className="py-2 px-2 max-w-[200px] truncate">{p.curriculum_name || '–'}</td>
                        <td className="py-2 px-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Progress value={score} className={cn("h-2 w-16",
                              score >= 70 ? "[&>div]:bg-green-500" :
                              score >= 40 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-destructive"
                            )} />
                            <span className="font-bold w-8 text-right">{score.toFixed(0)}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right">{(Number(p.pass_probability) * 100).toFixed(0)}%</td>
                        <td className="py-2 px-2 text-right font-mono">{Number(p.theta).toFixed(2)}</td>
                        <td className="py-2 px-2 text-right">{p.total_items_seen}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kompetenz-Heatmap */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" /> Kompetenz-Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent>
          {heatmap.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Noch keine Kompetenz-Daten. Daten werden ab dem ersten Learner-Attempt aggregiert.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">Kompetenz</th>
                    <th className="text-left py-2 px-2">Lernfeld</th>
                    <th className="text-center py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Fail %</th>
                    <th className="text-right py-2 px-2">Repeat Fail %</th>
                    <th className="text-right py-2 px-2">Ø Score</th>
                    <th className="text-right py-2 px-2">Learner</th>
                    <th className="text-right py-2 px-2">Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {heatmap.map(h => (
                    <tr key={`${h.curriculum_id}-${h.competency_id}`} className="border-b border-border/30">
                      <td className="py-2 px-2 max-w-[200px] truncate">{h.competency_name || '–'}</td>
                      <td className="py-2 px-2 max-w-[150px] truncate text-muted-foreground">{h.learning_field_name || '–'}</td>
                      <td className="py-2 px-2 text-center">
                        <Badge
                          variant={h.fragility_level === 'critical' ? 'destructive' : h.fragility_level === 'fragile' ? 'secondary' : 'default'}
                          className="text-[10px]"
                        >
                          {h.frozen ? '🔒' : ''}{h.fragility_level}
                        </Badge>
                      </td>
                      <td className={cn("py-2 px-2 text-right font-medium",
                        Number(h.fail_rate_pct) > 50 ? "text-destructive" :
                        Number(h.fail_rate_pct) > 35 ? "text-yellow-500" : "text-foreground"
                      )}>{Number(h.fail_rate_pct).toFixed(1)}%</td>
                      <td className={cn("py-2 px-2 text-right",
                        Number(h.repeat_fail_rate_pct) > 40 ? "text-destructive font-bold" : "text-foreground"
                      )}>{Number(h.repeat_fail_rate_pct).toFixed(1)}%</td>
                      <td className="py-2 px-2 text-right">{Number(h.avg_score_pct).toFixed(0)}%</td>
                      <td className="py-2 px-2 text-right">{h.unique_learners}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{h.trusted_attempts}/{h.total_attempts}</td>
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
