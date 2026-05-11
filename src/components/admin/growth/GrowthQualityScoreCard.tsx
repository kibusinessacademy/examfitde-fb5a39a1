import { useState, useEffect } from 'react';
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
  Loader2, RefreshCw, Gauge, AlertTriangle, CheckCircle2, AlertCircle, Wrench, ExternalLink, Settings2,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
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

const SUBSCORE_KEYS = SUBSCORE_ROWS.map(r => r.key);

function BulkConfigDialog({
  open,
  onClose,
}: { open: boolean; onClose: () => void }) {
  const qcRoot = useQueryClient();
  const [limit, setLimit] = useState(10);
  const [timeWindowHours, setTimeWindowHours] = useState(24);
  const [selected, setSelected] = useState<Set<string>>(new Set(SUBSCORE_KEYS));
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Array<{ subscore: string; dispatched: number; skipped: number; error?: string }>>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState<boolean>(true);

  const config = useQuery({
    queryKey: ['admin-bulk-loop-config'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_growth_bulk_loop_config' as any);
      if (error) throw error;
      return data as { loop_limit: number; subscores: string[]; time_window_hours: number; updated_at: string | null; is_default: boolean };
    },
    staleTime: 0,
  });

  useEffect(() => {
    if (config.data) {
      setLimit(config.data.loop_limit);
      setTimeWindowHours(config.data.time_window_hours);
      setSelected(new Set(config.data.subscores));
      setSavedAt(config.data.updated_at);
      setIsDefault(!!config.data.is_default);
    }
  }, [config.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_save_growth_bulk_loop_config' as any, {
        p_loop_limit: limit,
        p_subscores: Array.from(selected),
        p_time_window_hours: timeWindowHours,
      });
      if (error) throw error;
      return data as { saved: boolean; updated_at: string };
    },
    onSuccess: (res) => {
      toast.success('Konfiguration gespeichert');
      setSavedAt(res.updated_at);
      setIsDefault(false);
      qcRoot.invalidateQueries({ queryKey: ['admin-bulk-loop-config'] });
    },
    onError: (e: Error) => toast.error('Speichern fehlgeschlagen', { description: e.message }),
  });

  const toggle = (k: string) => {
    const next = new Set(selected);
    next.has(k) ? next.delete(k) : next.add(k);
    setSelected(next);
  };

  const run = async () => {
    setResults([]);
    // Auto-save before run so server-side config matches what we executed
    try { await save.mutateAsync(); } catch { /* swallowed: toast already shown */ }
    for (const sub of SUBSCORE_KEYS) {
      if (!selected.has(sub)) continue;
      setRunning(sub);
      try {
        const { data, error } = await supabase.rpc('admin_bulk_dispatch_growth_quality_repair' as any, {
          p_subscore: sub,
          p_limit: limit,
        });
        if (error) throw error;
        const r = data as { subscore: string; dispatched: number; skipped: number };
        setResults(prev => [...prev, { subscore: sub, dispatched: r.dispatched, skipped: r.skipped }]);
      } catch (e) {
        setResults(prev => [...prev, { subscore: sub, dispatched: 0, skipped: 0, error: (e as Error).message }]);
      }
    }
    setRunning(null);
    qcRoot.invalidateQueries({ queryKey: ['growth-quality-summary'] });
    qcRoot.invalidateQueries({ queryKey: ['growth-quality-details'] });
    toast.success('Bulk-Repair Loop fertig', {
      description: `${selected.size} Subscores · limit=${limit} · window=${timeWindowHours}h`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />Bulk-Repair Loop konfigurieren
          </DialogTitle>
          <DialogDescription>
            Konfiguration wird serverseitig pro Admin gespeichert. Loop-Start speichert automatisch.
          </DialogDescription>
        </DialogHeader>

        {config.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-text-secondary py-4">
            <Loader2 className="h-3 w-3 animate-spin" />Lade gespeicherte Konfiguration…
          </div>
        ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Limit pro Subscore: <span className="font-mono">{limit}</span></Label>
            <Slider value={[limit]} min={1} max={50} step={1} onValueChange={(v) => setLimit(v[0])} />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Zeitfenster (Idempotenz / Re-Dispatch-Cooldown): <span className="font-mono">{timeWindowHours}h</span></Label>
            <Slider value={[timeWindowHours]} min={1} max={168} step={1} onValueChange={(v) => setTimeWindowHours(v[0])} />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Subscores ({selected.size}/{SUBSCORE_KEYS.length})</Label>
            <div className="grid grid-cols-2 gap-2">
              {SUBSCORE_ROWS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`bulk-${key}`}
                    checked={selected.has(key)}
                    onCheckedChange={() => toggle(key)}
                  />
                  <Label htmlFor={`bulk-${key}`} className="text-xs cursor-pointer">{label}</Label>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-6 text-[10px]"
                onClick={() => setSelected(new Set(SUBSCORE_KEYS))}>Alle</Button>
              <Button size="sm" variant="outline" className="h-6 text-[10px]"
                onClick={() => setSelected(new Set())}>Keine</Button>
            </div>
          </div>

          <div className="text-[10px] text-text-secondary">
            {isDefault
              ? 'Noch keine eigene Konfiguration gespeichert (Defaults aktiv).'
              : `Zuletzt gespeichert: ${savedAt ? new Date(savedAt).toLocaleString('de-DE') : '—'}`}
          </div>

          {results.length > 0 && (
            <div className="rounded-md border border-border-subtle bg-surface-sunken p-2 space-y-1 text-[11px]">
              <div className="font-medium text-text-primary">Ergebnis</div>
              {results.map((r, i) => (
                <div key={i} className="flex justify-between font-mono">
                  <span className="text-text-secondary">{r.subscore}</span>
                  <span className={r.error ? 'text-status-error-text' : 'text-status-success-text'}>
                    {r.error ? `err: ${r.error.slice(0, 30)}` : `enq:${r.dispatched} skip:${r.skipped}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={!!running}>Schließen</Button>
          <Button variant="outline" size="sm" onClick={() => save.mutate()} disabled={save.isPending || !!running || selected.size === 0}>
            {save.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}Nur speichern
          </Button>
          <Button size="sm" onClick={run} disabled={!!running || selected.size === 0 || config.isLoading}>
            {running ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Läuft: {running}</> : <><Wrench className="h-3 w-3 mr-1" />Speichern + Loop starten</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function GrowthQualityScoreCard() {
  const [maxScore, setMaxScore] = useState(60);
  const [drilldownId, setDrilldownId] = useState<string | null>(null);
  const [bulkSubscore, setBulkSubscore] = useState<string | null>(null);
  const [bulkConfigOpen, setBulkConfigOpen] = useState(false);
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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBulkConfigOpen(true)}
          >
            <Settings2 className="h-3 w-3 mr-1" />
            Bulk-Loop
          </Button>
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
        </div>
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
              <div className="text-xs font-medium text-text-primary">Avg Subscores · Bulk-Repair Top-10 Worst</div>
              {SUBSCORE_ROWS.map(({ key, label }) => {
                const pct = Number(summary.data!.avg_subscores?.[key] ?? 0);
                const isPending = bulkDispatch.isPending && bulkSubscore === key;
                return (
                  <div key={key} className="grid grid-cols-12 items-center gap-2 text-xs">
                    <div className="col-span-3 text-text-secondary">{label}</div>
                    <div className="col-span-6"><Progress value={pct} className="h-2" /></div>
                    <div className={`col-span-1 text-right font-mono text-status-${tone(pct)}-text`}>
                      {pct.toFixed(0)}
                    </div>
                    <div className="col-span-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={bulkDispatch.isPending}
                        onClick={() => bulkDispatch.mutate(key)}
                        className="h-6 text-[10px] px-2"
                      >
                        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3 mr-1" />}
                        Bulk
                      </Button>
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

      <BulkConfigDialog open={bulkConfigOpen} onClose={() => setBulkConfigOpen(false)} />

      <PackageDetailDialog
        packageId={drilldownId}
        open={!!drilldownId}
        onClose={() => setDrilldownId(null)}
      />
    </Card>
  );
}
