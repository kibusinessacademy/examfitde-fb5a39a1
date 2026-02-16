import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { BarChart3, Target, AlertTriangle, TrendingUp, BookOpen, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExamKPIs {
  totalQuestions: number;
  examPool: number;
  trainingPool: number;
  avgPraxisScore: number;
  difficultyBreakdown: Record<string, number>;
  lowDiscrimination: number;
  topDiscrimination: number;
  duplicateRate: number;
  errorClusters: { competency_id: string; error_rate: number; attempts: number }[];
}

export default function ExamQualityTab() {
  const [kpis, setKpis] = useState<ExamKPIs | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadKPIs();
  }, []);

  async function loadKPIs() {
    const sb = supabase as any;

    const [totalRes, examRes, trainingRes, diffRes, discrimRes, clusterRes] = await Promise.all([
      sb.from('exam_questions').select('id', { count: 'exact', head: true }),
      sb.from('exam_questions').select('id', { count: 'exact', head: true }).in('status', ['approved', 'draft']),
      sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('status', 'training'),
      sb.from('exam_questions').select('difficulty').limit(5000),
      sb.from('question_discrimination_stats').select('discrimination_index').order('discrimination_index', { ascending: true }).limit(500),
      sb.from('question_attempts').select('question_id, is_correct').limit(10000),
    ]);

    const difficulties = diffRes.data || [];
    const diffBreakdown: Record<string, number> = {};
    for (const d of difficulties) {
      const key = d.difficulty || 'unknown';
      diffBreakdown[key] = (diffBreakdown[key] || 0) + 1;
    }

    const discrimData = discrimRes.data || [];
    const lowDisc = discrimData.filter((d: any) => d.discrimination_index < 0.20).length;
    const topDisc = discrimData.filter((d: any) => d.discrimination_index >= 0.40).length;

    // Error clusters from attempts
    const attemptsByComp: Record<string, { correct: number; total: number }> = {};
    for (const a of (clusterRes.data || [])) {
      if (!attemptsByComp[a.question_id]) attemptsByComp[a.question_id] = { correct: 0, total: 0 };
      attemptsByComp[a.question_id].total++;
      if (a.is_correct) attemptsByComp[a.question_id].correct++;
    }
    const errorClusters = Object.entries(attemptsByComp)
      .map(([qid, s]) => ({ competency_id: qid, error_rate: 1 - s.correct / s.total, attempts: s.total }))
      .filter(c => c.attempts >= 5)
      .sort((a, b) => b.error_rate - a.error_rate)
      .slice(0, 10);

    setKpis({
      totalQuestions: totalRes.count || 0,
      examPool: examRes.count || 0,
      trainingPool: trainingRes.count || 0,
      avgPraxisScore: 0,
      difficultyBreakdown: diffBreakdown,
      lowDiscrimination: lowDisc,
      topDiscrimination: topDisc,
      duplicateRate: 0,
      errorClusters,
    });
    setLoading(false);
  }

  if (loading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />)}</div>;
  if (!kpis) return null;

  const examPct = kpis.totalQuestions > 0 ? Math.round((kpis.examPool / kpis.totalQuestions) * 100) : 0;
  const total = Object.values(kpis.difficultyBreakdown).reduce((s, v) => s + v, 0) || 1;

  return (
    <div className="space-y-4">
      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card><CardContent className="pt-3 pb-2.5 px-3">
          <p className="text-[10px] text-muted-foreground uppercase">Gesamt Fragen</p>
          <p className="text-xl font-bold">{kpis.totalQuestions.toLocaleString()}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3">
          <p className="text-[10px] text-muted-foreground uppercase">Exam Pool</p>
          <p className={cn("text-xl font-bold", examPct >= 40 ? "text-emerald-600" : "text-amber-600")}>{examPct}%</p>
          <p className="text-[9px] text-muted-foreground">{kpis.examPool} exam / {kpis.trainingPool} training</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3">
          <p className="text-[10px] text-muted-foreground uppercase">Trennschärfe ↓</p>
          <p className={cn("text-xl font-bold", kpis.lowDiscrimination > 10 ? "text-destructive" : "text-emerald-600")}>{kpis.lowDiscrimination}</p>
          <p className="text-[9px] text-muted-foreground">Fragen mit Index &lt; 0.20</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2.5 px-3">
          <p className="text-[10px] text-muted-foreground uppercase">Top Trennschärfe</p>
          <p className="text-xl font-bold text-emerald-600">{kpis.topDiscrimination}</p>
          <p className="text-[9px] text-muted-foreground">Fragen mit Index ≥ 0.40</p>
        </CardContent></Card>
      </div>

      {/* Difficulty Distribution */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> Difficulty-Verteilung</CardTitle>
          <CardDescription>Ziel: 25% easy, 35% medium, 25% hard, 15% very hard</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {["easy", "medium", "hard", "very_hard"].map(d => {
              const count = kpis.difficultyBreakdown[d] || 0;
              const pct = Math.round((count / total) * 100);
              const target = d === "easy" ? 25 : d === "medium" ? 35 : d === "hard" ? 25 : 15;
              const deviation = Math.abs(pct - target);
              return (
                <div key={d} className="flex items-center gap-3">
                  <span className="text-xs w-20 font-medium">{d}</span>
                  <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", deviation > 10 ? "bg-amber-500" : "bg-primary")}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs w-16 text-right font-mono">{pct}% <span className="text-muted-foreground">({count})</span></span>
                  <Badge variant="outline" className={cn("text-[9px]", deviation > 10 ? "border-amber-500 text-amber-600" : "border-emerald-500 text-emerald-600")}>
                    Ziel: {target}%
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Error Clusters */}
      {kpis.errorClusters.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Top Fehler-Cluster</CardTitle>
            <CardDescription>Fragen mit höchster Fehlerrate (≥ 5 Versuche)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {kpis.errorClusters.map((c, i) => (
                <div key={i} className="flex items-center gap-3 text-sm border-b border-border/30 pb-1.5">
                  <span className="font-mono text-xs text-muted-foreground w-20 truncate">{c.competency_id.slice(0, 8)}</span>
                  <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-destructive/70 rounded-full" style={{ width: `${Math.round(c.error_rate * 100)}%` }} />
                  </div>
                  <span className={cn("text-xs font-bold w-12 text-right", c.error_rate > 0.7 ? "text-destructive" : "text-amber-600")}>{Math.round(c.error_rate * 100)}%</span>
                  <span className="text-[10px] text-muted-foreground">{c.attempts} Versuche</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
