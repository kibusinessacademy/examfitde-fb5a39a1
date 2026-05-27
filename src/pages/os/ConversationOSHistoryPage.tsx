// ConversationOS — Session History + Mastery & Progression (Cut D)
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Trophy, Loader2, MessageSquare, Award, TrendingUp, TrendingDown, Minus, Target, Sparkles } from 'lucide-react';

type Tier = { label: string; min: number; color: string; icon: string };
const TIERS: Tier[] = [
  { label: 'Gold', min: 88, color: 'text-amber-500', icon: '🥇' },
  { label: 'Silber', min: 75, color: 'text-slate-400', icon: '🥈' },
  { label: 'Bronze', min: 60, color: 'text-orange-600', icon: '🥉' },
  { label: 'Lernend', min: 0, color: 'text-muted-foreground', icon: '○' },
];
const tierFor = (score: number) => TIERS.find((t) => score >= t.min) ?? TIERS[TIERS.length - 1];

export default function ConversationOSHistoryPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [certEligible, setCertEligible] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: sess }, { data: scen }, { data: deb }] = await Promise.all([
        supabase
          .from('conversation_os_sessions')
          .select('id, scenario_id, status, total_score, rubric_scores, painpoint_activation_counts, started_at, finished_at, turn_count, vertical_module, conversation_os_scenarios(title, vertical_module, persona, difficulty)')
          .order('started_at', { ascending: false })
          .limit(50),
        supabase
          .from('conversation_os_scenarios')
          .select('id, title, persona, difficulty, scenario_kind, short_pitch')
          .eq('status', 'published')
          .eq('vertical_module', 'hr_interview'),
        supabase
          .from('conversation_os_debriefs')
          .select('certificate_eligible', { count: 'exact', head: false })
          .eq('certificate_eligible', true),
      ]);
      if (sess) setSessions(sess);
      if (scen) setScenarios(scen);
      setCertEligible(deb?.length ?? 0);
      setLoading(false);
    })();
  }, []);

  // ---- Mastery per dimension (avg + tier + trend) ----
  const masteryAvgs = useMemo(() => {
    const dims: Record<string, number[]> = {};
    const completed = sessions.filter((s) => s.status === 'completed');
    for (const s of completed) {
      const rs = (s.rubric_scores ?? {}) as Record<string, number>;
      for (const [d, v] of Object.entries(rs)) {
        if (typeof v === 'number') (dims[d] ??= []).push(v);
      }
    }
    return Object.entries(dims)
      .map(([dim, scores]) => {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const last3 = scores.slice(0, 3);
        const prev3 = scores.slice(3, 6);
        const trend = last3.length && prev3.length
          ? last3.reduce((a, b) => a + b, 0) / last3.length - prev3.reduce((a, b) => a + b, 0) / prev3.length
          : 0;
        return { dim, avg, n: scores.length, trend, tier: tierFor(avg) };
      })
      .sort((a, b) => b.avg - a.avg);
  }, [sessions]);

  // ---- Per-Painpoint mastery (avg score across sessions where painpoint was activated) ----
  const painpointMastery = useMemo(() => {
    const map: Record<string, { scores: number[]; activations: number }> = {};
    for (const s of sessions.filter((x) => x.status === 'completed' && typeof x.total_score === 'number')) {
      const counts = (s.painpoint_activation_counts ?? {}) as Record<string, number>;
      for (const [pp, c] of Object.entries(counts)) {
        if (!c) continue;
        (map[pp] ??= { scores: [], activations: 0 });
        map[pp].scores.push(Number(s.total_score));
        map[pp].activations += Number(c);
      }
    }
    return Object.entries(map)
      .map(([pp, v]) => ({
        painpoint: pp,
        avg: v.scores.reduce((a, b) => a + b, 0) / v.scores.length,
        activations: v.activations,
        sessions: v.scores.length,
      }))
      .sort((a, b) => a.avg - b.avg); // weakest first
  }, [sessions]);

  // ---- Overall stats ----
  const stats = useMemo(() => {
    const completed = sessions.filter((s) => s.status === 'completed' && typeof s.total_score === 'number');
    const overall = completed.length
      ? completed.reduce((a, s) => a + Number(s.total_score), 0) / completed.length
      : 0;
    // Streak: consecutive sessions (latest first) where score >= 70
    let streak = 0;
    for (const s of completed) {
      if (Number(s.total_score) >= 70) streak++;
      else break;
    }
    return { totalSessions: sessions.length, completed: completed.length, overall, streak, tier: tierFor(overall) };
  }, [sessions]);

  // ---- Recommendation: scenario matching weakest competency_theme ----
  const recommendation = useMemo(() => {
    const weakest = masteryAvgs[masteryAvgs.length - 1];
    if (!weakest || !scenarios.length) return null;
    const playedIds = new Set(sessions.map((s) => s.scenario_id));
    const candidates = scenarios.filter((s) => !playedIds.has(s.id));
    const pool = candidates.length ? candidates : scenarios;
    // Difficulty preference: if overall <70 → easy; <85 → medium; else hard
    const targetDiff = stats.overall < 70 ? 'easy' : stats.overall < 85 ? 'medium' : 'hard';
    const ranked = [...pool].sort((a, b) => (a.difficulty === targetDiff ? -1 : 1) - (b.difficulty === targetDiff ? -1 : 1));
    return { scenario: ranked[0], weakDim: weakest.dim, targetDiff };
  }, [masteryAvgs, scenarios, sessions, stats.overall]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/os/hr-interview"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="font-semibold">Trainings-Historie & Mastery</h1>
            <p className="text-xs text-muted-foreground">HR InterviewOS</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : sessions.length === 0 ? (
          <Card className="p-12 text-center space-y-4">
            <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="font-semibold">Noch keine Trainings absolviert</h2>
            <Link to="/os/hr-interview"><Button>Erstes Training starten</Button></Link>
          </Card>
        ) : (
          <>
            {/* Overall Mastery Header */}
            <Card className="border-primary/30 bg-gradient-to-br from-card to-accent/10">
              <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">Gesamt-Tier</div>
                  <div className={`text-2xl font-bold ${stats.tier.color} flex items-center gap-1`}>
                    <span>{stats.tier.icon}</span><span>{stats.tier.label}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Ø {Math.round(stats.overall)} Punkte</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Sessions</div>
                  <div className="text-2xl font-bold">{stats.completed}<span className="text-sm text-muted-foreground">/{stats.totalSessions}</span></div>
                  <div className="text-xs text-muted-foreground">abgeschlossen</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><Sparkles className="h-3 w-3" />Streak ≥70</div>
                  <div className="text-2xl font-bold text-primary">{stats.streak}</div>
                  <div className="text-xs text-muted-foreground">in Folge</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><Award className="h-3 w-3" />Zertifikate</div>
                  <div className="text-2xl font-bold text-amber-500">{certEligible}</div>
                  <div className="text-xs text-muted-foreground">qualifiziert</div>
                </div>
              </CardContent>
            </Card>

            {/* Recommendation */}
            {recommendation?.scenario && (
              <Card className="border-primary/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-primary" />Empfohlenes nächstes Training</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    Basierend auf deiner schwächsten Dimension: <span className="font-medium text-foreground capitalize">{recommendation.weakDim.replace(/_/g, ' ')}</span> · Schwierigkeit <span className="font-medium text-foreground">{recommendation.targetDiff}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{recommendation.scenario.title}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{recommendation.scenario.short_pitch}</div>
                    </div>
                    <Link to={`/os/hr-interview/run/${recommendation.scenario.id}`}>
                      <Button size="sm">Starten</Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Mastery per Dimension */}
            {masteryAvgs.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4" />Mastery pro Dimension</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {masteryAvgs.map((m) => (
                    <div key={m.dim} className="space-y-1">
                      <div className="flex justify-between items-center text-sm">
                        <div className="flex items-center gap-2">
                          <span className={m.tier.color}>{m.tier.icon}</span>
                          <span className="capitalize">{m.dim.replace(/_/g, ' ')}</span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1">{m.tier.label}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground text-xs">
                          {Math.abs(m.trend) >= 2 ? (
                            m.trend > 0 ? <span className="flex items-center gap-0.5 text-emerald-600"><TrendingUp className="h-3 w-3" />+{Math.round(m.trend)}</span>
                                        : <span className="flex items-center gap-0.5 text-destructive"><TrendingDown className="h-3 w-3" />{Math.round(m.trend)}</span>
                          ) : <span className="flex items-center gap-0.5"><Minus className="h-3 w-3" />stabil</span>}
                          <span>Ø {Math.round(m.avg)} · {m.n}</span>
                        </div>
                      </div>
                      <Progress value={m.avg} className="h-1.5" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Painpoint Mastery */}
            {painpointMastery.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Painpoint-Mastery</CardTitle>
                  <p className="text-xs text-muted-foreground">Schwächste zuerst — gezieltes Üben verbessert die Gesamt-Performance am schnellsten.</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {painpointMastery.slice(0, 8).map((p) => {
                    const t = tierFor(p.avg);
                    return (
                      <div key={p.painpoint} className="flex items-center justify-between p-2 border border-border rounded">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate flex items-center gap-1.5">
                            <span className={t.color}>{t.icon}</span>{p.painpoint}
                          </div>
                          <div className="text-xs text-muted-foreground">{p.sessions} Sessions · {p.activations}x aktiviert</div>
                        </div>
                        <div className="font-mono text-sm tabular-nums">{Math.round(p.avg)}</div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Sessions List */}
            <Card>
              <CardHeader><CardTitle className="text-base">Sessions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {sessions.map((s) => {
                  const t = typeof s.total_score === 'number' ? tierFor(Number(s.total_score)) : null;
                  return (
                    <Link key={s.id} to={s.status === 'completed' ? `/os/hr-interview/debrief/${s.id}` : `/os/hr-interview/run/${s.scenario_id}`}>
                      <div className="flex items-center justify-between p-3 border border-border rounded hover:bg-accent/30 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{s.conversation_os_scenarios?.title ?? 'Session'}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(s.started_at).toLocaleString('de-DE')} · {s.turn_count} Turns
                            {s.conversation_os_scenarios?.difficulty && ` · ${s.conversation_os_scenarios.difficulty}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {t && <span className={`text-base ${t.color}`} title={t.label}>{t.icon}</span>}
                          <Badge variant={s.status === 'completed' ? 'default' : 'outline'}>{s.status}</Badge>
                          {s.total_score && <span className="font-mono text-sm tabular-nums">{Math.round(s.total_score)}</span>}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
