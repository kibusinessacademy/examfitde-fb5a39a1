import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Loader2, Search, RefreshCw, Brain, Target, AlertTriangle,
  CheckCircle2, XCircle, Shield, Layers, BookOpen, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// ── Types ──
interface CurriculumBlueprintHealth {
  curriculum_id: string;
  title: string;
  beruf: string;
  total_blueprints: number;
  with_template: number;
  with_trap: number;
  with_diverse_types: number;
  non_isolated: number;
  cognitive_spread: Record<string, number>;
  exam_context_spread: Record<string, number>;
  avg_relevance: number;
  health_score: number;
  grade: 'elite' | 'acceptable' | 'weak' | 'critical';
  competency_count: number;
  coverage_ratio: number; // blueprints per competency
}

const GRADE_STYLES: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  elite: { label: 'Elite', icon: Shield, className: 'bg-success/20 text-success border-success/30' },
  acceptable: { label: 'OK', icon: CheckCircle2, className: 'bg-primary/20 text-primary border-primary/30' },
  weak: { label: 'Schwach', icon: AlertTriangle, className: 'bg-warning/20 text-warning border-warning/30' },
  critical: { label: 'Kritisch', icon: XCircle, className: 'bg-destructive/20 text-destructive border-destructive/30' },
};

const COGNITIVE_LABELS: Record<string, { label: string; color: string }> = {
  remember: { label: 'Erinnern', color: 'bg-blue-500/20 text-blue-400' },
  understand: { label: 'Verstehen', color: 'bg-cyan-500/20 text-cyan-400' },
  apply: { label: 'Anwenden', color: 'bg-green-500/20 text-green-400' },
  analyze: { label: 'Analysieren', color: 'bg-amber-500/20 text-amber-400' },
  evaluate: { label: 'Bewerten', color: 'bg-red-500/20 text-red-400' },
};

const CONTEXT_LABELS: Record<string, string> = {
  isolated_knowledge: 'Faktenwissen',
  applied_case: 'Anwendungsfall',
  multi_step_case: 'Mehrstufig',
  prioritization: 'Priorisierung',
  error_detection: 'Fehlersuche',
  documentation_analysis: 'Dokumentenanalyse',
  legal_evaluation: 'Rechtsbewertung',
  communication_scenario: 'Kommunikation',
};

export default function BlueprintHealthDashboard() {
  const [data, setData] = useState<CurriculumBlueprintHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      // Load all curricula with beruf
      const { data: curricula } = await (supabase as any).from('curricula')
        .select('id, title, beruf_id')
        .eq('status', 'frozen')
        .order('title');

      if (!curricula?.length) { setData([]); return; }

      // Load berufe
      const berufIds = [...new Set(curricula.map((c: any) => c.beruf_id).filter(Boolean))];
      const { data: berufe } = berufIds.length > 0
        ? await (supabase as any).from('berufe').select('id, bezeichnung_kurz').in('id', berufIds)
        : { data: [] };
      const berufMap = new Map((berufe || []).map((b: any) => [b.id, b.bezeichnung_kurz]));

      // Load all blueprints with relevant fields
      const currIds = curricula.map((c: any) => c.id);
      const { data: bps } = await (supabase as any).from('question_blueprints')
        .select('curriculum_id, cognitive_level, question_template, typical_exam_trap, exam_context_type, allowed_question_types, exam_relevance_score, trap_spec')
        .in('curriculum_id', currIds);

      // Load competency counts
      const { data: lfs } = await (supabase as any).from('learning_fields')
        .select('id, curriculum_id')
        .in('curriculum_id', currIds);
      const lfIds = (lfs || []).map((lf: any) => lf.id);
      const lfCurrMap = new Map<string, string>((lfs || []).map((lf: any) => [lf.id, lf.curriculum_id]));

      const { data: comps } = lfIds.length > 0
        ? await (supabase as any).from('competencies').select('id, learning_field_id').in('learning_field_id', lfIds)
        : { data: [] };

      const compCountByCurr: Record<string, number> = {};
      for (const c of (comps || []) as any[]) {
        const currId = lfCurrMap.get(c.learning_field_id);
        if (currId) compCountByCurr[currId] = (compCountByCurr[currId] || 0) + 1;
      }

      // Group blueprints by curriculum
      const bpsByCurr: Record<string, any[]> = {};
      for (const bp of (bps || [])) {
        if (!bpsByCurr[bp.curriculum_id]) bpsByCurr[bp.curriculum_id] = [];
        bpsByCurr[bp.curriculum_id].push(bp);
      }

      // Compute health per curriculum
      const results: CurriculumBlueprintHealth[] = curricula.map((c: any) => {
        const currBps = bpsByCurr[c.id] || [];
        const n = currBps.length;
        const compCount = compCountByCurr[c.id] || 0;

        if (n === 0) {
          return {
            curriculum_id: c.id,
            title: c.title,
            beruf: berufMap.get(c.beruf_id) || '—',
            total_blueprints: 0, with_template: 0, with_trap: 0, with_diverse_types: 0,
            non_isolated: 0, cognitive_spread: {}, exam_context_spread: {},
            avg_relevance: 0, health_score: 0, grade: 'critical' as const,
            competency_count: compCount, coverage_ratio: 0,
          };
        }

        const withTemplate = currBps.filter(b => b.question_template?.length > 10).length;
        const withTrap = currBps.filter(b => b.typical_exam_trap || (b.trap_spec && typeof b.trap_spec === 'object' && Object.keys(b.trap_spec).length > 0)).length;
        const withDiverse = currBps.filter(b => {
          const t = b.allowed_question_types || [];
          return t.length > 1 || (t.length === 1 && t[0] !== 'mc_single');
        }).length;
        const nonIsolated = currBps.filter(b => b.exam_context_type && b.exam_context_type !== 'isolated_knowledge').length;

        const cogSpread: Record<string, number> = {};
        const ctxSpread: Record<string, number> = {};
        let totalRel = 0;
        for (const b of currBps) {
          cogSpread[b.cognitive_level] = (cogSpread[b.cognitive_level] || 0) + 1;
          ctxSpread[b.exam_context_type || 'none'] = (ctxSpread[b.exam_context_type || 'none'] || 0) + 1;
          totalRel += b.exam_relevance_score || 0;
        }

        const templateScore = (withTemplate / n) * 25;
        const trapScore = (withTrap / n) * 20;
        const typeScore = (withDiverse / n) * 15;
        const contextScore = (nonIsolated / n) * 20;
        const cogDiv = Math.min(Object.keys(cogSpread).length / 5, 1) * 10;
        const ctxDiv = Math.min(Object.keys(ctxSpread).length / 6, 1) * 10;
        const health = Math.round(templateScore + trapScore + typeScore + contextScore + cogDiv + ctxDiv);
        const grade = health >= 85 ? 'elite' : health >= 70 ? 'acceptable' : health >= 50 ? 'weak' : 'critical';

        return {
          curriculum_id: c.id,
          title: c.title,
          beruf: berufMap.get(c.beruf_id) || '—',
          total_blueprints: n,
          with_template: withTemplate,
          with_trap: withTrap,
          with_diverse_types: withDiverse,
          non_isolated: nonIsolated,
          cognitive_spread: cogSpread,
          exam_context_spread: ctxSpread,
          avg_relevance: Math.round((totalRel / n) * 10) / 10,
          health_score: health,
          grade: grade as CurriculumBlueprintHealth['grade'],
          competency_count: compCount,
          coverage_ratio: compCount > 0 ? Math.round((n / compCount) * 10) / 10 : 0,
        };
      });

      setData(results.sort((a, b) => a.health_score - b.health_score));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = data.filter(d =>
    !filter || d.title.toLowerCase().includes(filter.toLowerCase()) || d.beruf.toLowerCase().includes(filter.toLowerCase())
  );

  // Aggregate stats
  const totalBps = data.reduce((s, d) => s + d.total_blueprints, 0);
  const eliteCount = data.filter(d => d.grade === 'elite').length;
  const criticalCount = data.filter(d => d.grade === 'critical').length;
  const avgHealth = data.length > 0 ? Math.round(data.reduce((s, d) => s + d.health_score, 0) / data.length) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Blueprint Health Dashboard
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Qualitäts-Transparenz für alle Blueprint-Definitionen
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
          Aktualisieren
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{totalBps.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Blueprints gesamt</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{avgHealth}%</div>
            <div className="text-xs text-muted-foreground">Ø Health Score</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-success">{eliteCount}</div>
            <div className="text-xs text-muted-foreground">Elite-Grade Curricula</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-destructive">{criticalCount}</div>
            <div className="text-xs text-muted-foreground">Kritische Curricula</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Suche nach Beruf oder Curriculum..."
          className="pl-10"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* List */}
      {!loading && filtered.map(item => {
        const style = GRADE_STYLES[item.grade];
        const Icon = style.icon;
        const isExpanded = expanded === item.curriculum_id;

        return (
          <Card
            key={item.curriculum_id}
            className={cn("cursor-pointer transition-all hover:shadow-md", isExpanded && "ring-1 ring-primary/30")}
            onClick={() => setExpanded(isExpanded ? null : item.curriculum_id)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-sm truncate">{item.beruf}</CardTitle>
                  <CardDescription className="text-xs truncate">{item.title}</CardDescription>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-lg font-bold">{item.health_score}</div>
                    <div className="text-[10px] text-muted-foreground">/100</div>
                  </div>
                  <Badge className={cn('text-xs', style.className)}>
                    <Icon className="h-3 w-3 mr-1" />
                    {style.label}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pb-3">
              {/* Quick Stats Bar */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                <span className="flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {item.total_blueprints} BPs
                </span>
                <span className="flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  {item.coverage_ratio}x/Komp.
                </span>
                <span className="flex items-center gap-1">
                  <BookOpen className="h-3 w-3" />
                  {item.with_template}/{item.total_blueprints} Templates
                </span>
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {item.with_trap}/{item.total_blueprints} Traps
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {item.non_isolated}/{item.total_blueprints} Praxisnah
                </span>
              </div>

              <Progress value={item.health_score} className="h-1.5" />

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="mt-4 space-y-4 border-t pt-4">
                  {/* Kognitive Progression */}
                  <div>
                    <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
                      <Brain className="h-3 w-3" />
                      Kognitive Progression (Bloom)
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {['remember', 'understand', 'apply', 'analyze', 'evaluate'].map(level => {
                        const count = item.cognitive_spread[level] || 0;
                        const pct = item.total_blueprints > 0 ? Math.round((count / item.total_blueprints) * 100) : 0;
                        const style = COGNITIVE_LABELS[level];
                        return (
                          <Badge key={level} variant="outline" className={cn('text-xs', style?.color)}>
                            {style?.label}: {count} ({pct}%)
                          </Badge>
                        );
                      })}
                    </div>
                  </div>

                  {/* Prüfungskontext-Typen */}
                  <div>
                    <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
                      <Target className="h-3 w-3" />
                      Prüfungskontext-Verteilung
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(item.exam_context_spread)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .map(([ctx, count]) => (
                          <Badge key={ctx} variant="outline" className="text-xs">
                            {CONTEXT_LABELS[ctx] || ctx}: {count as number}
                          </Badge>
                        ))}
                    </div>
                  </div>

                  {/* Mastery-Kopplung */}
                  <div>
                    <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
                      <Shield className="h-3 w-3" />
                      Mastery-Tiefe pro Kompetenz
                    </h4>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="p-2 rounded bg-muted/50">
                        <div className="font-medium">{item.coverage_ratio}x</div>
                        <div className="text-muted-foreground">BPs pro Kompetenz</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <div className="font-medium">{item.avg_relevance}/5</div>
                        <div className="text-muted-foreground">Ø Prüfungsrelevanz</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <div className="font-medium">{item.with_diverse_types}</div>
                        <div className="text-muted-foreground">Multi-Typ BPs</div>
                      </div>
                    </div>
                    {item.coverage_ratio < 3 && (
                      <p className="text-xs text-warning mt-2">
                        ⚠ Unter 3 Blueprints pro Kompetenz — Recall/Transfer/Praxisfall-Abdeckung unvollständig
                      </p>
                    )}
                  </div>

                  {/* Red Flags */}
                  {(item.with_template < item.total_blueprints * 0.9 || 
                    item.with_trap < item.total_blueprints * 0.5 ||
                    item.non_isolated < item.total_blueprints * 0.5) && (
                    <div className="p-3 rounded bg-destructive/10 border border-destructive/20">
                      <h4 className="text-xs font-semibold text-destructive mb-1">🚨 Red Flags</h4>
                      <ul className="text-xs text-destructive/80 space-y-0.5">
                        {item.with_template < item.total_blueprints * 0.9 && (
                          <li>• {item.total_blueprints - item.with_template} Blueprints ohne Template</li>
                        )}
                        {item.with_trap < item.total_blueprints * 0.5 && (
                          <li>• {item.total_blueprints - item.with_trap} Blueprints ohne Prüfungsfallen</li>
                        )}
                        {item.non_isolated < item.total_blueprints * 0.5 && (
                          <li>• {item.total_blueprints - item.non_isolated} Blueprints nur Faktenwissen</li>
                        )}
                        {!item.cognitive_spread['evaluate'] && (
                          <li>• Keine Bewertungs-Blueprints (höchste kognitive Stufe fehlt)</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          Keine Curricula gefunden
        </div>
      )}
    </div>
  );
}
