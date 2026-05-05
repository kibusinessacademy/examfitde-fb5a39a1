import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  AlertOctagon, AlertTriangle, CheckCircle2, History, Loader2, PlayCircle, RefreshCw, WifiOff, Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { parseHealError, type ParsedHealError } from './healErrorParser';

// ---------- Types ----------
interface ValidationWarning {
  id: string;
  package_id: string | null;
  title: string;
  body: string;
  severity: 'high' | 'medium' | 'info' | string;
  job_type: string | null;
  mode: string | null;
  source_job_id: string | null;
  created_at: string;
  is_read: boolean;
  cluster?: string | null;
}

interface AuditRow {
  id: string;
  created_at: string;
  source: string;
  cluster: string | null;
  source_job_id: string | null;
  package_id: string | null;
  job_type: string;
  mode: string | null;
  is_valid: boolean;
  severity: string | null;
  reason: string | null;
  decision: string;
  payload_excerpt: Record<string, unknown> | null;
  validation: Record<string, unknown> | null;
}

interface RepairPreviewResult {
  decision?: string;
  reason?: string;
  severity?: string | null;
  strategy?: string | null;
  job_type?: string | null;
  mode?: string | null;
  is_valid?: boolean;
  duplicate_active_job?: boolean;
  preview_only?: boolean;
  validation?: Record<string, unknown> | null;
  resolver?: {
    reason?: string;
    strategy?: string | null;
    job_type?: string | null;
    payload?: Record<string, unknown> | null;
  } | null;
}

interface RepairExecuteResult {
  ok?: boolean;
  error?: string;
  decision?: string;
  reason?: string;
  job_id?: string;
  job_type?: string | null;
  mode?: string | null;
  preview?: RepairPreviewResult | null;
  validation?: Record<string, unknown> | null;
}

interface InlineFeedback {
  tone: 'success' | 'warning' | 'destructive';
  title: string;
  description: string;
  details?: string[];
}

const INLINE_FEEDBACK_TONE: Record<InlineFeedback['tone'], string> = {
  success: 'border-success/30 bg-success-bg-subtle text-success',
  warning: 'border-warning/30 bg-warning-bg-subtle text-warning',
  destructive: 'border-destructive/30 bg-destructive-bg-subtle text-destructive',
};

function humanizeRepairReason(reason?: string | null, strategy?: string | null) {
  switch (reason ?? strategy ?? '') {
    case 'all_competencies_have_questions':
    case 'no_action_no_deficit':
      return 'Für dieses Paket wurde aktuell keine Coverage-Lücke gefunden.';
    case 'duplicate_active_job':
    case 'no_action_active_job_exists':
      return 'Für dieses Paket läuft bereits ein passender Repair-Job oder er ist schon eingereiht.';
    case 'manual_review_required':
    case 'recent_no_effect_or_no_progress_history':
      return 'Die automatische Reparatur ist gesperrt, weil zuletzt kein Fortschritt erreicht wurde. Bitte manuell prüfen.';
    case 'no_package_or_curriculum':
      return 'Für dieses Paket fehlt die erforderliche SSOT-Zuordnung zum Curriculum.';
    case 'no_competencies_in_curriculum':
      return 'Im zugehörigen Curriculum wurden keine Kompetenzen gefunden.';
    case 'no_blueprints_yet':
      return 'Es existieren noch keine Blueprints — zunächst wird ein Blueprint-Seed eingereiht.';
    case 'admin_only':
      return 'Diese Reparatur darf nur mit Admin-Rechten ausgeführt werden.';
    default:
      if (reason?.startsWith('missing_questions_for_')) {
        return `Es fehlen noch Fragen in mehreren Kompetenzen — eine gezielte Coverage-Reparatur kann eingereiht werden.`;
      }
      return reason ?? strategy ?? 'Unbekannter Reparaturstatus.';
  }
}

function buildPreviewFeedback(preview: RepairPreviewResult): InlineFeedback {
  const decision = preview.decision ?? 'preview_skip';
  const validationWarning = typeof preview.validation?.warning === 'string' ? preview.validation.warning : null;
  const details = [
    preview.strategy ? `Strategie: ${preview.strategy}` : null,
    preview.job_type ? `Job-Typ: ${preview.job_type}` : null,
    preview.mode ? `Mode: ${preview.mode}` : null,
    validationWarning,
  ].filter(Boolean) as string[];

  if (decision === 'preview_ok') {
    return {
      tone: 'success',
      title: 'Reparatur möglich',
      description: humanizeRepairReason(preview.reason, preview.strategy),
      details,
    };
  }

  return {
    tone: decision === 'preview_skip' ? 'warning' : 'destructive',
    title: 'Reparatur derzeit blockiert',
    description: humanizeRepairReason(preview.reason, preview.strategy),
    details,
  };
}

const SEVERITY_META: Record<string, { cls: string; icon: typeof AlertTriangle; label: string }> = {
  high:   { cls: 'border-destructive/40 bg-destructive-bg-subtle text-destructive', icon: AlertOctagon,  label: 'Kritisch' },
  medium: { cls: 'border-warning/40 bg-warning-bg-subtle text-warning',             icon: AlertTriangle, label: 'Warnung' },
  info:   { cls: 'border-border bg-muted/30 text-foreground',                icon: AlertTriangle, label: 'Info' },
};

const SESSION_KEY = 'queue-validation-warnings-filters-v1';

interface Filters {
  severities: string[]; // empty = all
  clusters: string[];   // empty = all
}

function loadFilters(): Filters {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { severities: [], clusters: [] };
    const p = JSON.parse(raw);
    return {
      severities: Array.isArray(p.severities) ? p.severities : [],
      clusters:   Array.isArray(p.clusters)   ? p.clusters   : [],
    };
  } catch {
    return { severities: [], clusters: [] };
  }
}

function saveFilters(f: Filters) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

// ---------- Component ----------
export function QueueValidationWarnings() {
  const [filters, setFilters] = useState<Filters>(() => loadFilters());
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  useEffect(() => { saveFilters(filters); }, [filters]);

  const warnings = useQuery({
    queryKey: ['queue-validation-warnings'],
    queryFn: async () => {
      // Dedup: abort any in-flight request before starting a new one
      if (inflightRef.current) inflightRef.current.abort();
      const ctrl = new AbortController();
      inflightRef.current = ctrl;
      try {
        const { data, error } = await supabase.rpc(
          'admin_get_queue_validation_warnings' as any,
          { _limit: 25 }
        );
        if (ctrl.signal.aborted) throw new Error('aborted');
        if (error) throw error;
        setLastError(null);
        setLastFetchedAt(new Date());
        return (data ?? []) as unknown as ValidationWarning[];
      } catch (e: any) {
        if (e?.message !== 'aborted') {
          setLastError(e?.message ?? 'Unbekannter Fehler');
        }
        throw e;
      } finally {
        if (inflightRef.current === ctrl) inflightRef.current = null;
      }
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const allWarnings = warnings.data ?? [];
  const unread = allWarnings.filter((w) => !w.is_read);

  // Available facets (from current data)
  const availableSeverities = useMemo(
    () => Array.from(new Set(unread.map((w) => w.severity))).filter(Boolean),
    [unread],
  );
  const availableClusters = useMemo(
    () => Array.from(new Set(unread.map((w) => w.cluster).filter((c): c is string => !!c))),
    [unread],
  );

  // Apply filters
  const filtered = unread.filter((w) => {
    if (filters.severities.length > 0 && !filters.severities.includes(w.severity)) return false;
    if (filters.clusters.length > 0 && (!w.cluster || !filters.clusters.includes(w.cluster))) return false;
    return true;
  });

  const showStaleStatus = lastError && allWarnings.length === 0;
  const hasFiltersActive = filters.severities.length > 0 || filters.clusters.length > 0;

  if (unread.length === 0 && !showStaleStatus) return null;

  const top = filtered[0] ?? unread[0];
  const meta = top ? (SEVERITY_META[top.severity] ?? SEVERITY_META.info) : SEVERITY_META.info;
  const Icon = meta.icon;

  const toggle = (key: 'severities' | 'clusters', value: string) => {
    setFilters((prev) => {
      const cur = prev[key];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [key]: next };
    });
  };

  return (
    <Card className={cn('border-2', meta.cls)}>
      <CardContent className="p-3 space-y-2">
        {/* Stale / error banner */}
        {lastError && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <WifiOff className="h-3 w-3" />
            <span>
              Letztes Update fehlgeschlagen
              {lastFetchedAt && <> · zuletzt erfolgreich {lastFetchedAt.toLocaleTimeString('de-DE')}</>}
            </span>
            <Button
              size="sm" variant="ghost"
              className="h-5 px-1.5 text-[10px]"
              onClick={() => warnings.refetch()}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Neu laden
            </Button>
          </div>
        )}

        {top && (
          <div className="flex items-start gap-3">
            <Icon className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-sm font-semibold">Repair-Validierung</span>
                <Badge variant="outline" className={cn('h-4 px-1.5 text-[9px]', meta.cls)}>
                  {meta.label}
                </Badge>
                {filtered.length > 1 && (
                  <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                    +{filtered.length - 1} weitere
                  </Badge>
                )}
                {hasFiltersActive && (
                  <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                    {filtered.length}/{unread.length} gefiltert
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <DrilldownSheet warning={top} />
                </div>
              </div>
              <div className="text-xs font-medium">{top.title}</div>
              <div className="text-[11px] opacity-80 mt-0.5 line-clamp-2">{top.body}</div>
              {(top.job_type || top.mode || top.cluster) && (
                <div className="flex flex-wrap gap-1 mt-1.5 text-[10px] font-mono">
                  {top.cluster && (
                    <span className="rounded bg-background/60 px-1.5 py-0.5 border border-border/60">
                      cluster: {top.cluster}
                    </span>
                  )}
                  {top.job_type && (
                    <span className="rounded bg-background/60 px-1.5 py-0.5 border border-border/60">
                      job_type: {top.job_type}
                    </span>
                  )}
                  {top.mode && (
                    <span className="rounded bg-background/60 px-1.5 py-0.5 border border-border/60">
                      mode: {top.mode}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Filter chips */}
        {(availableSeverities.length > 1 || availableClusters.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Filter:</span>
            {availableSeverities.map((sev) => (
              <Chip
                key={`sev-${sev}`}
                active={filters.severities.includes(sev)}
                onClick={() => toggle('severities', sev)}
                label={SEVERITY_META[sev]?.label ?? sev}
              />
            ))}
            {availableClusters.map((cl) => (
              <Chip
                key={`cl-${cl}`}
                active={filters.clusters.includes(cl)}
                onClick={() => toggle('clusters', cl)}
                label={cl}
                mono
              />
            ))}
            {hasFiltersActive && (
              <Button
                size="sm" variant="ghost"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => setFilters({ severities: [], clusters: [] })}
              >
                Reset
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Subcomponents ----------
function Chip({
  active, label, onClick, mono,
}: { active: boolean; label: string; onClick: () => void; mono?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-5 px-1.5 rounded border text-[10px] transition-colors',
        mono && 'font-mono',
        active
          ? 'bg-foreground text-background border-foreground'
          : 'bg-background/60 text-foreground border-border/60 hover:bg-background',
      )}
    >
      {label}
    </button>
  );
}

function DrilldownSheet({ warning }: { warning: ValidationWarning }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<RepairPreviewResult | null>(null);
  const [feedback, setFeedback] = useState<InlineFeedback | null>(null);
  const qc = useQueryClient();

  const audit = useQuery({
    queryKey: ['queue-validation-audit', warning.package_id, warning.source_job_id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'admin_get_queue_validation_audit' as any,
        {
          _limit: 50,
          _package_id: warning.package_id,
          _source_job_id: warning.source_job_id,
          _only_invalid: false,
        },
      );
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  const activeRepair = useQuery({
    queryKey: ['package-active-repair', warning.package_id],
    enabled: open && !!warning.package_id,
    queryFn: async () => {
      if (!warning.package_id) return 0;
      const { count, error } = await supabase
        .from('job_queue')
        .select('id', { count: 'exact', head: true })
        .eq('package_id', warning.package_id)
        .in('status', ['processing', 'running', 'pending', 'queued'])
        .like('job_type', 'package_repair_%');
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 5_000,
  });

  const hasActiveRepair = (activeRepair.data ?? 0) > 0;

  const dryRun = useMutation({
    mutationFn: async () => {
      if (!warning.package_id) throw new Error('Kein package_id verfügbar');
      const { data, error } = await supabase.rpc(
        'admin_dry_run_repair_for_package' as any,
        { _package_id: warning.package_id },
      );
      if (error) throw error;
      return (data ?? {}) as RepairPreviewResult;
    },
    onSuccess: (res) => {
      setPreview(res);
      const nextFeedback = buildPreviewFeedback(res);
      setFeedback(nextFeedback);
      toast.success(`Dry-Run: ${res?.decision ?? 'unbekannt'}`);
      audit.refetch();
    },
    onError: (err: unknown) => {
      const parsed = parseHealError(err);
      setPreview(null);
      setFeedback({
        tone: 'destructive',
        title: parsed.title,
        description: parsed.description,
        details: parsed.details,
      });
      toast.error(parsed.title, { description: parsed.description });
    },
  });

  const executeRepair = useMutation({
    mutationFn: async () => {
      if (!warning.package_id) throw new Error('Kein package_id verfügbar');
      const { data, error } = await supabase.rpc(
        'admin_execute_repair_for_package' as any,
        { _package_id: warning.package_id },
      );
      if (error) throw error;
      return (data ?? {}) as RepairExecuteResult;
    },
    onSuccess: (res) => {
      if (res.ok) {
        setFeedback({
          tone: 'success',
          title: 'Repair-Job eingereiht',
          description: `Die Reparatur wurde gestartet${res.job_id ? ` (Job ${res.job_id.slice(0, 8)}…)` : ''}.`,
          details: [res.job_type ? `Job-Typ: ${res.job_type}` : null, res.mode ? `Mode: ${res.mode}` : null].filter(Boolean) as string[],
        });
        toast.success('Repair-Job eingereiht');
      } else {
        const previewData = res.preview ?? preview;
        setFeedback(previewData ? buildPreviewFeedback(previewData) : {
          tone: 'warning',
          title: 'Reparatur nicht eingereiht',
          description: humanizeRepairReason(res.reason, preview?.strategy),
        });
        toast.warning('Reparatur nicht eingereiht', { description: humanizeRepairReason(res.reason, preview?.strategy) });
      }
      qc.invalidateQueries({ queryKey: ['queue-validation-warnings'] });
      qc.invalidateQueries({ queryKey: ['package-active-repair', warning.package_id] });
      audit.refetch();
    },
    onError: (err: unknown) => {
      const parsed = parseHealError(err);
      setFeedback({
        tone: 'destructive',
        title: parsed.title,
        description: parsed.description,
        details: parsed.details,
      });
      toast.error(parsed.title, { description: parsed.description });
    },
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]">
          <History className="h-3 w-3 mr-1" /> Audit
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm">Validation Audit · Drilldown</SheetTitle>
          <SheetDescription>
            Vorschau, Diagnose und direkte Reparatur für das betroffene Paket.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 space-y-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">package: {warning.package_id?.slice(0, 8) ?? '—'}</Badge>
            {warning.job_type && <Badge variant="outline">{warning.job_type}</Badge>}
            {warning.mode && <Badge variant="outline">mode: {warning.mode}</Badge>}
          </div>
          <p className="text-muted-foreground">{warning.body}</p>
          {feedback && (
            <div className={cn('rounded-md border p-2 space-y-1 text-[11px]', INLINE_FEEDBACK_TONE[feedback.tone])}>
              <div className="font-semibold">{feedback.title}</div>
              <div>{feedback.description}</div>
              {feedback.details && feedback.details.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {feedback.details.slice(0, 3).map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
              )}
            </div>
          )}
          {hasActiveRepair && (
            <div className="rounded-md border border-warning/30 bg-warning-bg-subtle p-2 text-[11px] text-warning">
              Für dieses Paket läuft bereits ein Repair-Job — neuer Start ist blockiert, bis der aktuelle Lauf fertig ist.
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => dryRun.mutate()} disabled={dryRun.isPending || executeRepair.isPending} className="h-7 text-[11px]">
              {dryRun.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <PlayCircle className="h-3 w-3 mr-1" />}Dry-Run jetzt ausführen
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => executeRepair.mutate()}
              disabled={hasActiveRepair || executeRepair.isPending || dryRun.isPending || preview?.decision !== 'preview_ok'}
              className="h-7 text-[11px]"
            >
              {executeRepair.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wrench className="h-3 w-3 mr-1" />}Repair jetzt starten
            </Button>
            <Button size="sm" variant="outline" onClick={() => audit.refetch()} className="h-7 text-[11px]">
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh Audit
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Audit-Einträge ({audit.data?.length ?? 0})
          </div>
          {audit.isLoading && <div className="text-xs text-muted-foreground">Lade …</div>}
          {audit.error && (
            <div className="text-xs text-destructive">
              Fehler beim Laden: {(audit.error as Error).message}
            </div>
          )}
          {audit.data?.length === 0 && !audit.isLoading && (
            <div className="text-xs text-muted-foreground">Keine Audit-Einträge gefunden.</div>
          )}
          {audit.data?.map((row) => (
            <AuditRowItem key={row.id} row={row} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AuditRowItem({ row }: { row: AuditRow }) {
  const sev = SEVERITY_META[row.severity ?? 'info'] ?? SEVERITY_META.info;
  const decisionColor =
    row.decision === 'enqueued' || row.decision === 'preview_ok'
      ? 'text-success'
      : row.decision === 'preview_skip' || row.decision === 'skipped'
      ? 'text-muted-foreground'
      : 'text-warning';

  return (
    <div className="rounded border border-border/60 bg-background/40 p-2 text-[11px] space-y-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        {row.is_valid
          ? <CheckCircle2 className="h-3 w-3 text-success" />
          : <AlertOctagon className="h-3 w-3 text-destructive" />}
        <span className={cn('font-semibold', decisionColor)}>{row.decision}</span>
        <Badge variant="outline" className={cn('h-4 px-1 text-[9px]', sev.cls)}>
          {row.severity ?? 'info'}
        </Badge>
        <Badge variant="outline" className="h-4 px-1 text-[9px]">{row.source}</Badge>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {new Date(row.created_at).toLocaleString('de-DE')}
        </span>
      </div>
      <div className="font-mono text-[10px] flex flex-wrap gap-1">
        <span className="rounded bg-muted/50 px-1">{row.job_type}</span>
        {row.mode && <span className="rounded bg-muted/50 px-1">mode: {row.mode}</span>}
        {row.cluster && <span className="rounded bg-muted/50 px-1">{row.cluster}</span>}
      </div>
      {row.reason && <div className="text-foreground/80">{row.reason}</div>}
    </div>
  );
}
