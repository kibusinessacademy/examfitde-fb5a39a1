import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, Shield, TrendingDown, RefreshCw,
  Loader2, Brain, Flame, BarChart3, Target, Lock, Users, ShieldCheck
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
  trusted_attempts: number;
  unique_learners: number;
  avg_score: number;
  fail_rate: number;
  first_pass_fail_rate: number;
  repeat_fail_rate: number;
  common_error_patterns: string[];
  avg_impact_score: number | null;
  avg_hallucination_risk: number | null;
  regeneration_count: number;
  fragility_level: string;
  frozen: boolean;
  consecutive_critical_runs: number;
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
        .order('repeat_fail_rate', { ascending: false })
        .limit(50);

      if (error) throw error;
      setStats((data as any[]) || []);
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  const toggleFreeze = async (stat: CompetencyPerf) => {
    const newFrozen = !stat.frozen;
    const { error } = await supabase
      .from('competency_performance_stats')
      .update({
        frozen: newFrozen,
        frozen_at: newFrozen ? new Date().toISOString() : null,
        frozen_by: newFrozen ? 'admin' : null,
      })
      .eq('id', stat.id);

    if (error) {
      toast.error('Fehler: ' + error.message);
    } else {
      toast.success(newFrozen ? 'Kompetenz eingefroren' : 'Kompetenz freigegeben');
      load();
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  const critical = stats.filter(s => s.fragility_level === 'critical' && !s.frozen);
  const fragile = stats.filter(s => s.fragility_level === 'fragile' && !s.frozen);
  const frozen = stats.filter(s => s.frozen);
  const stable = stats.filter(s => s.fragility_level === 'stable' && !s.frozen);
  const totalTrusted = stats.reduce((a, s) => a + (s.trusted_attempts || 0), 0);
  const totalAll = stats.reduce((a, s) => a + s.total_attempts, 0);
  const avgRepeatFail = stats.length > 0 ? stats.reduce((a, s) => a + (s.repeat_fail_rate || 0), 0) / stats.length : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Brain className="h-4 w-4" /> Mastery-Feedback-Loop & Trust Gates
        </h3>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1"><ShieldCheck className="h-3 w-3" /><span className="text-[10px] uppercase">Trusted</span></div>
            <p className="text-xl font-bold font-mono">{totalTrusted.toLocaleString('de-DE')}<span className="text-xs text-muted-foreground">/{totalAll.toLocaleString('de-DE')}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1"><Users className="h-3 w-3" /><span className="text-[10px] uppercase">Ø Learners</span></div>
            <p className="text-xl font-bold font-mono">{stats.length > 0 ? Math.round(stats.reduce((a, s) => a + (s.unique_learners || 0), 0) / stats.length) : 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1"><BarChart3 className="h-3 w-3" /><span className="text-[10px] uppercase">Ø Repeat-Fail</span></div>
            <p className={cn("text-xl font-bold font-mono", avgRepeatFail > 0.35 ? "text-destructive" : avgRepeatFail > 0.2 ? "text-yellow-600" : "text-emerald-600")}>{(avgRepeatFail * 100).toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Frozen */}
      {frozen.length > 0 && (
        <Card className="border-blue-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-blue-600">
              <Lock className="h-4 w-4" /> Eingefrorene Kompetenzen ({frozen.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {frozen.map((s) => (
                <CompetencyRow key={s.id} stat={s} onToggleFreeze={() => toggleFreeze(s)} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Critical */}
      {critical.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <Flame className="h-4 w-4" /> Kritische Kompetenzen (repeat_fail &gt; 50%)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {critical.map((s) => (
                <CompetencyRow key={s.id} stat={s} onToggleFreeze={() => toggleFreeze(s)} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fragile */}
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
                <CompetencyRow key={s.id} stat={s} onToggleFreeze={() => toggleFreeze(s)} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stable */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-600" /> Stabile Kompetenzen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {stable.length} Kompetenzen stabil. {totalTrusted.toLocaleString('de-DE')} trusted von {totalAll.toLocaleString('de-DE')} Antworten.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function CompetencyRow({ stat, onToggleFreeze }: { stat: CompetencyPerf; onToggleFreeze: () => void }) {
  const repeatPct = ((stat.repeat_fail_rate || 0) * 100).toFixed(1);
  const firstPct = ((stat.first_pass_fail_rate || 0) * 100).toFixed(1);
  const isCritical = stat.fragility_level === 'critical';
  const isFrozen = stat.frozen;

  return (
    <div className={cn("flex items-start gap-3 py-2 border-b border-border/30 last:border-0", isFrozen && "opacity-60")}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-xs font-mono text-foreground truncate">
            {stat.competency_id?.slice(0, 8) || stat.topic_key?.slice(0, 16) || '—'}
          </span>
          <Badge className={cn("text-[9px]", isCritical ? "bg-destructive-bg-subtle text-destructive" : isFrozen ? "bg-blue-500/20 text-blue-700" : "bg-yellow-500/20 text-yellow-700")}>
            {isFrozen ? '🔒 frozen' : `${repeatPct}% repeat-fail`}
          </Badge>
          {stat.unique_learners < 5 && (
            <Badge variant="outline" className="text-[9px] text-muted-foreground">⚠ {stat.unique_learners} Learner</Badge>
          )}
          {stat.trusted_attempts < 15 && (
            <Badge variant="outline" className="text-[9px] text-muted-foreground">⚠ {stat.trusted_attempts} trusted</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-24">
            <Progress value={100 - (stat.repeat_fail_rate || 0) * 100} className="h-1.5" />
          </div>
          <span className="text-[10px] text-muted-foreground">{stat.total_attempts} total</span>
          <span className="text-[10px] text-muted-foreground">{stat.trusted_attempts || 0} trusted</span>
          <span className="text-[10px] text-muted-foreground">1st: {firstPct}%</span>
          <span className="text-[10px] text-muted-foreground">rpt: {repeatPct}%</span>
        </div>
      </div>
      <Button variant="ghost" size="sm" className="text-[10px] h-7 px-2" onClick={onToggleFreeze}>
        {isFrozen ? '🔓 Freigeben' : '🔒 Freeze'}
      </Button>
    </div>
  );
}
