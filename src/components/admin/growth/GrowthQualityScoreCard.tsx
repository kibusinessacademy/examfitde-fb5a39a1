import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, RefreshCw, Gauge, AlertTriangle, CheckCircle2, AlertCircle, Wrench, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Summary = {
  total_published: number;
  avg_score: number;
  green_count: number;
  yellow_count: number;
  red_count: number;
  avg_subscores: Record<string, number>;
  computed_at: string;
};

type DetailRow = {
  package_id: string;
  title: string;
  package_key: string;
  published_at: string;
  growth_quality_score: number;
  score_blog_quality: number;
  score_seo_meta: number;
  score_internal_links: number;
  score_cta: number;
  score_funnel_events: number;
  score_email_sequence: number;
  score_distribution: number;
  score_og_image: number;
};

type PackageDetail = {
  package: { id: string; title: string; package_key: string; status: string; published_at: string; curriculum_id: string };
  scores: Record<string, number> | null;
  signals: Record<string, unknown>;
  recent_jobs: Array<{ id: string; job_type: string; status: string; created_at: string; completed_at: string | null; last_error: string | null; idempotency_key: string }>;
  recent_heal_log: Array<{ created_at: string; action_type: string; result_status: string; result_detail: string | null; metadata: Record<string, unknown> }>;
  computed_at: string;
};

const SUBSCORE_ROWS: { key: string; label: string; signalKey?: string }[] = [
  { key: 'blog_quality',   label: 'Blog Quality',       signalKey: 'blog_articles_count' },
  { key: 'seo_meta',       label: 'SEO Meta' },
  { key: 'internal_links', label: 'Internal Links',     signalKey: 'internal_links_count' },
  { key: 'cta',            label: 'CTA' },
  { key: 'funnel_events',  label: 'Funnel Events (30d)', signalKey: 'funnel_events_30d' },
  { key: 'email_sequence', label: 'Email Sequence',     signalKey: 'email_sequence_enrollments' },
  { key: 'distribution',   label: 'Distribution',       signalKey: 'distribution_targets_count' },
  { key: 'og_image',       label: 'OG Image',           signalKey: 'og_image_url' },
];

function tone(pct: number) {
  if (pct >= 80) return 'success';
  if (pct >= 50) return 'warning';
  return 'error';
}

function gateBadge(avg: number) {
  if (avg >= 80)
    return (
      <Badge className="bg-status-success-bg-subtle text-status-success-text border-status-success-border">
        <CheckCircle2 className="mr-1 h-3 w-3" />Green
      </Badge>
    );
  if (avg >= 50)
    return (
      <Badge className="bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border">
        <AlertTriangle className="mr-1 h-3 w-3" />Yellow
      </Badge>
    );
  return (
    <Badge className="bg-status-error-bg-subtle text-status-error-text border-status-error-border">
      <AlertCircle className="mr-1 h-3 w-3" />Red
    </Badge>
  );
}

function PackageDetailDialog({
  packageId,
  open,
  onClose,
}: {
  packageId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ['growth-quality-package-detail', packageId],
    enabled: !!packageId && open,
    queryFn: async (): Promise<PackageDetail> => {
      const { data, error } = await supabase.rpc('admin_get_growth_quality_package_detail' as any, {
        p_package_id: packageId!,
      });
      if (error) throw error;
      return data as PackageDetail;
    },
    staleTime: 30_000,
  });

  const dispatch = useMutation({
    mutationFn: async (subscore: string) => {
      const { data, error } = await supabase.rpc('admin_dispatch_growth_quality_repair' as any, {
        p_package_id: packageId!,
        p_subscore: subscore,
      });
      if (error) throw error;
      return data as { status: string; reason?: string; job_id: string; subscore: string; job_type: string };
    },
    onSuccess: (res) => {
      if (res.status === 'enqueued') {
        toast.success(`Repair enqueued: ${res.subscore}`, { description: `${res.job_type} · ${res.job_id.slice(0, 8)}` });
      } else {
        toast.warning(`Repair übersprungen: ${res.subscore}`, { description: res.reason });
      }
      qc.invalidateQueries({ queryKey: ['growth-quality-package-detail', packageId] });
      qc.invalidateQueries({ queryKey: ['growth-quality-summary'] });
      qc.invalidateQueries({ queryKey: ['growth-quality-details'] });
    },
    onError: (err: Error) => {
      toast.error('Repair fehlgeschlagen', { description: err.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Growth Quality Drilldown
          </DialogTitle>
          <DialogDescription>
            {detail.data ? (
              <>
                <span className="font-medium text-text-primary">{detail.data.package.title}</span>{' '}
                <span className="font-mono text-[10px] text-text-secondary">{detail.data.package.package_key}</span>
              </>
            ) : 'Lade Paket-Detail…'}
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading && (
          <div className="flex items-center gap-2 text-text-secondary text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />Lade…
          </div>
        )}
        {detail.error && (
          <div className="text-sm text-status-error-text">Fehler: {(detail.error as Error).message}</div>
        )}

        {detail.data && (
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-4">
              <div className="rounded-md border border-border-subtle bg-surface-sunken p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-text-primary">Subscores</div>
                  {detail.data.scores && gateBadge(Number(detail.data.scores.growth_quality_score ?? 0))}
                </div>
                <div className="space-y-2">
                  {SUBSCORE_ROWS.map(({ key, label, signalKey }) => {
                    const pct = Number(detail.data!.scores?.[key] ?? 0);
                    const signal = signalKey ? detail.data!.signals?.[signalKey] : undefined;
                    return (
                      <div key={key} className="grid grid-cols-12 items-center gap-2 text-xs">
                        <div className="col-span-3 text-text-secondary">{label}</div>
                        <div className="col-span-5"><Progress value={pct} className="h-2" /></div>
                        <div className={`col-span-1 text-right font-mono text-status-${tone(pct)}-text`}>
                          {pct.toFixed(0)}
                        </div>
                        <div className="col-span-2 text-right text-[10px] text-text-secondary truncate" title={String(signal ?? '')}>
                          {signal === undefined || signal === null ? '–' : String(signal).slice(0, 20)}
                        </div>
                        <div className="col-span-1 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={dispatch.isPending}
                            onClick={() => dispatch.mutate(key)}
                            className="h-6 text-[10px] px-2"
                          >
                            <Wrench className="h-3 w-3 mr-1" />Fix
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-md border border-border-subtle p-3">
                <div className="text-xs font-medium text-text-primary mb-2">Letzte Repair-/Growth-Jobs</div>
                {detail.data.recent_jobs.length === 0 ? (
                  <div className="text-xs text-text-secondary">Keine Jobs gefunden.</div>
                ) : (
                  <div className="space-y-1">
                    {detail.data.recent_jobs.map((j) => (
                      <div key={j.id} className="flex items-center justify-between gap-2 text-[11px] border-t border-border-subtle py-1">
                        <div className="font-mono text-text-secondary">{j.job_type}</div>
                        <div className={`font-mono text-status-${j.status === 'completed' ? 'success' : j.status === 'failed' ? 'error' : 'warning'}-text`}>
                          {j.status}
                        </div>
                        <div className="text-text-secondary">{new Date(j.created_at).toLocaleString('de-DE')}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border-subtle p-3">
                <div className="text-xs font-medium text-text-primary mb-2">Repair-Audit (auto_heal_log)</div>
                {detail.data.recent_heal_log.length === 0 ? (
                  <div className="text-xs text-text-secondary">Noch keine Repair-Aktionen für dieses Paket.</div>
                ) : (
                  <div className="space-y-1">
                    {detail.data.recent_heal_log.map((h, i) => (
                      <div key={i} className="text-[11px] border-t border-border-subtle py-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-text-secondary">{h.action_type}</span>
                          <span className={`font-mono text-status-${h.result_status === 'enqueued' ? 'success' : h.result_status === 'skipped' ? 'warning' : 'error'}-text`}>
                            {h.result_status}
                          </span>
                        </div>
                        <div className="text-text-secondary">
                          {new Date(h.created_at).toLocaleString('de-DE')} · {h.result_detail ?? ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => detail.refetch()} disabled={detail.isFetching}>
            <RefreshCw className={`h-3 w-3 mr-1 ${detail.isFetching ? 'animate-spin' : ''}`} />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function GrowthQualityScoreCard() {
  const [maxScore, setMaxScore] = useState(60);
  const [drilldownId, setDrilldownId] = useState<string | null>(null);
  const [bulkSubscore, setBulkSubscore] = useState<string | null>(null);
  const qcRoot = useQueryClient();

  const bulkDispatch = useMutation({
    mutationFn: async (subscore: string) => {
      setBulkSubscore(subscore);
      const { data, error } = await supabase.rpc('admin_bulk_dispatch_growth_quality_repair' as any, {
        p_subscore: subscore,
        p_limit: 10,
      });
      if (error) throw error;
      return data as { subscore: string; dispatched: number; skipped: number };
    },
    onSuccess: (res) => {
      toast.success(`Bulk-Repair ${res.subscore}`, {
        description: `enqueued: ${res.dispatched} · skipped: ${res.skipped}`,
      });
      qcRoot.invalidateQueries({ queryKey: ['growth-quality-summary'] });
      qcRoot.invalidateQueries({ queryKey: ['growth-quality-details'] });
    },
    onError: (err: Error) => toast.error('Bulk-Repair fehlgeschlagen', { description: err.message }),
    onSettled: () => setBulkSubscore(null),
  });

  const summary = useQuery({
    queryKey: ['growth-quality-summary'],
    queryFn: async (): Promise<Summary> => {
      const { data, error } = await supabase.rpc('admin_get_growth_quality_summary' as any);
      if (error) throw error;
      return data as Summary;
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const details = useQuery({
    queryKey: ['growth-quality-details', maxScore],
    queryFn: async (): Promise<DetailRow[]> => {
      const { data, error } = await supabase.rpc('admin_get_growth_quality_details' as any, {
        p_limit: 25,
        p_min: 0,
        p_max: maxScore,
      });
      if (error) throw error;
      return (data ?? []) as DetailRow[];
    },
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="h-4 w-4" /> Growth Quality Score
            {summary.data && gateBadge(summary.data.avg_score)}
          </CardTitle>
          <CardDescription>
            8-Dimensionen Quality-Gate für published packages · Score 0–100 · Klick auf Paket öffnet Repair-Drilldown
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            summary.refetch();
            details.refetch();
          }}
          disabled={summary.isFetching || details.isFetching}
        >
          <RefreshCw
            className={`h-3 w-3 mr-1 ${summary.isFetching || details.isFetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary.isLoading && (
          <div className="flex items-center gap-2 text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />Lade Quality-Summary…
          </div>
        )}
        {summary.error && (
          <div className="text-sm text-status-error-text">
            Fehler: {(summary.error as Error).message}
          </div>
        )}
        {summary.data && (
          <>
            <div className="grid grid-cols-4 gap-3 text-xs">
              <div className="rounded-md border border-border-subtle bg-surface-sunken p-2">
                <div className="text-text-secondary">Avg Score</div>
                <div className="font-mono text-lg text-text-primary">{summary.data.avg_score}</div>
              </div>
              <div className="rounded-md border border-border-subtle bg-status-success-bg-subtle p-2">
                <div className="text-text-secondary">Green ≥80</div>
                <div className="font-mono text-lg text-status-success-text">{summary.data.green_count}</div>
              </div>
              <div className="rounded-md border border-border-subtle bg-status-warning-bg-subtle p-2">
                <div className="text-text-secondary">Yellow 50–79</div>
                <div className="font-mono text-lg text-status-warning-text">{summary.data.yellow_count}</div>
              </div>
              <div className="rounded-md border border-border-subtle bg-status-error-bg-subtle p-2">
                <div className="text-text-secondary">Red &lt;50</div>
                <div className="font-mono text-lg text-status-error-text">{summary.data.red_count}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-text-primary">Avg Subscores</div>
              {SUBSCORE_ROWS.map(({ key, label }) => {
                const pct = Number(summary.data!.avg_subscores?.[key] ?? 0);
                return (
                  <div key={key} className="grid grid-cols-12 items-center gap-2 text-xs">
                    <div className="col-span-4 text-text-secondary">{label}</div>
                    <div className="col-span-7"><Progress value={pct} className="h-2" /></div>
                    <div className={`col-span-1 text-right font-mono text-status-${tone(pct)}-text`}>
                      {pct.toFixed(0)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-md border border-border-subtle bg-surface-sunken p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-text-primary">Worst Packages (Score ≤ {maxScore})</div>
                <div className="flex gap-1">
                  {[40, 60, 80, 100].map((m) => (
                    <Button
                      key={m}
                      size="sm"
                      variant={maxScore === m ? 'default' : 'outline'}
                      onClick={() => setMaxScore(m)}
                      className="h-6 text-[10px] px-2"
                    >
                      ≤{m}
                    </Button>
                  ))}
                </div>
              </div>

              {details.isLoading && (
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <Loader2 className="h-3 w-3 animate-spin" />Lade Pakete…
                </div>
              )}
              {details.data && details.data.length === 0 && (
                <div className="text-xs text-text-secondary">Keine Pakete in diesem Score-Bereich.</div>
              )}
              {details.data && details.data.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-text-secondary">
                      <tr>
                        <th className="text-left py-1 pr-2">Paket</th>
                        <th className="text-right px-1">Score</th>
                        <th className="text-right px-1" title="Blog Quality">BQ</th>
                        <th className="text-right px-1" title="SEO Meta">SEO</th>
                        <th className="text-right px-1" title="Internal Links">IL</th>
                        <th className="text-right px-1" title="CTA">CTA</th>
                        <th className="text-right px-1" title="Funnel Events">FE</th>
                        <th className="text-right px-1" title="Email Sequence">ES</th>
                        <th className="text-right px-1" title="Distribution">D</th>
                        <th className="text-right px-1" title="OG Image">OG</th>
                        <th className="text-right px-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.data.map((r) => (
                        <tr
                          key={r.package_id}
                          className="border-t border-border-subtle hover:bg-surface-elevated cursor-pointer"
                          onClick={() => setDrilldownId(r.package_id)}
                        >
                          <td className="py-1 pr-2 text-text-primary">
                            <div className="truncate max-w-[260px]">{r.title}</div>
                            <div className="text-text-secondary font-mono text-[9px]">{r.package_key}</div>
                          </td>
                          <td className={`text-right font-mono px-1 text-status-${tone(r.growth_quality_score)}-text`}>
                            {r.growth_quality_score}
                          </td>
                          <td className="text-right font-mono px-1">{r.score_blog_quality}</td>
                          <td className="text-right font-mono px-1">{r.score_seo_meta}</td>
                          <td className="text-right font-mono px-1">{r.score_internal_links}</td>
                          <td className="text-right font-mono px-1">{r.score_cta}</td>
                          <td className="text-right font-mono px-1">{r.score_funnel_events}</td>
                          <td className="text-right font-mono px-1">{r.score_email_sequence}</td>
                          <td className="text-right font-mono px-1">{r.score_distribution}</td>
                          <td className="text-right font-mono px-1">{r.score_og_image}</td>
                          <td className="text-right px-1">
                            <ExternalLink className="h-3 w-3 inline text-text-secondary" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="text-[10px] text-text-secondary">
              Total published: {summary.data.total_published} · Berechnet:{' '}
              {new Date(summary.data.computed_at).toLocaleString('de-DE')}
            </div>
          </>
        )}
      </CardContent>

      <PackageDetailDialog
        packageId={drilldownId}
        open={!!drilldownId}
        onClose={() => setDrilldownId(null)}
      />
    </Card>
  );
}
