/**
 * ExamPoolRootCausePanel
 *
 * Zeigt Root-Cause-Analyse für TOO_FEW_APPROVED bzw. allgemein für
 * Pakete mit Exam-Pool-Defizit. Liefert eine strukturierte Diagnose
 * (fehlende Datenquelle/Regel) und einen One-Click-Auto-Fix.
 *
 * Backed by:
 *   - RPC fn_diagnose_exam_pool_deficit
 *   - RPC fn_autofix_exam_pool_deficit
 *   - Edge Function exam-pool-root-cause
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertOctagon, ArrowRight, CheckCircle2, Loader2, Microscope, Sparkles, Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type RootCauseCode =
  | 'PROMOTION_STALL'
  | 'PROMOTION_PARTIAL_PLUS_GENERATION'
  | 'COVERAGE_GAP'
  | 'GENERATION_DEFICIT'
  | 'QUALITY_DEFICIT'
  | 'UNKNOWN';

interface DiagnosisResponse {
  ok: boolean;
  error?: string;
  package?: {
    id: string;
    title: string;
    status: string;
    track: string;
    curriculum_id: string;
    is_rebuild: boolean;
  };
  metrics?: {
    total: number;
    approved: number;
    tier1_passed: number;
    tier1_promotable: number;
    draft: number;
    rejected: number;
    needs_review: number;
    min_required: number;
    current_deficit: number;
    deficit_after_promotion: number;
    lf_total: number;
    lf_covered: number;
    lf_missing: number;
  };
  root_cause?: { code: RootCauseCode; detail: string };
  recommended_fix?: {
    action: string;
    safe: boolean;
    one_click: boolean;
    expected_new_approved?: number;
    remaining_deficit?: number;
    exam_target?: number;
    missing_lf_count?: number;
  };
}

const ROOT_CAUSE_LABELS: Record<RootCauseCode, { label: string; tone: 'critical' | 'warn' | 'info' }> = {
  PROMOTION_STALL: { label: 'Promotion-Stau', tone: 'warn' },
  PROMOTION_PARTIAL_PLUS_GENERATION: { label: 'Promotion + Nachgenerierung', tone: 'warn' },
  COVERAGE_GAP: { label: 'Lernfeld-Lücke', tone: 'critical' },
  GENERATION_DEFICIT: { label: 'Generator-Defizit', tone: 'critical' },
  QUALITY_DEFICIT: { label: 'Qualitäts-Defizit', tone: 'critical' },
  UNKNOWN: { label: 'Unbekannt', tone: 'info' },
};

const ACTION_LABELS: Record<string, string> = {
  promote_tier1: 'Tier-1 Fragen freigeben',
  promote_then_generate: 'Freigeben + Nachgenerieren',
  enqueue_lf_gap_fill: 'Lernfeld-Lücken füllen',
  enqueue_generate_exam_pool: 'Pool nachgenerieren',
  rebuild_exam_pool: 'Pool komplett neu bauen',
  manual_review: 'Manuelle Prüfung erforderlich',
};

interface Props {
  packageId: string;
  /** Wenn gesetzt: Panel rendert nur wenn current_deficit > 0 */
  onlyWhenBlocked?: boolean;
}

export default function ExamPoolRootCausePanel({ packageId, onlyWhenBlocked = false }: Props) {
  const qc = useQueryClient();
  const [showDetails, setShowDetails] = useState(false);

  const diagnosis = useQuery({
    queryKey: ['exam-pool-root-cause', packageId],
    queryFn: async (): Promise<DiagnosisResponse> => {
      const { data, error } = await supabase.functions.invoke('exam-pool-root-cause', {
        body: { package_id: packageId, mode: 'diagnose' },
      });
      if (error) throw new Error(error.message);
      return data as DiagnosisResponse;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  const autofix = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('exam-pool-root-cause', {
        body: { package_id: packageId, mode: 'autofix' },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'autofix_failed');
      return data;
    },
    onSuccess: (data) => {
      const promoted = data?.promoted_count ?? 0;
      const jobs = Array.isArray(data?.enqueued_jobs) ? data.enqueued_jobs.length : 0;
      toast.success('Auto-Fix angewendet', {
        description: `${promoted} Fragen freigegeben · ${jobs} Folge-Job${jobs === 1 ? '' : 's'} gestartet`,
      });
      qc.invalidateQueries({ queryKey: ['exam-pool-root-cause', packageId] });
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['package'] });
    },
    onError: (e: Error) => {
      toast.error('Auto-Fix fehlgeschlagen', { description: e.message });
    },
  });

  const m = diagnosis.data?.metrics;
  const rc = diagnosis.data?.root_cause;
  const fix = diagnosis.data?.recommended_fix;

  // Suppress when not actually blocked
  if (onlyWhenBlocked && m && m.current_deficit === 0) return null;
  if (diagnosis.isLoading) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Analysiere Prüfungspool …
        </CardContent>
      </Card>
    );
  }
  if (diagnosis.isError || !diagnosis.data?.ok || !m || !rc) {
    return null;
  }

  const tone = ROOT_CAUSE_LABELS[rc.code]?.tone ?? 'info';
  const accent =
    tone === 'critical' ? 'border-destructive/40 bg-destructive/5'
    : tone === 'warn'   ? 'border-amber-500/40 bg-amber-500/5'
    : 'border-border';

  const progressPct = Math.min(100, Math.round((m.approved / Math.max(1, m.min_required)) * 100));

  return (
    <Card className={cn('overflow-hidden', accent)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Microscope className="h-4 w-4 shrink-0 text-foreground" />
            <CardTitle className="text-sm">Root-Cause: Prüfungspool</CardTitle>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'shrink-0 text-[11px]',
              tone === 'critical' && 'border-destructive/50 text-destructive',
              tone === 'warn' && 'border-amber-500/50 text-amber-600 dark:text-amber-400',
            )}
          >
            {ROOT_CAUSE_LABELS[rc.code].label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Headline metric */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-2xl font-semibold tabular-nums">
              {m.approved} <span className="text-sm font-normal text-muted-foreground">/ {m.min_required} freigegeben</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Defizit: {m.current_deficit} · Track {diagnosis.data.package?.track}
            </div>
          </div>
          <div className="shrink-0 w-24">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all',
                  progressPct >= 100 ? 'bg-emerald-500' : progressPct >= 50 ? 'bg-amber-500' : 'bg-destructive',
                )}
                style={{ width: `${Math.max(progressPct, 2)}%` }}
              />
            </div>
            <div className="mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">{progressPct}%</div>
          </div>
        </div>

        {/* Root cause detail */}
        <div className="rounded-lg border border-border/60 bg-card/40 p-3">
          <div className="flex items-start gap-2">
            <AlertOctagon className={cn('h-4 w-4 mt-0.5 shrink-0', tone === 'critical' ? 'text-destructive' : 'text-amber-500')} />
            <p className="text-sm leading-relaxed">{rc.detail}</p>
          </div>
        </div>

        {/* Recommended fix */}
        {fix && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="text-sm flex items-center gap-2 min-w-0">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <span className="font-medium">Empfohlen:</span>
              <span className="truncate">{ACTION_LABELS[fix.action] ?? fix.action}</span>
              {fix.expected_new_approved != null && (
                <Badge variant="outline" className="text-[11px] shrink-0">
                  → {fix.expected_new_approved} approved
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => autofix.mutate()}
              disabled={!fix.one_click || autofix.isPending}
              className="shrink-0"
            >
              {autofix.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : fix.one_click ? (
                <Wrench className="h-4 w-4 mr-1.5" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-1.5" />
              )}
              {fix.one_click ? 'Auto-Fix anwenden' : 'Manuelle Prüfung'}
            </Button>
          </div>
        )}

        {/* Toggle for raw metrics */}
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          {showDetails ? 'Details ausblenden' : 'Detail-Metriken anzeigen'}
        </button>

        {showDetails && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Metric label="Total" value={m.total} />
            <Metric label="Approved" value={m.approved} tone={m.approved >= m.min_required ? 'good' : undefined} />
            <Metric label="Tier-1 wartend" value={m.tier1_passed} highlight={m.tier1_promotable > 0} />
            <Metric label="Promotion-fähig" value={m.tier1_promotable} highlight={m.tier1_promotable > 0} />
            <Metric label="Draft" value={m.draft} />
            <Metric label="Rejected" value={m.rejected} />
            <Metric label="LF abgedeckt" value={`${m.lf_covered}/${m.lf_total}`} tone={m.lf_missing === 0 ? 'good' : 'warn'} />
            <Metric label="LF Lücken" value={m.lf_missing} tone={m.lf_missing > 0 ? 'warn' : 'good'} />
          </div>
        )}

        {m.current_deficit === 0 && (
          <div className="flex items-center gap-2 text-xs text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Pool erfüllt Mindestanforderung — kein Eingriff nötig.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label, value, tone, highlight,
}: { label: string; value: string | number; tone?: 'good' | 'warn'; highlight?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-md border border-border/60 bg-background/40 px-2 py-1.5',
        highlight && 'border-primary/50 bg-primary/5',
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-sm font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-500',
          tone === 'warn' && 'text-amber-500',
        )}
      >
        {value}
      </div>
    </div>
  );
}
