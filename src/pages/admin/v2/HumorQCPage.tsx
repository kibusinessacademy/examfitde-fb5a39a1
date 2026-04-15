import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, AlertTriangle, CheckCircle2, BarChart3, TrendingUp, List, Brain,
  ArrowUpRight, ArrowDownRight, Minus, Sparkles, Upload, Wand2, RefreshCw,
  FileUp, Loader2, Download, Shield, Zap, Eye
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import ReactMarkdown from 'react-markdown';

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
  tutor: 'Tutor',
  dashboard: 'Dashboard',
  marketing: 'Marketing',
  exam_break: 'Exam Break',
};

// ── AI Hook ──

function useAiAssistant() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { toast } = useToast();

  const invoke = useCallback(async (role: string, action: string, context: string) => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-ai-assistant', {
        body: { role, action, context },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data?.result ?? '');
      return data?.result ?? '';
    } catch (e: any) {
      toast({ title: 'KI-Fehler', description: e.message, variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return { invoke, loading, result, setResult };
}

// ── AI Result Dialog ──

function AiResultDialog({ open, onOpenChange, title, result, loading }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; result: string | null; loading: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> {title}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> <span className="text-sm text-muted-foreground">KI analysiert…</span>
          </div>
        ) : result ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{result}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">Kein Ergebnis</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Overview Tab ──

function OverviewTab({ data, isLoading }: { data: HumorQCRow[] | undefined; isLoading: boolean }) {
  const ai = useAiAssistant();
  const [showAi, setShowAi] = useState(false);

  const totalApproved = data?.reduce((s, r) => s + r.approved_count, 0) ?? 0;
  const totalDraft = data?.reduce((s, r) => s + r.draft_count, 0) ?? 0;
  const totalRejected = data?.reduce((s, r) => s + r.rejected_count, 0) ?? 0;
  const totalDupes = data?.reduce((s, r) => s + r.duplicate_suspect_count, 0) ?? 0;
  const avgQuality = data && data.length > 0
    ? (data.reduce((s, r) => s + (r.avg_quality ?? 0), 0) / data.length).toFixed(1) : '–';
  const coveragePct = data && data.length > 0
    ? Math.round((data.filter(r => r.approved_count >= TARGET).length / data.length) * 100) : 0;

  const handleAiAnalyze = async () => {
    setShowAi(true);
    const ctx = JSON.stringify({
      totalApproved, totalDraft, totalRejected, totalDupes, avgQuality, coveragePct,
      certifications: data?.map(r => ({
        title: r.certification_title,
        approved: r.approved_count,
        target: TARGET,
        quality: r.avg_quality,
        dupes: r.duplicate_suspect_count,
        noCompetence: r.pct_no_competence,
        typeDistribution: r.type_distribution,
      })),
    });
    await ai.invoke('humor_qc', 'analyze_quality', ctx);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Bestandsübersicht</h3>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={handleAiAnalyze} disabled={ai.loading || isLoading}>
          {ai.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          KI-Qualitätsanalyse
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card><CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Approved</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><span className="text-2xl font-bold text-green-600">{totalApproved}</span></CardContent></Card>
        <Card><CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Drafts</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><span className="text-2xl font-bold text-amber-500">{totalDraft}</span></CardContent></Card>
        <Card><CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Rejected</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><span className="text-2xl font-bold text-destructive">{totalRejected}</span></CardContent></Card>
        <Card><CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Ø Quality</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><span className="text-2xl font-bold">{avgQuality}</span></CardContent></Card>
        <Card><CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Dubletten</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><span className={`text-2xl font-bold ${totalDupes > 0 ? 'text-destructive' : ''}`}>{totalDupes}</span></CardContent></Card>
        <Card><CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Coverage</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><span className="text-2xl font-bold">{coveragePct}%</span></CardContent></Card>
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
                  <TableHead className="text-right">Drafts</TableHead>
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
                        {healthy ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline mr-1" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500 inline mr-1" />}
                        {row.certification_title ?? row.certification_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-green-600">{row.approved_count}</TableCell>
                      <TableCell className="text-right tabular-nums text-amber-500">{row.draft_count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{TARGET}</TableCell>
                      <TableCell className="w-32">
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-2 flex-1" />
                          <span className="text-xs tabular-nums text-muted-foreground w-8">{pct}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.avg_quality}</TableCell>
                      <TableCell className="text-right">
                        {row.duplicate_suspect_count > 0 ? <Badge variant="destructive" className="text-xs">{row.duplicate_suspect_count}</Badge> : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{row.pct_no_competence}%</TableCell>
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
            <CardTitle className="text-sm flex items-center gap-1.5"><BarChart3 className="h-4 w-4" /> Typ-Verteilung (approved)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.map(row => (
                <div key={row.certification_id}>
                  <p className="text-xs font-medium mb-1 truncate">{row.certification_title ?? row.certification_id.slice(0, 8)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(row.type_distribution || {}).map(([type, count]) => (
                      <Badge key={type} variant="secondary" className="text-[10px]">{TYPE_LABELS[type] ?? type}: {count as number}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AiResultDialog open={showAi} onOpenChange={setShowAi} title="KI-Qualitätsanalyse" result={ai.result} loading={ai.loading} />
    </div>
  );
}

// ── KPI Tab ──

function KPITab() {
  const ai = useAiAssistant();
  const [showAi, setShowAi] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'humor-kpi'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_humor_delivery_kpi' as any).select('*');
      if (error) throw error;
      return (data ?? []) as unknown as KPIRow[];
    },
  });

  const totalDeliveries = data?.reduce((s, r) => s + r.total_deliveries, 0) ?? 0;
  const totalLikes = data?.reduce((s, r) => s + r.likes, 0) ?? 0;
  const totalDislikes = data?.reduce((s, r) => s + r.dislikes, 0) ?? 0;
  const totalReactions = data?.reduce((s, r) => s + r.total_reactions, 0) ?? 0;
  const overallLikeRate = totalReactions > 0 ? Math.round((totalLikes / totalReactions) * 100) : 0;
  const bySurface = new Map<string, KPIRow[]>();
  for (const row of data ?? []) {
    const arr = bySurface.get(row.surface) || [];
    arr.push(row);
    bySurface.set(row.surface, arr);
  }

  const handleRetentionAnalysis = async () => {
    setShowAi(true);
    await ai.invoke('humor_qc', 'retention_analysis', JSON.stringify({
      totalDeliveries, totalLikes, totalDislikes, overallLikeRate,
      surfaces: Array.from(bySurface.entries()).map(([s, rows]) => ({
        surface: s,
        deliveries: rows.reduce((a, r) => a + r.total_deliveries, 0),
        likeRate: rows.length > 0 ? Math.round(rows.reduce((a, r) => a + r.like_rate_pct, 0) / rows.length) : 0,
        types: rows.map(r => ({ type: r.humor_type, likes: r.likes, dislikes: r.dislikes, likeRate: r.like_rate_pct })),
      })),
    }));
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Lade KPI-Daten…</p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">Noch keine Delivery-Daten vorhanden.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Delivery KPIs</h3>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={handleRetentionAnalysis} disabled={ai.loading}>
          {ai.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
          KI-Retention-Analyse
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Total Deliveries</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><span className="text-2xl font-bold">{totalDeliveries.toLocaleString()}</span></CardContent></Card>
        <Card><CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Like Rate</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><span className={`text-2xl font-bold ${overallLikeRate >= 70 ? 'text-green-600' : overallLikeRate < 40 ? 'text-destructive' : 'text-amber-500'}`}>{overallLikeRate}%</span></CardContent></Card>
        <Card><CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Unique Users</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><span className="text-2xl font-bold">{data.reduce((max, r) => Math.max(max, r.unique_users), 0)}</span></CardContent></Card>
        <Card><CardHeader className="pb-1 pt-3 px-3"><CardTitle className="text-xs text-muted-foreground">Surfaces aktiv</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3"><span className="text-2xl font-bold">{bySurface.size}</span></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Performance nach Surface</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Surface</TableHead><TableHead>Typ</TableHead><TableHead className="text-right">Deliveries</TableHead>
              <TableHead className="text-right">👍</TableHead><TableHead className="text-right">👎</TableHead>
              <TableHead className="text-right">Like %</TableHead><TableHead className="text-right">Ø pro Item</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm"><Badge variant="outline" className="text-[10px]">{SURFACE_LABELS[row.surface] ?? row.surface}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{TYPE_LABELS[row.humor_type] ?? row.humor_type}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.total_deliveries}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.likes}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.dislikes}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={row.like_rate_pct >= 70 ? 'text-green-600' : row.like_rate_pct < 40 ? 'text-destructive' : ''}>{row.like_rate_pct}%</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{row.avg_deliveries_per_item}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AiResultDialog open={showAi} onOpenChange={setShowAi} title="KI-Retention-Analyse" result={ai.result} loading={ai.loading} />
    </div>
  );
}

// ── Drilldown Tab (with AI optimize) ──

function DrilldownTab() {
  const ai = useAiAssistant();
  const [showAi, setShowAi] = useState(false);

  const { data: weakItems, isLoading: weakLoading } = useQuery({
    queryKey: ['admin', 'humor-weak-items'],
    queryFn: async () => {
      const { data, error } = await supabase.from('humor_items' as any)
        .select('id, text, humor_type, quality_score, status, certification_id')
        .in('status', ['approved', 'draft']).not('quality_score', 'is', null)
        .order('quality_score', { ascending: true }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as WeakItem[];
    },
  });

  const { data: reviewQueue, isLoading: reviewLoading } = useQuery({
    queryKey: ['admin', 'humor-review-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('humor_items' as any)
        .select('id, text, humor_type, quality_score, status, certification_id')
        .eq('status', 'draft').order('created_at', { ascending: true }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as WeakItem[];
    },
  });

  const handleOptimize = async () => {
    if (!weakItems?.length) return;
    setShowAi(true);
    const ctx = JSON.stringify({
      weakItems: weakItems.slice(0, 10).map(i => ({
        text: i.text, type: i.humor_type, score: i.quality_score, status: i.status,
      })),
    });
    await ai.invoke('humor_qc', 'optimize_content', ctx);
  };

  const isLoading = weakLoading || reviewLoading;
  if (isLoading) return <p className="text-sm text-muted-foreground">Lade Drilldown-Daten…</p>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-500" /> Schwächste Items</CardTitle>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleOptimize} disabled={ai.loading || !weakItems?.length}>
              {ai.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              KI-Optimierung
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Text</TableHead><TableHead>Typ</TableHead><TableHead className="text-right">Score</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {weakItems?.slice(0, 20).map(item => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm max-w-[300px] truncate">{item.text}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{TYPE_LABELS[item.humor_type] ?? item.humor_type}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={Number(item.quality_score) < 65 ? 'text-destructive font-medium' : ''}>{item.quality_score}</span>
                  </TableCell>
                  <TableCell><Badge variant={item.status === 'approved' ? 'default' : 'secondary'} className="text-[10px]">{item.status}</Badge></TableCell>
                </TableRow>
              ))}
              {(!weakItems || weakItems.length === 0) && (
                <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground text-center py-4">Keine Items mit Quality Score gefunden</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Review-Queue (Drafts)
            {reviewQueue && reviewQueue.length > 0 && <Badge variant="secondary" className="text-[10px] ml-1">{reviewQueue.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Text</TableHead><TableHead>Typ</TableHead><TableHead className="text-right">Score</TableHead></TableRow></TableHeader>
            <TableBody>
              {reviewQueue?.slice(0, 20).map(item => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm max-w-[300px] truncate">{item.text}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{TYPE_LABELS[item.humor_type] ?? item.humor_type}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{item.quality_score ?? '–'}</TableCell>
                </TableRow>
              ))}
              {(!reviewQueue || reviewQueue.length === 0) && (
                <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground text-center py-4">Keine Drafts in der Queue</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AiResultDialog open={showAi} onOpenChange={setShowAi} title="KI-Optimierungsvorschläge" result={ai.result} loading={ai.loading} />
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
  if (lift > 0) return <span className="text-green-600 flex items-center gap-0.5"><ArrowUpRight className="h-3 w-3" /> +{lift.toFixed(1)}%</span>;
  return <span className="text-destructive flex items-center gap-0.5"><ArrowDownRight className="h-3 w-3" /> {lift.toFixed(1)}%</span>;
}

function ImpactCard({ title, withHumor, withoutHumor, metricLabel }: { title: string; withHumor: number; withoutHumor: number; metricLabel: string }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Mit Humor</span><span className="font-bold tabular-nums">{withHumor.toFixed(1)}%</span></div>
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Ohne Humor</span><span className="font-bold tabular-nums">{withoutHumor.toFixed(1)}%</span></div>
        <div className="flex items-center justify-between text-sm pt-1 border-t border-border"><span className="text-muted-foreground">{metricLabel}</span><LiftIndicator withHumor={withHumor} withoutHumor={withoutHumor} /></div>
      </CardContent>
    </Card>
  );
}

function LearningImpactTab() {
  const { data: lessonImpact, isLoading: l1 } = useQuery({ queryKey: ['admin', 'humor-impact-lesson'], queryFn: async () => { const { data, error } = await supabase.from('v_humor_lesson_impact' as any).select('*'); if (error) throw error; return (data ?? []) as unknown as ImpactRow[]; } });
  const { data: mcImpact, isLoading: l2 } = useQuery({ queryKey: ['admin', 'humor-impact-minicheck'], queryFn: async () => { const { data, error } = await supabase.from('v_humor_minicheck_impact' as any).select('*'); if (error) throw error; return (data ?? []) as unknown as ImpactRow[]; } });
  const { data: tutorImpact, isLoading: l3 } = useQuery({ queryKey: ['admin', 'humor-impact-tutor'], queryFn: async () => { const { data, error } = await supabase.from('v_humor_tutor_impact' as any).select('*'); if (error) throw error; return (data ?? []) as unknown as TutorImpactRow[]; } });
  const { data: recoveryImpact, isLoading: l4 } = useQuery({ queryKey: ['admin', 'humor-impact-recovery'], queryFn: async () => { const { data, error } = await supabase.from('v_humor_recovery_impact' as any).select('*'); if (error) throw error; return (data ?? []) as unknown as RecoveryRow[]; } });

  if (l1 || l2 || l3 || l4) return <p className="text-sm text-muted-foreground">Lade Impact-Daten…</p>;

  const getRate = (rows: ImpactRow[] | undefined, field: 'completion_rate_pct' | 'start_rate_pct', humor: number) => Number(rows?.find(r => r.saw_humor === humor)?.[field] ?? 0);
  const lessonWith = getRate(lessonImpact, 'completion_rate_pct', 1);
  const lessonWithout = getRate(lessonImpact, 'completion_rate_pct', 0);
  const mcWith = getRate(mcImpact, 'start_rate_pct', 1);
  const mcWithout = getRate(mcImpact, 'start_rate_pct', 0);
  const tutorWith = Number(tutorImpact?.find(r => r.has_humor === 1)?.engagement_rate_pct ?? 0);
  const tutorWithout = Number(tutorImpact?.find(r => r.has_humor === 0)?.engagement_rate_pct ?? 0);
  const recovWith = Number(recoveryImpact?.find(r => r.saw_humor === 1)?.retry_rate_pct ?? 0);
  const recovWithout = Number(recoveryImpact?.find(r => r.saw_humor === 0)?.retry_rate_pct ?? 0);
  const hasAnyData = (lessonImpact?.length ?? 0) > 0 || (mcImpact?.length ?? 0) > 0 || (tutorImpact?.length ?? 0) > 0 || (recoveryImpact?.length ?? 0) > 0;

  if (!hasAnyData) return <p className="text-sm text-muted-foreground">Noch keine Impact-Daten vorhanden.</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Vergleich: Lernverhalten mit vs. ohne Humor-Exposure.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ImpactCard title="📈 Lesson Completion" withHumor={lessonWith} withoutHumor={lessonWithout} metricLabel="Lift" />
        <ImpactCard title="⚡ MiniCheck Start" withHumor={mcWith} withoutHumor={mcWithout} metricLabel="Lift" />
        <ImpactCard title="🤖 Tutor Engagement" withHumor={tutorWith} withoutHumor={tutorWithout} metricLabel="Lift" />
        <ImpactCard title="💚 Recovery nach Fehler" withHumor={recovWith} withoutHumor={recovWithout} metricLabel="Lift" />
      </div>
    </div>
  );
}

// ── Auto-Generate Tab ──

function AutoGenerateTab({ certifications }: { certifications: { id: string; title: string }[] }) {
  const ai = useAiAssistant();
  const { toast } = useToast();
  const [selectedCert, setSelectedCert] = useState('');
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [importing, setImporting] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const handleGenerate = async () => {
    if (!selectedCert) {
      toast({ title: 'Bitte Zertifizierung wählen', variant: 'destructive' });
      return;
    }
    const cert = certifications.find(c => c.id === selectedCert);
    setShowResult(true);
    const result = await ai.invoke('humor_qc', 'generate_humor',
      `Zertifizierung: ${cert?.title ?? selectedCert}. Erstelle 5 abwechslungsreiche Humor-Items für IHK-Prüfungsvorbereitung in dieser Fachrichtung.`
    );
    setGenerateResult(result);
  };

  const handleBulkGenerate = async () => {
    if (!selectedCert) {
      toast({ title: 'Bitte Zertifizierung wählen', variant: 'destructive' });
      return;
    }
    const cert = certifications.find(c => c.id === selectedCert);
    setShowResult(true);
    const result = await ai.invoke('humor_qc', 'bulk_generate',
      `Zertifizierung: "${cert?.title ?? selectedCert}" (ID: ${selectedCert}). Fachgebiet: IHK-Prüfungsvorbereitung.`
    );
    setGenerateResult(result);
  };

  const handleCsvImport = async () => {
    if (!csvFile) {
      toast({ title: 'Bitte CSV-Datei wählen', variant: 'destructive' });
      return;
    }
    setImporting(true);
    try {
      const text = await csvFile.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) throw new Error('CSV hat keine Datenzeilen');

      const headers = lines[0].split(';').map(h => h.trim().toLowerCase());
      const textIdx = headers.findIndex(h => h === 'text');
      const typeIdx = headers.findIndex(h => h === 'humor_type' || h === 'type');
      const certIdx = headers.findIndex(h => h === 'certification_id' || h === 'cert_id');

      if (textIdx === -1) throw new Error('CSV muss "text"-Spalte enthalten');

      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(';').map(c => c.trim());
        if (!cols[textIdx]) continue;
        const row: any = {
          text: cols[textIdx],
          humor_type: typeIdx !== -1 ? cols[typeIdx] : 'wordplay',
          status: 'draft',
        };
        if (certIdx !== -1 && cols[certIdx]) row.certification_id = cols[certIdx];
        const { error } = await supabase.from('humor_items' as any).insert(row);
        if (!error) imported++;
      }

      toast({ title: `${imported} Items importiert`, description: `${lines.length - 1} Zeilen verarbeitet` });
      setCsvFile(null);
    } catch (e: any) {
      toast({ title: 'Import-Fehler', description: e.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Auto-Generate */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> KI-Humor-Generator</CardTitle>
          <CardDescription>Generiere automatisch neue Humor-Items für eine Zertifizierung per KI.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={selectedCert} onValueChange={setSelectedCert}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Zertifizierung wählen…" /></SelectTrigger>
              <SelectContent>
                {certifications.map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button onClick={handleGenerate} disabled={ai.loading || !selectedCert} className="gap-1.5">
                {ai.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                5 Items generieren
              </Button>
              <Button onClick={handleBulkGenerate} disabled={ai.loading || !selectedCert} variant="secondary" className="gap-1.5">
                {ai.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                10 Bulk-Items
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CSV Import */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Upload className="h-4 w-4" /> CSV-Import</CardTitle>
          <CardDescription>Importiere Humor-Items aus einer CSV-Datei (Semikolon-getrennt). Pflichtfeld: "text". Optional: "humor_type", "certification_id".</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <Input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} className="flex-1" />
            <Button onClick={handleCsvImport} disabled={importing || !csvFile} variant="outline" className="gap-1.5">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              Importieren
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Beispiel: <code>text;humor_type;certification_id</code></p>
        </CardContent>
      </Card>

      {/* Template Download */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Download className="h-4 w-4" /> CSV-Vorlage</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={() => {
            const csv = 'text;humor_type;certification_id\n"Beispiel Witz";wordplay;cert-id-hier\n';
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'humor_import_vorlage.csv'; a.click();
            URL.revokeObjectURL(url);
          }}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Vorlage herunterladen
          </Button>
        </CardContent>
      </Card>

      <AiResultDialog open={showResult} onOpenChange={setShowResult} title="KI-generierte Humor-Items" result={generateResult ?? ai.result} loading={ai.loading} />
    </div>
  );
}

// ── Main Page ──

export default function HumorQCPage() {
  const [tab, setTab] = useState('overview');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'humor-qc'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_admin_humor_qc' as any).select('*');
      if (error) throw error;
      return (data ?? []) as unknown as HumorQCRow[];
    },
  });

  const certifications = (data ?? []).map(r => ({ id: r.certification_id, title: r.certification_title }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" /> Humor QC Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Bestandsübersicht, Delivery-KPIs, Qualitätskontrolle & KI-gestützte Auto-Generierung
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Bestand</TabsTrigger>
          <TabsTrigger value="kpi" className="gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> KPIs</TabsTrigger>
          <TabsTrigger value="drilldown" className="gap-1.5"><List className="h-3.5 w-3.5" /> Drilldown</TabsTrigger>
          <TabsTrigger value="impact" className="gap-1.5"><Brain className="h-3.5 w-3.5" /> Lernwirkung</TabsTrigger>
          <TabsTrigger value="generate" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Auto-Generate</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab data={data} isLoading={isLoading} /></TabsContent>
        <TabsContent value="kpi"><KPITab /></TabsContent>
        <TabsContent value="drilldown"><DrilldownTab /></TabsContent>
        <TabsContent value="impact"><LearningImpactTab /></TabsContent>
        <TabsContent value="generate"><AutoGenerateTab certifications={certifications} /></TabsContent>
      </Tabs>
    </div>
  );
}
