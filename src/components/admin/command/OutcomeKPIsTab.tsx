import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  TrendingUp, Trophy, Clock, Target, Users,
  RefreshCw, Loader2, BarChart3, Zap, Activity
} from 'lucide-react';
import { toast } from 'sonner';

interface OutcomeKPI {
  curriculum_id: string;
  learners: number;
  pass_rate: number;
  avg_days_to_pass: number | null;
  avg_improvement: number;
  avg_attempts: number;
  avg_best_score: number;
}

interface CanaryRelease {
  id: string;
  name: string;
  engine_version: string;
  baseline_version: string;
  traffic_pct: number;
  status: string;
  metrics_baseline: any;
  metrics_canary: any;
  started_at: string;
  evaluated_at: string | null;
}

interface DriftSnapshot {
  engine_version: string;
  avg_quality_score: number;
  avg_discrimination: number;
  drift_alert: boolean;
  snapshot_at: string;
  sample_size: number;
}

export default function OutcomeKPIsTab() {
  const [kpis, setKpis] = useState<OutcomeKPI[]>([]);
  const [canaries, setCanaries] = useState<CanaryRelease[]>([]);
  const [drifts, setDrifts] = useState<DriftSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [outcomeRes, canaryRes, driftRes] = await Promise.all([
        supabase.functions.invoke('outcome-tracker', { body: { action: 'stats' } }),
        supabase.functions.invoke('canary-manager', { body: { action: 'list' } }),
        supabase.from('drift_snapshots')
          .select('engine_version, avg_quality_score, avg_discrimination, drift_alert, snapshot_at, sample_size')
          .order('snapshot_at', { ascending: false })
          .limit(10),
      ]);

      if (outcomeRes.data?.kpis) setKpis(outcomeRes.data.kpis);
      if (canaryRes.data?.canaries) setCanaries(canaryRes.data.canaries);
      if (driftRes.data) setDrifts(driftRes.data as DriftSnapshot[]);
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  const totalLearners = kpis.reduce((a, k) => a + k.learners, 0);
  const avgPassRate = kpis.length > 0 ? kpis.reduce((a, k) => a + k.pass_rate, 0) / kpis.length : 0;
  const avgImprovement = kpis.length > 0 ? kpis.reduce((a, k) => a + k.avg_improvement, 0) / kpis.length : 0;

  const activeCanary = canaries.find(c => c.status === 'active');
  const latestDrift = drifts[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> Outcome-KPIs & Engine Control
        </h3>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {/* Aggregate KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1"><Users className="h-3 w-3" /><span className="text-[10px] uppercase">Lernende</span></div>
            <p className="text-xl font-bold font-mono">{totalLearners}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1"><Trophy className="h-3 w-3" /><span className="text-[10px] uppercase">Ø Bestehensquote</span></div>
            <p className={cn("text-xl font-bold font-mono", avgPassRate >= 60 ? "text-success" : "text-destructive")}>{avgPassRate.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1"><TrendingUp className="h-3 w-3" /><span className="text-[10px] uppercase">Ø Verbesserung</span></div>
            <p className={cn("text-xl font-bold font-mono", avgImprovement > 0 ? "text-success" : "text-muted-foreground")}>{avgImprovement > 0 ? '+' : ''}{avgImprovement.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1"><Activity className="h-3 w-3" /><span className="text-[10px] uppercase">Kurse tracked</span></div>
            <p className="text-xl font-bold font-mono">{kpis.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-curriculum breakdown */}
      {kpis.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Outcome pro Kurs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {kpis.map((k, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                  <span className="text-xs text-foreground truncate flex-1 font-mono">{k.curriculum_id.slice(0, 8)}</span>
                  <Badge variant="outline" className="text-[9px]">{k.learners} User</Badge>
                  <div className="w-20">
                    <Progress value={k.pass_rate} className="h-1.5" />
                  </div>
                  <span className={cn("text-xs font-mono w-12 text-right", k.pass_rate >= 60 ? "text-success" : "text-destructive")}>
                    {k.pass_rate}%
                  </span>
                  {k.avg_days_to_pass && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />{k.avg_days_to_pass}d
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Canary Release Status */}
      <Card className={cn(activeCanary ? "border-primary/30" : "")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4" /> Canary Releases
          </CardTitle>
        </CardHeader>
        <CardContent>
          {canaries.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Canary-Releases konfiguriert</p>
          ) : (
            <div className="space-y-2">
              {canaries.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                  <span className="text-xs text-foreground flex-1 truncate">{c.name}</span>
                  <Badge className={cn("text-[9px]",
                    c.status === 'active' ? 'bg-primary/20 text-primary' :
                    c.status === 'promoted' ? 'bg-success-bg-subtle text-success' :
                    c.status === 'rolled_back' ? 'bg-destructive-bg-subtle text-destructive' :
                    'bg-muted text-muted-foreground'
                  )}>{c.status}</Badge>
                  <span className="text-[10px] text-muted-foreground">{c.engine_version}</span>
                  <span className="text-[10px] text-muted-foreground">{c.traffic_pct}%</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drift Detection */}
      <Card className={cn(latestDrift?.drift_alert ? "border-destructive/30" : "")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4" /> Drift Detection
          </CardTitle>
        </CardHeader>
        <CardContent>
          {drifts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Drift-Snapshots vorhanden</p>
          ) : (
            <div className="space-y-2">
              {drifts.slice(0, 5).map((d, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                  <span className="text-xs text-foreground w-16 font-mono">{d.engine_version}</span>
                  <span className="text-[10px] text-muted-foreground">Q:{(d.avg_quality_score || 0).toFixed(1)}</span>
                  <span className="text-[10px] text-muted-foreground">D:{(d.avg_discrimination || 0).toFixed(3)}</span>
                  <span className="text-[10px] text-muted-foreground">n={d.sample_size}</span>
                  {d.drift_alert && <Badge variant="destructive" className="text-[9px]">DRIFT!</Badge>}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {new Date(d.snapshot_at).toLocaleDateString('de-DE')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
