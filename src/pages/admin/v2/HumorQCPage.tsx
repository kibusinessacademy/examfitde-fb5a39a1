import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, CheckCircle2, BarChart3, TrendingUp, List, Brain, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

// ── Types ──

type HumorQCRow = {
  certification_id: string;
  certification_title: string;
  total: number;
  approved_count: number;
  draft_count: number;
  rejected_count: number;
  avg_quality: number;
  pct_no_competence: number;
  pct_no_lesson: number;
  type_distribution: Record<string, number>;
  duplicate_suspect_count: number;
};

type KPIRow = {
  surface: string;
  humor_type: string;
  certification_id: string;
  certification_title: string;
  total_deliveries: number;
  unique_users: number;
  likes: number;
  dislikes: number;
  skips: number;
  shares: number;
  total_reactions: number;
  like_rate_pct: number;
  dislike_rate_pct: number;
  avg_deliveries_per_item: number;
};

type WeakItem = {
  id: string;
  text: string;
  humor_type: string;
  quality_score: number;
  status: string;
  certification_id: string;
};

// ── Constants ──

const TARGET = 365;

const TYPE_LABELS: Record<string, string> = {
  wordplay: 'Wortspiel',
  everyday_situation: 'Alltagssituation',
  exam_stress: 'Prüfungsstress',
  self_irony: 'Selbstironie',
  micro_tip: 'Micro-Tipp',
};

const SURFACE_LABELS: Record<string, string> = {
  lesson_intro: 'Lesson Intro',
  lesson_outro: 'Lesson Outro',
  minicheck_intro: 'MiniCheck Intro',
  minicheck_result: 'MiniCheck Result',
  tutor_reply: 'Tutor',
  dashboard: 'Dashboard',
  marketing: 'Marketing',
  exam_break: 'Exam Break',
};

// ── Sub-components ──

function OverviewTab({ data, isLoading }: { data: HumorQCRow[] | undefined; isLoading: boolean }) {
  const totalApproved = data?.reduce((s, r) => s + r.approved_count, 0) ?? 0;
  const totalDupes = data?.reduce((s, r) => s + r.duplicate_suspect_count, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground">Gesamt approved</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className="text-2xl font-bold">{totalApproved}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground">Zertifizierungen</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className="text-2xl font-bold">{data?.length ?? 0}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground">Ø Quality</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className="text-2xl font-bold">
              {data && data.length > 0
                ? (data.reduce((s, r) => s + (r.avg_quality ?? 0), 0) / data.length).toFixed(1)
                : '–'}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Dubletten
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className={`text-2xl font-bold ${totalDupes > 0 ? 'text-destructive' : ''}`}>
              {totalDupes}
            </span>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Lade QC-Daten…</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zertifizierung</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Ziel</TableHead>
                  <TableHead>Fortschritt</TableHead>
                  <TableHead className="text-right">Ø Score</TableHead>
                  <TableHead className="text-right">Dubletten</TableHead>
                  <TableHead className="text-right">% ohne Kompetenz</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map(row => {
                  const pct = Math.min(100, Math.round((row.approved_count / TARGET) * 100));
                  const healthy = row.approved_count >= TARGET && row.duplicate_suspect_count === 0;
                  return (
                    <TableRow key={row.certification_id}>
                      <TableCell className="font-medium text-sm max-w-[200px] truncate">
                        {healthy ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline mr-1" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 inline mr-1" />
                        )}
                        {row.certification_title ?? row.certification_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.approved_count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{TARGET}</TableCell>
                      <TableCell className="w-32">
                        <Progress value={pct} className="h-2" />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.avg_quality}</TableCell>
                      <TableCell className="text-right">
                        {row.duplicate_suspect_count > 0 ? (
                          <Badge variant="destructive" className="text-xs">{row.duplicate_suspect_count}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.pct_no_competence}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4" /> Typ-Verteilung (approved)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.map(row => (
                <div key={row.certification_id}>
                  <p className="text-xs font-medium mb-1 truncate">
                    {row.certification_title ?? row.certification_id.slice(0, 8)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(row.type_distribution || {}).map(([type, count]) => (
                      <Badge key={type} variant="secondary" className="text-[10px]">
                        {TYPE_LABELS[type] ?? type}: {count as number}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KPITab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'humor-kpi'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_humor_delivery_kpi' as any)
        .select('*');
      if (error) throw error;
      return (data ?? []) as unknown as KPIRow[];
    },
  });

  const totalDeliveries = data?.reduce((s, r) => s + r.total_deliveries, 0) ?? 0;
  const totalLikes = data?.reduce((s, r) => s + r.likes, 0) ?? 0;
  const totalReactions = data?.reduce((s, r) => s + r.total_reactions, 0) ?? 0;
  const overallLikeRate = totalReactions > 0 ? Math.round((totalLikes / totalReactions) * 100) : 0;

  if (isLoading) return <p className="text-sm text-muted-foreground">Lade KPI-Daten…</p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">Noch keine Delivery-Daten vorhanden.</p>;

  // Group by surface
  const bySurface = new Map<string, KPIRow[]>();
  for (const row of data) {
    const arr = bySurface.get(row.surface) || [];
    arr.push(row);
    bySurface.set(row.surface, arr);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground">Total Deliveries</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className="text-2xl font-bold">{totalDeliveries.toLocaleString()}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground">Like Rate</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className="text-2xl font-bold">{overallLikeRate}%</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground">Unique Users</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className="text-2xl font-bold">
              {new Set(data.flatMap(r => r.unique_users)).size || data.reduce((max, r) => Math.max(max, r.unique_users), 0)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground">Surfaces aktiv</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className="text-2xl font-bold">{bySurface.size}</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Performance nach Surface</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Surface</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead className="text-right">Deliveries</TableHead>
                <TableHead className="text-right">👍</TableHead>
                <TableHead className="text-right">👎</TableHead>
                <TableHead className="text-right">Like %</TableHead>
                <TableHead className="text-right">Ø pro Item</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm">
                    <Badge variant="outline" className="text-[10px]">
                      {SURFACE_LABELS[row.surface] ?? row.surface}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {TYPE_LABELS[row.humor_type] ?? row.humor_type}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.total_deliveries}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.likes}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.dislikes}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={row.like_rate_pct >= 70 ? 'text-green-600' : row.like_rate_pct < 40 ? 'text-destructive' : ''}>
                      {row.like_rate_pct}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.avg_deliveries_per_item}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DrilldownTab() {
  const { data: weakItems, isLoading: weakLoading } = useQuery({
    queryKey: ['admin', 'humor-weak-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('humor_items' as any)
        .select('id, text, humor_type, quality_score, status, certification_id')
        .in('status', ['approved', 'draft'])
        .not('quality_score', 'is', null)
        .order('quality_score', { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as WeakItem[];
    },
  });

  const { data: noContext, isLoading: noCtxLoading } = useQuery({
    queryKey: ['admin', 'humor-no-context'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('humor_items' as any)
        .select('id, text, humor_type, status, certification_id')
        .is('competence_id', null)
        .is('lesson_id', null)
        .in('status', ['approved', 'draft'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as WeakItem[];
    },
  });

  const { data: reviewQueue, isLoading: reviewLoading } = useQuery({
    queryKey: ['admin', 'humor-review-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('humor_items' as any)
        .select('id, text, humor_type, quality_score, status, certification_id')
        .eq('status', 'draft')
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as WeakItem[];
    },
  });

  const isLoading = weakLoading || noCtxLoading || reviewLoading;

  if (isLoading) return <p className="text-sm text-muted-foreground">Lade Drilldown-Daten…</p>;

  return (
    <div className="space-y-6">
      {/* Weak items */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Schwächste Items (nach Quality Score)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Text</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weakItems?.slice(0, 20).map(item => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm max-w-[300px] truncate">{item.text}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {TYPE_LABELS[item.humor_type] ?? item.humor_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={Number(item.quality_score) < 65 ? 'text-destructive font-medium' : ''}>
                      {item.quality_score}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'approved' ? 'default' : 'secondary'} className="text-[10px]">
                      {item.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(!weakItems || weakItems.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-muted-foreground text-center py-4">
                    Keine Items mit Quality Score gefunden
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Items without context */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <List className="h-4 w-4" /> Items ohne Kompetenz- / Lesson-Zuordnung
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Text</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {noContext?.slice(0, 20).map(item => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm max-w-[300px] truncate">{item.text}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {TYPE_LABELS[item.humor_type] ?? item.humor_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{item.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(!noContext || noContext.length === 0) && (
                <TableRow>
                  <TableCell colSpan={3} className="text-sm text-muted-foreground text-center py-4">
                    Alle Items haben Kontext-Zuordnung ✓
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Review queue */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Review-Queue (Drafts)
            {reviewQueue && reviewQueue.length > 0 && (
              <Badge variant="secondary" className="text-[10px] ml-1">{reviewQueue.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Text</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead className="text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviewQueue?.slice(0, 20).map(item => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm max-w-[300px] truncate">{item.text}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {TYPE_LABELS[item.humor_type] ?? item.humor_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.quality_score ?? '–'}
                  </TableCell>
                </TableRow>
              ))}
              {(!reviewQueue || reviewQueue.length === 0) && (
                <TableRow>
                  <TableCell colSpan={3} className="text-sm text-muted-foreground text-center py-4">
                    Keine Drafts in der Queue
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Learning Impact Tab ──

type ImpactRow = { saw_humor: number; total_pairs: number; completed_count?: number; completion_rate_pct?: number; started_count?: number; start_rate_pct?: number };
type TutorImpactRow = { has_humor: number; total_sessions: number; avg_messages: number; engaged_sessions: number; engagement_rate_pct: number };
type RecoveryRow = { saw_humor: number; total_users: number; retried_count: number; retry_rate_pct: number };

function LiftIndicator({ withHumor, withoutHumor }: { withHumor: number; withoutHumor: number }) {
  const lift = withHumor - withoutHumor;
  if (Math.abs(lift) < 0.5) return <span className="text-muted-foreground flex items-center gap-0.5"><Minus className="h-3 w-3" /> ±0</span>;
  if (lift > 0) return <span className="text-success flex items-center gap-0.5"><ArrowUpRight className="h-3 w-3" /> +{lift.toFixed(1)}%</span>;
  return <span className="text-destructive flex items-center gap-0.5"><ArrowDownRight className="h-3 w-3" /> {lift.toFixed(1)}%</span>;
}

function ImpactCard({ title, withHumor, withoutHumor, metricLabel }: { title: string; withHumor: number; withoutHumor: number; metricLabel: string }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Mit Humor</span>
          <span className="font-bold tabular-nums">{withHumor.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Ohne Humor</span>
          <span className="font-bold tabular-nums">{withoutHumor.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between text-sm pt-1 border-t border-border">
          <span className="text-muted-foreground">{metricLabel}</span>
          <LiftIndicator withHumor={withHumor} withoutHumor={withoutHumor} />
        </div>
      </CardContent>
    </Card>
  );
}

function LearningImpactTab() {
  const { data: lessonImpact, isLoading: l1 } = useQuery({
    queryKey: ['admin', 'humor-impact-lesson'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_humor_lesson_impact' as any).select('*');
      if (error) throw error;
      return (data ?? []) as unknown as ImpactRow[];
    },
  });

  const { data: mcImpact, isLoading: l2 } = useQuery({
    queryKey: ['admin', 'humor-impact-minicheck'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_humor_minicheck_impact' as any).select('*');
      if (error) throw error;
      return (data ?? []) as unknown as ImpactRow[];
    },
  });

  const { data: tutorImpact, isLoading: l3 } = useQuery({
    queryKey: ['admin', 'humor-impact-tutor'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_humor_tutor_impact' as any).select('*');
      if (error) throw error;
      return (data ?? []) as unknown as TutorImpactRow[];
    },
  });

  const { data: recoveryImpact, isLoading: l4 } = useQuery({
    queryKey: ['admin', 'humor-impact-recovery'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_humor_recovery_impact' as any).select('*');
      if (error) throw error;
      return (data ?? []) as unknown as RecoveryRow[];
    },
  });

  if (l1 || l2 || l3 || l4) return <p className="text-sm text-muted-foreground">Lade Impact-Daten…</p>;

  const getRate = (rows: ImpactRow[] | undefined, field: 'completion_rate_pct' | 'start_rate_pct', humor: number) =>
    Number(rows?.find(r => r.saw_humor === humor)?.[field] ?? 0);

  const lessonWith = getRate(lessonImpact, 'completion_rate_pct', 1);
  const lessonWithout = getRate(lessonImpact, 'completion_rate_pct', 0);
  const mcWith = getRate(mcImpact, 'start_rate_pct', 1);
  const mcWithout = getRate(mcImpact, 'start_rate_pct', 0);

  const tutorWith = Number(tutorImpact?.find(r => r.has_humor === 1)?.engagement_rate_pct ?? 0);
  const tutorWithout = Number(tutorImpact?.find(r => r.has_humor === 0)?.engagement_rate_pct ?? 0);

  const recovWith = Number(recoveryImpact?.find(r => r.saw_humor === 1)?.retry_rate_pct ?? 0);
  const recovWithout = Number(recoveryImpact?.find(r => r.saw_humor === 0)?.retry_rate_pct ?? 0);

  const hasAnyData = (lessonImpact?.length ?? 0) > 0 || (mcImpact?.length ?? 0) > 0 || (tutorImpact?.length ?? 0) > 0 || (recoveryImpact?.length ?? 0) > 0;

  if (!hasAnyData) return <p className="text-sm text-muted-foreground">Noch keine Impact-Daten vorhanden. Daten werden gesammelt, sobald Humor ausgespielt wird.</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Vergleich: Lernverhalten mit vs. ohne Humor-Exposure. Positive Werte = Humor verbessert das Verhalten.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ImpactCard title="📈 Lesson Completion" withHumor={lessonWith} withoutHumor={lessonWithout} metricLabel="Lift" />
        <ImpactCard title="⚡ MiniCheck Start" withHumor={mcWith} withoutHumor={mcWithout} metricLabel="Lift" />
        <ImpactCard title="🤖 Tutor Engagement" withHumor={tutorWith} withoutHumor={tutorWithout} metricLabel="Lift" />
        <ImpactCard title="💚 Recovery nach Fehler" withHumor={recovWith} withoutHumor={recovWithout} metricLabel="Lift" />
      </div>

      {/* Detail tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(lessonImpact?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Lesson Completion Detail</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Humor</TableHead><TableHead className="text-right">Paare</TableHead><TableHead className="text-right">Completed</TableHead><TableHead className="text-right">Rate</TableHead></TableRow></TableHeader>
                <TableBody>
                  {lessonImpact?.map(r => (
                    <TableRow key={r.saw_humor}>
                      <TableCell>{r.saw_humor ? '✓ Ja' : '✗ Nein'}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.total_pairs}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.completed_count}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{r.completion_rate_pct}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        {(mcImpact?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">MiniCheck Start Detail</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Humor</TableHead><TableHead className="text-right">Paare</TableHead><TableHead className="text-right">Gestartet</TableHead><TableHead className="text-right">Rate</TableHead></TableRow></TableHeader>
                <TableBody>
                  {mcImpact?.map(r => (
                    <TableRow key={r.saw_humor}>
                      <TableCell>{r.saw_humor ? '✓ Ja' : '✗ Nein'}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.total_pairs}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.started_count}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{r.start_rate_pct}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──

export default function HumorQCPage() {
  const [tab, setTab] = useState('overview');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'humor-qc'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_admin_humor_qc' as any)
        .select('*');
      if (error) throw error;
      return (data ?? []) as unknown as HumorQCRow[];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/command"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" /> Leitstelle
        </Link>
        <h1 className="text-xl font-bold">Humor QC Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Bestandsübersicht, Delivery-KPIs & Qualitätskontrolle
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Bestand
          </TabsTrigger>
          <TabsTrigger value="kpi" className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> KPIs
          </TabsTrigger>
          <TabsTrigger value="drilldown" className="gap-1.5">
            <List className="h-3.5 w-3.5" /> Drilldown
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab data={data} isLoading={isLoading} />
        </TabsContent>

        <TabsContent value="kpi">
          <KPITab />
        </TabsContent>

        <TabsContent value="drilldown">
          <DrilldownTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
