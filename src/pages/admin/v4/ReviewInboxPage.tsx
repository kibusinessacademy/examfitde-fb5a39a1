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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  CheckCircle, XCircle, Download, Copy, Clock, ShieldCheck, AlertTriangle, Eye,
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

      // Update review
      const { error: rErr } = await (supabase as any)
        .from('course_package_reviews')
        .update({ status: 'approved', reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
        .eq('id', reviewId);
      if (rErr) throw rErr;

      // Trigger publish via job_queue
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

      // Also block the package
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
    a.download = `review-export-${title?.replace(/\s+/g, '-') || 'package'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyJson = async (exportData: any) => {
    await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    toast({ title: 'Kopiert', description: 'Export-JSON in Zwischenablage.' });
  };

  const readyReviews = reviews.filter(r => r.status === 'ready' || r.status === 'reviewing');
  const pastReviews = reviews.filter(r => r.status === 'approved' || r.status === 'rejected');
  const queuedReviews = reviews.filter(r => r.status === 'queued');

  const renderReviewCard = (r: ReviewRow, showActions: boolean) => {
    const badge = STATUS_BADGE[r.status] || { label: r.status, variant: 'outline' as const };
    const warningCount = Array.isArray(r.integrity_report?.warnings) ? r.integrity_report.warnings.length : 0;
    const issueCount = Array.isArray(r.integrity_report?.issues) ? r.integrity_report.issues.length : 0;

    return (
      <Card key={r.id} className="border border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              {r.course_packages?.title || r.course_package_id.slice(0, 8)}
            </CardTitle>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <CardDescription className="text-xs">
            Erstellt: {new Date(r.created_at).toLocaleString('de-DE')}
            {r.reviewed_at && ` • Reviewed: ${new Date(r.reviewed_at).toLocaleString('de-DE')}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Score + Metrics */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="font-medium">Score: {r.integrity_score ?? '–'}/100</span>
            </div>
            {warningCount > 0 && (
              <div className="flex items-center gap-1 text-yellow-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{warningCount} Warnings</span>
              </div>
            )}
            {issueCount > 0 && (
              <div className="flex items-center gap-1 text-destructive">
                <XCircle className="h-3.5 w-3.5" />
                <span>{issueCount} Issues</span>
              </div>
            )}
          </div>

          {r.notes && (
            <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">{r.notes}</p>
          )}

          {/* Actions */}
          {showActions && (
            <div className="flex flex-wrap gap-2 pt-1">
              {r.export_json && (
                <>
                  <Button size="sm" variant="outline" onClick={() => downloadJson(r.export_json, r.course_packages?.title || '')}>
                    <Download className="h-3.5 w-3.5 mr-1.5" /> Download JSON
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
                disabled={approve.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
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
          Fertiggemeldete Course-Packages prüfen, Export für ChatGPT erstellen, freigeben oder ablehnen.
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
            <DialogTitle>Export JSON Vorschau</DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-[60vh] whitespace-pre-wrap">
            {JSON.stringify(previewJson, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
