import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, Shield, TrendingDown, RefreshCw,
  Loader2, Brain, Flame, BarChart3, Target
} from 'lucide-react';
import { toast } from 'sonner';

interface CompetencyPerf {
  id: string;
  curriculum_id: string;
  competency_id: string | null;
  learning_field_id: string | null;
  topic_key: string | null;
  total_attempts: number;
  total_correct: number;
  avg_score: number;
  fail_rate: number;
  common_error_patterns: string[];
  avg_impact_score: number | null;
  avg_hallucination_risk: number | null;
  regeneration_count: number;
  fragility_level: string;
  last_updated: string;
}

export default function QualityCockpitTab() {
  const [stats, setStats] = useState<CompetencyPerf[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('competency_performance_stats')
        .select('*')
        .order('fail_rate', { ascending: false })
        .limit(50);

      if (error) throw error;
      setStats((data as any[]) || []);
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  const critical = stats.filter(s => s.fragility_level === 'critical');
  const fragile = stats.filter(s => s.fragility_level === 'fragile');
  const stable = stats.filter(s => s.fragility_level === 'stable');
  const totalAttempts = stats.reduce((a, s) => a + s.total_attempts, 0);
  const avgFailRate = stats.length > 0 ? stats.reduce((a, s) => a + s.fail_rate, 0) / stats.length : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Brain className="h-4 w-4" /> Mastery-Feedback-Loop & Quality Cockpit
        </h3>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1"><Target className="h-3 w-3" /><span className="text-[10px] uppercase">Kompetenzen</span></div>
            <p className="text-xl font-bold font-mono">{stats.length}</p>
          </CardContent>
        </Card>
        <Card className={cn(critical.length > 0 && "border-destructive/30")}>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-destructive mb-1"><Flame className="h-3 w-3" /><span className="text-[10px] uppercase">Kritisch</span></div>
            <p className="text-xl font-bold font-mono text-destructive">{critical.length}</p>
          </CardContent>
        </Card>
        <Card className={cn(fragile.length > 0 && "border-yellow-500/30")}>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-yellow-600 mb-1"><AlertTriangle className="h-3 w-3" /><span className="text-[10px] uppercase">Fragil</span></div>
            <p className="text-xl font-bold font-mono text-yellow-600">{fragile.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1"><BarChart3 className="h-3 w-3" /><span className="text-[10px] uppercase">Ø Fehlerrate</span></div>
            <p className={cn("text-xl font-bold font-mono", avgFailRate > 0.35 ? "text-destructive" : avgFailRate > 0.2 ? "text-yellow-600" : "text-emerald-600")}>{(avgFailRate * 100).toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Critical Competencies */}
      {critical.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <Flame className="h-4 w-4" /> Kritische Kompetenzen (Auto-Verstärkung aktiv)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {critical.map((s) => (
                <CompetencyRow key={s.id} stat={s} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fragile Competencies */}
      {fragile.length > 0 && (
        <Card className="border-yellow-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="h-4 w-4" /> Fragile Kompetenzen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {fragile.map((s) => (
                <CompetencyRow key={s.id} stat={s} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stable Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-600" /> Stabile Kompetenzen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {stable.length} Kompetenzen mit Fehlerrate &lt; 35% — kein Eingriff nötig.
            Gesamt: {totalAttempts.toLocaleString('de-DE')} Antworten tracked.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function CompetencyRow({ stat }: { stat: CompetencyPerf }) {
  const failPct = (stat.fail_rate * 100).toFixed(1);
  const isCritical = stat.fragility_level === 'critical';

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/30 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono text-foreground truncate">
            {stat.competency_id?.slice(0, 8) || stat.topic_key?.slice(0, 16) || '—'}
          </span>
          <Badge className={cn("text-[9px]", isCritical ? "bg-destructive/20 text-destructive" : "bg-yellow-500/20 text-yellow-700")}>
            {failPct}% Fehler
          </Badge>
          {stat.regeneration_count > 0 && (
            <Badge variant="outline" className="text-[9px]">{stat.regeneration_count}× regen.</Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-24">
            <Progress value={100 - stat.fail_rate * 100} className="h-1.5" />
          </div>
          <span className="text-[10px] text-muted-foreground">{stat.total_attempts} Versuche</span>
          <span className="text-[10px] text-muted-foreground">Ø {stat.avg_score.toFixed(0)}%</span>
          {stat.avg_impact_score != null && (
            <span className="text-[10px] text-muted-foreground">Impact: {stat.avg_impact_score.toFixed(2)}</span>
          )}
        </div>
        {stat.common_error_patterns && stat.common_error_patterns.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {(stat.common_error_patterns as string[]).slice(0, 3).map((err, i) => (
              <span key={i} className="text-[9px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{err}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
