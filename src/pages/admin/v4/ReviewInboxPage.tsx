import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  CheckCircle, XCircle, Download, Copy, Clock, ShieldCheck, AlertTriangle, Eye, FileJson, BarChart3,
} from 'lucide-react';

interface ReviewRow {
  id: string;
  course_package_id: string;
  status: string;
  integrity_score: number | null;
  integrity_report: any;
  export_json: any;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  course_packages?: { title: string; course_id: string | null; status: string } | null;
}

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  queued: { label: 'Warteschlange', variant: 'secondary' },
  ready: { label: 'Bereit', variant: 'default' },
  reviewing: { label: 'In Prüfung', variant: 'outline' },
  approved: { label: 'Freigegeben', variant: 'default' },
  rejected: { label: 'Abgelehnt', variant: 'destructive' },
};

function CoverageKPIs({ report, exportJson }: { report: any; exportJson: any }) {
  const v3 = report?.v3;
  if (!v3 && !exportJson?.exam) return null;

  const bpPct = v3?.coverage?.blueprint_pct ?? exportJson?.exam?.blueprint_coverage_pct ?? 0;
  const dupRate = v3?.coverage?.near_duplicate_rate_pct ?? exportJson?.exam?.near_duplicate_rate_pct ?? 0;
  const hardFails: string[] = v3?.hard_fail_reasons || [];
  const lfCoverage = v3?.coverage?.learning_field_coverage || exportJson?.exam?.learning_field_coverage || {};

  const minLfPct = Object.values(lfCoverage).length > 0
    ? Math.min(...(Object.values(lfCoverage) as number[]))
    : 100;

  return (
    <div className="space-y-3">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/50 rounded-lg p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Blueprint</p>
          <p className={`text-lg font-bold ${bpPct >= 95 ? 'text-primary' : 'text-destructive'}`}>{bpPct}%</p>
          <Progress value={bpPct} className="h-1 mt-1" />
        </div>
        <div className="bg-muted/50 rounded-lg p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Min. Lernfeld</p>
          <p className={`text-lg font-bold ${minLfPct >= 90 ? 'text-primary' : 'text-destructive'}`}>{minLfPct}%</p>
          <Progress value={minLfPct} className="h-1 mt-1" />
        </div>
        <div className="bg-muted/50 rounded-lg p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Duplikat-Rate</p>
          <p className={`text-lg font-bold ${dupRate <= 3 ? 'text-primary' : 'text-destructive'}`}>{dupRate}%</p>
          <Progress value={Math.min(dupRate * 10, 100)} className="h-1 mt-1" />
        </div>
      </div>

      {/* Hard fails */}
      {hardFails.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-xs font-semibold text-destructive flex items-center gap-1.5 mb-1.5">
            <XCircle className="h-3.5 w-3.5" /> {hardFails.length} Hard Fail(s) – Publish blockiert
          </p>
          <ul className="text-xs text-destructive/80 space-y-0.5 list-disc ml-4">
            {hardFails.map((f: string, i: number) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}

      {/* LF breakdown */}
      {Object.keys(lfCoverage).length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Lernfeld-Abdeckung Details
          </summary>
          <div className="grid grid-cols-2 gap-1 mt-2">
            {Object.entries(lfCoverage).map(([name, pct]) => (
              <div key={name} className="flex justify-between px-2 py-1 bg-muted/30 rounded">
                <span className="truncate mr-2">{name}</span>
                <span className={`font-medium ${(pct as number) >= 90 ? 'text-primary' : 'text-destructive'}`}>
                  {pct as number}%
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function SamplingPreview({ exportJson }: { exportJson: any }) {
  const sp = exportJson?.sampling_plan;
  if (!sp) return null;

  return (
    <details className="text-xs mt-2">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-1">
        <BarChart3 className="h-3 w-3" /> Sampling-Übersicht
      </summary>
      <div className="mt-2 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-muted/30 rounded p-2">
            <p className="text-muted-foreground">Exam</p>
            <p className="font-medium">{sp.exam_sample?.total_sampled || 0} Fragen</p>
          </div>
          <div className="bg-muted/30 rounded p-2">
            <p className="text-muted-foreground">MiniCheck</p>
            <p className="font-medium">{sp.minicheck_sample?.total_lessons_sampled || 0} Lessons</p>
          </div>
          <div className="bg-muted/30 rounded p-2">
            <p className="text-muted-foreground">Oral</p>
            <p className="font-medium">{sp.oral_sample?.total_sampled || 0} Szenarien</p>
          </div>
          <div className="bg-muted/30 rounded p-2">
            <p className="text-muted-foreground">Handbook</p>
            <p className="font-medium">{(sp.handbook_sample?.top_weight?.length || 0) + (sp.handbook_sample?.risk_topics?.length || 0) + (sp.handbook_sample?.random?.length || 0)} Sections</p>
          </div>
        </div>
        {sp.risk_sets && (
          <div className="flex gap-4 text-muted-foreground">
            <span>Near-Duplicates: <strong className="text-foreground">{sp.risk_sets.near_duplicates_sample?.total_clusters || 0}</strong> Cluster</span>
            <span>Low-Confidence: <strong className="text-foreground">{sp.risk_sets.low_confidence_sample?.total_flagged || 0}</strong> Items</span>
          </div>
        )}
      </div>
    </details>
  );
}

export default function ReviewInboxPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [previewJson, setPreviewJson] = useState<any>(null);

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['package-reviews'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('course_package_reviews')
        .select('*, course_packages(title, course_id, status)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ReviewRow[];
    },
    refetchInterval: 10_000,
  });

  const approve = useMutation({
    mutationFn: async (reviewId: string) => {
      const review = reviews.find(r => r.id === reviewId);
      if (!review) throw new Error('Review not found');

      // Check v3 hard fails before allowing approve
      const hardFails = review.integrity_report?.v3?.hard_fail_reasons || [];
      if (hardFails.length > 0) {
        throw new Error(`Kann nicht freigegeben werden: ${hardFails.length} Hard Fail(s) vorhanden.`);
      }

      const { error: rErr } = await (supabase as any)
        .from('course_package_reviews')
        .update({ status: 'approved', reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
        .eq('id', reviewId);
      if (rErr) throw rErr;

      const { data: pkg } = await supabase
        .from('course_packages')
        .select('id, course_id')
        .eq('id', review.course_package_id)
        .single();

      if (pkg?.course_id) {
        await supabase.from('job_queue').insert({
          job_type: 'package_auto_publish',
          status: 'pending',
          payload: { package_id: review.course_package_id, course_id: pkg.course_id },
          max_attempts: 3,
        } as any);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['package-reviews'] });
      toast({ title: '✅ Freigegeben', description: 'Publish-Job wurde gestartet.' });
    },
    onError: (e: any) => toast({ title: 'Fehler', description: e.message, variant: 'destructive' }),
  });

  const reject = useMutation({
    mutationFn: async ({ reviewId, notes }: { reviewId: string; notes: string }) => {
      const { error } = await (supabase as any)
        .from('course_package_reviews')
        .update({ status: 'rejected', reviewed_by: user?.id, reviewed_at: new Date().toISOString(), notes })
        .eq('id', reviewId);
      if (error) throw error;
      const review = reviews.find(r => r.id === reviewId);
      if (review) {
        await supabase.from('course_packages')
          .update({ status: 'blocked' } as any)
          .eq('id', review.course_package_id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['package-reviews'] });
      setRejectId(null);
      setRejectNotes('');
      toast({ title: 'Abgelehnt', description: 'Package wurde blockiert.' });
    },
    onError: (e: any) => toast({ title: 'Fehler', description: e.message, variant: 'destructive' }),
  });

  const downloadJson = (exportData: any, title: string) => {
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review-pack-${title?.replace(/\s+/g, '-') || 'package'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyJson = async (exportData: any) => {
    await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    toast({ title: 'Kopiert', description: 'Review-Pack JSON in Zwischenablage.' });
  };

  const readyReviews = reviews.filter(r => r.status === 'ready' || r.status === 'reviewing');
  const pastReviews = reviews.filter(r => r.status === 'approved' || r.status === 'rejected');
  const queuedReviews = reviews.filter(r => r.status === 'queued');

  const renderReviewCard = (r: ReviewRow, showActions: boolean) => {
    const badge = STATUS_BADGE[r.status] || { label: r.status, variant: 'outline' as const };
    const warningCount = Array.isArray(r.integrity_report?.warnings) ? r.integrity_report.warnings.length : 0;
    const hardFails: string[] = r.integrity_report?.v3?.hard_fail_reasons || [];
    const hasHardFails = hardFails.length > 0;

    return (
      <Card key={r.id} className="border border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              {r.course_packages?.title || r.course_package_id.slice(0, 8)}
            </CardTitle>
            <div className="flex items-center gap-2">
              {hasHardFails && <Badge variant="destructive">Hard Fail</Badge>}
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
          </div>
          <CardDescription className="text-xs">
            Erstellt: {new Date(r.created_at).toLocaleString('de-DE')}
            {r.reviewed_at && ` • Reviewed: ${new Date(r.reviewed_at).toLocaleString('de-DE')}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Score */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="font-medium">Score: {r.integrity_score ?? '–'}/100</span>
            </div>
            {warningCount > 0 && (
              <div className="flex items-center gap-1 text-orange-500 dark:text-orange-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{warningCount} Warnings</span>
              </div>
            )}
          </div>

          {/* Coverage KPIs */}
          <CoverageKPIs report={r.integrity_report} exportJson={r.export_json} />

          {/* Sampling preview */}
          <SamplingPreview exportJson={r.export_json} />

          {r.notes && (
            <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">{r.notes}</p>
          )}

          {/* Actions */}
          {showActions && (
            <div className="flex flex-wrap gap-2 pt-1">
              {r.export_json && (
                <>
                  <Button size="sm" variant="outline" onClick={() => downloadJson(r.export_json, r.course_packages?.title || '')}>
                    <FileJson className="h-3.5 w-3.5 mr-1.5" /> Review Pack
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => copyJson(r.export_json)}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Kopieren
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPreviewJson(r.export_json)}>
                    <Eye className="h-3.5 w-3.5 mr-1.5" /> Vorschau
                  </Button>
                </>
              )}
              <Button
                size="sm"
                onClick={() => approve.mutate(r.id)}
                disabled={approve.isPending || hasHardFails}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                title={hasHardFails ? 'Nicht freigeben: Hard Fails vorhanden' : ''}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" /> Freigeben
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setRejectId(r.id)}>
                <XCircle className="h-3.5 w-3.5 mr-1.5" /> Ablehnen
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Review Inbox</h1>
        <p className="text-sm text-muted-foreground">
          High-Assurance Review: Stratifizierte Samples, Coverage-KPIs, Duplikat-Analyse.
        </p>
      </div>

      <Tabs defaultValue="ready">
        <TabsList>
          <TabsTrigger value="ready" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Bereit ({readyReviews.length})
          </TabsTrigger>
          <TabsTrigger value="queued" className="gap-1.5">
            Warteschlange ({queuedReviews.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            Historie ({pastReviews.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ready" className="space-y-4 mt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Lade…</p>
          ) : readyReviews.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Keine Packages zur Review.</CardContent></Card>
          ) : (
            readyReviews.map(r => renderReviewCard(r, true))
          )}
        </TabsContent>

        <TabsContent value="queued" className="space-y-4 mt-4">
          {queuedReviews.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Keine Packages in der Warteschlange.</CardContent></Card>
          ) : (
            queuedReviews.map(r => renderReviewCard(r, false))
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          {pastReviews.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Keine vergangenen Reviews.</CardContent></Card>
          ) : (
            pastReviews.map(r => renderReviewCard(r, false))
          )}
        </TabsContent>
      </Tabs>

      {/* Reject Dialog */}
      <Dialog open={!!rejectId} onOpenChange={(o) => { if (!o) setRejectId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Package ablehnen</DialogTitle>
            <DialogDescription>Begründung für die Ablehnung (optional aber empfohlen).</DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            placeholder="z.B. Zu wenige Prüfungsfragen, Abdeckung Lernfeld 3 fehlt…"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>Abbrechen</Button>
            <Button
              variant="destructive"
              disabled={reject.isPending}
              onClick={() => rejectId && reject.mutate({ reviewId: rejectId, notes: rejectNotes })}
            >
              Ablehnen & Blockieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview JSON Dialog */}
      <Dialog open={!!previewJson} onOpenChange={(o) => { if (!o) setPreviewJson(null); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Review Pack Vorschau</DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-[60vh] whitespace-pre-wrap">
            {JSON.stringify(previewJson, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
