/**
 * RepairExhaustedAlert — Prominent alert for packages where auto-repair
 * has exhausted its retry limit and requires manual intervention.
 * Includes filter by error category and fixed repair action dispatching.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertOctagon, ArrowRight, RefreshCw, Loader2, Wrench, Zap,
  Filter, ChevronDown, ChevronUp,
} from 'lucide-react';

/* ── Types ── */

interface ExhaustedPackage {
  package_id: string;
  title: string;
  status: string;
  build_progress: number;
  attempts: number;
  consecutive_no_progress: number;
  hard_fail_reasons: string[];
  guard_state: string;
  last_validate_at: string | null;
  error_categories: ErrorCategory[];
}

type ErrorCategory =
  | 'EXAM_POOL'
  | 'COMPETENCY'
  | 'MINICHECK'
  | 'TRAP'
  | 'BLOOM'
  | 'LESSON_QUALITY'
  | 'OTHER';

type StatusFilter = 'ALL' | 'building' | 'blocked' | 'queued' | 'published' | 'other_status';

const STATUS_LABELS: Record<StatusFilter, string> = {
  ALL: 'Alle Status',
  building: 'Building',
  blocked: 'Blockiert',
  queued: 'Queued',
  published: 'Publiziert',
  other_status: 'Sonstige',
};

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  EXAM_POOL: 'Exam-Pool',
  COMPETENCY: 'Kompetenz-Abdeckung',
  MINICHECK: 'MiniChecks',
  TRAP: 'Trap-Verteilung',
  BLOOM: 'Bloom-Taxonomie',
  LESSON_QUALITY: 'Lektionsqualität',
  OTHER: 'Sonstige',
};

const CATEGORY_COLORS: Record<ErrorCategory, string> = {
  EXAM_POOL: 'bg-red-900/40 text-red-300 border-red-700/50',
  COMPETENCY: 'bg-orange-900/40 text-orange-300 border-orange-700/50',
  MINICHECK: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  TRAP: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  BLOOM: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  LESSON_QUALITY: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  OTHER: 'bg-muted text-muted-foreground border-border',
};

/* ── Helpers ── */

function categorizeReasons(reasons: string[]): ErrorCategory[] {
  const cats = new Set<ErrorCategory>();
  for (const r of reasons) {
    const upper = r.toUpperCase();
    if (upper.includes('HARDISH') || upper.includes('TOO_FEW_APPROVED') || upper.includes('EXAM_POOL'))
      cats.add('EXAM_POOL');
    if (upper.includes('COMPETENCY') || upper.includes('COVERAGE'))
      cats.add('COMPETENCY');
    if (upper.includes('MINICHECK') || upper.includes('UNPARSED'))
      cats.add('MINICHECK');
    if (upper.includes('TRAP'))
      cats.add('TRAP');
    if (upper.includes('BLOOM'))
      cats.add('BLOOM');
    if (upper.includes('LESSON_QUALITY') || upper.includes('PLACEHOLDER') || upper.includes('TIER1_HOLLOW'))
      cats.add('LESSON_QUALITY');
  }
  if (cats.size === 0 && reasons.length > 0) cats.add('OTHER');
  if (cats.size === 0) cats.add('OTHER');
  return Array.from(cats);
}

function hasCategory(pkg: ExhaustedPackage, cat: ErrorCategory): boolean {
  return Array.isArray(pkg.error_categories) && pkg.error_categories.includes(cat);
}

/* ── Data Hook ── */

function useRepairExhaustedPackages() {
  return useQuery({
    queryKey: ['admin', 'repair-exhausted'],
    queryFn: async (): Promise<ExhaustedPackage[]> => {
      const { data: steps, error } = await (supabase as any)
        .from('package_steps')
        .select('package_id, meta, attempts')
        .eq('step_key', 'validate_exam_pool')
        .not('meta', 'is', null);

      if (error) throw error;

      const exhausted = (steps || []).filter((s: any) => {
        const meta = s.meta || {};
        return (
          meta.guard_state === 'hard_stalled' ||
          (meta.reason_codes && (meta.reason_codes as string[]).includes('HARD_FAIL_REPAIR_EXHAUSTED')) ||
          (meta.consecutive_no_progress && meta.consecutive_no_progress >= 10)
        );
      });

      if (exhausted.length === 0) return [];

      const ids = exhausted.map((s: any) => s.package_id);

      const [{ data: pkgs }, { data: cpkgs }] = await Promise.all([
        (supabase as any)
          .from('v_admin_packages_ssot')
          .select('package_id, canonical_title, raw_title, status, build_progress')
          .in('package_id', ids),
        (supabase as any)
          .from('course_packages')
          .select('id, integrity_report')
          .in('id', ids),
      ]);

      const pkgMap = new Map<string, any>();
      for (const p of pkgs || []) pkgMap.set(p.package_id, p);
      const reportMap = new Map<string, any>();
      for (const c of cpkgs || []) reportMap.set(c.id, c.integrity_report);

      return exhausted.map((s: any) => {
        const pkg = pkgMap.get(s.package_id) || {};
        const report = reportMap.get(s.package_id);
        const summary = report?.v3?.summary || {};
        const hardFails: string[] = summary.hard_fail_reasons || [];

        return {
          package_id: s.package_id,
          title: pkg.canonical_title || pkg.raw_title || 'Unbenannt',
          status: pkg.status || 'unknown',
          build_progress: pkg.build_progress ?? 0,
          attempts: s.attempts || s.meta?.attempts || 0,
          consecutive_no_progress: s.meta?.consecutive_no_progress || s.attempts || s.meta?.attempts || 0,
          hard_fail_reasons: hardFails,
          guard_state: s.meta?.guard_state || 'unknown',
          last_validate_at: s.meta?.last_validate_completed_at || null,
          error_categories: categorizeReasons(hardFails),
        };
      });
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/* ── Row Component ── */

function ExhaustedPackageRow({ pkg, onRepair, busyId }: {
  pkg: ExhaustedPackage;
  onRepair: (packageId: string, action: string) => void;
  busyId: string | null;
}) {
  const busy = busyId === pkg.package_id;
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/admin/studio/${pkg.package_id}`}
            className="text-sm font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            {pkg.title}
            <ArrowRight className="h-3 w-3 shrink-0" />
          </Link>
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {pkg.package_id.slice(0, 8)} · {pkg.build_progress}% · {pkg.consecutive_no_progress} Versuche ohne Fortschritt
          </div>
        </div>
        <Badge variant="destructive" className="text-[10px] shrink-0">
          Exhausted
        </Badge>
      </div>

      {pkg.hard_fail_reasons.length > 0 && (
        <div className="space-y-1">
          {pkg.hard_fail_reasons.map((reason, i) => {
            const colonIdx = reason.indexOf(':');
            const label = colonIdx > 0 ? reason.slice(0, colonIdx).trim() : reason;
            const detail = colonIdx > 0 ? reason.slice(colonIdx + 1).trim() : '';
            return (
              <div key={i} className="text-[11px] text-destructive/90">
                <span className="font-medium">{label}</span>
                {detail && <span className="text-muted-foreground ml-1">— {detail}</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {/* Show contextual buttons based on error categories */}
        {hasCategory(pkg, 'EXAM_POOL') && (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-[11px] gap-1"
            disabled={busy}
            onClick={() => onRepair(pkg.package_id, 'force_pool_fill')}
            title="Pool-Fill + Validate-Reset (umgeht WIP-Cap nicht)"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Force Pool-Fill
          </Button>
        )}
        {hasCategory(pkg, 'COMPETENCY') && (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-[11px] gap-1"
            disabled={busy}
            onClick={() => onRepair(pkg.package_id, 'force_pool_fill')}
            title="Fragen für fehlende Kompetenzen generieren"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Coverage Pool-Fill
          </Button>
        )}
        {hasCategory(pkg, 'MINICHECK') && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1 border-yellow-600/50 text-yellow-300 hover:bg-yellow-900/30"
            disabled={busy}
            onClick={() => onRepair(pkg.package_id, 'repair_minichecks')}
            title="MiniChecks für Lektionen ohne Fragen neu generieren"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
            MiniChecks reparieren
          </Button>
        )}
        {(hasCategory(pkg, 'COMPETENCY') || pkg.hard_fail_reasons.some(r => r.toUpperCase().includes('STEP_GAP'))) && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1 border-orange-600/50 text-orange-300 hover:bg-orange-900/30"
            disabled={busy}
            onClick={() => onRepair(pkg.package_id, 'repair_lessons')}
            title="5-Schritte-Lektionen für fehlende Kompetenzen regenerieren"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
            Lektionen reparieren
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1"
          disabled={busy}
          onClick={() => onRepair(pkg.package_id, 'repair_exam_pool_quality')}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
          Exam-Pool reparieren
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1"
          disabled={busy}
          onClick={() => onRepair(pkg.package_id, 'retry_validate')}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Validate Reset
        </Button>
      </div>
    </div>
  );
}

/* ── Main Component ── */

export function RepairExhaustedAlert() {
  const { data: exhausted = [] } = useRepairExhaustedPackages();
  const qc = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<ErrorCategory | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [collapsed, setCollapsed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Compute available categories (safe against undefined error_categories)
  const categoryStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const pkg of exhausted) {
      const cats = Array.isArray(pkg.error_categories) ? pkg.error_categories : [];
      for (const cat of cats) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return counts;
  }, [exhausted]);

  // Compute status counts
  const statusStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const pkg of exhausted) {
      const s = ['building', 'blocked', 'queued', 'published'].includes(pkg.status) ? pkg.status : 'other_status';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [exhausted]);

  const filteredPackages = useMemo(() => {
    let result = exhausted;
    if (activeFilter !== 'ALL') {
      result = result.filter(p => (Array.isArray(p.error_categories) ? p.error_categories : []).includes(activeFilter));
    }
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'other_status') {
        result = result.filter(p => !['building', 'blocked', 'queued', 'published'].includes(p.status));
      } else {
        result = result.filter(p => p.status === statusFilter);
      }
    }
    return result;
  }, [exhausted, activeFilter, statusFilter]);

  const repairMutation = useMutation({
    mutationFn: async ({ packageId, action }: { packageId: string; action: string }) => {
      setBusyId(packageId);
      if (action === 'force_pool_fill') {
        await runAdminOpsAction('repair_exam_pool_quality', { package_id: packageId });
        return runAdminOpsAction('reset_to_step', { package_id: packageId, step_key: 'validate_exam_pool' });
      }
      if (action === 'retry_validate') {
        return runAdminOpsAction('reset_to_step', { package_id: packageId, step_key: 'validate_exam_pool' });
      }
      if (action === 'repair_minichecks') {
        return runAdminOpsAction('repair_minichecks', { package_id: packageId });
      }
      if (action === 'repair_lessons') {
        return runAdminOpsAction('repair_lessons', { package_id: packageId });
      }
      return runAdminOpsAction(action as any, { package_id: packageId });
    },
    onSuccess: (_data, vars) => {
      toast.success(`Reparatur für ${vars.packageId.slice(0, 8)} gestartet`);
      qc.invalidateQueries({ queryKey: ['admin', 'repair-exhausted'] });
      qc.invalidateQueries({ queryKey: ['admin'] });
      setBusyId(null);
    },
    onError: (err: Error, vars) => {
      const msg = err.message;
      if (msg.includes('WIP_CAP_EXCEEDED')) {
        toast.error('WIP-Limit erreicht — es bauen bereits zu viele Pakete. Warte bis Slots frei werden.', { duration: 6000 });
      } else if (msg.includes('REGRESSION_BLOCKED')) {
        toast.error('Step-Regression blockiert. Verwende "reset_to_step" im Workspace.', { duration: 6000 });
      } else {
        toast.error(`Fehler: ${msg}`);
      }
      setBusyId(null);
    },
  });

  if (exhausted.length === 0) return null;

  const availableCategories = Object.keys(categoryStats) as ErrorCategory[];

  return (
    <div className="rounded-xl border-2 border-destructive/50 bg-destructive/5 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-500">
      {/* Header */}
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setCollapsed(c => !c)}
      >
        <AlertOctagon className="h-5 w-5 text-destructive shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-destructive">
            {exhausted.length} Paket{exhausted.length > 1 ? 'e' : ''}: Auto-Repair Limit erreicht
          </div>
          <div className="text-[11px] text-muted-foreground">
            Maximale Reparaturversuche überschritten — manuelles Eingreifen nötig.
          </div>
        </div>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </div>

      {!collapsed && (
        <>
          {/* Status Filter Bar */}
          {Object.keys(statusStats).length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[10px] text-muted-foreground font-medium shrink-0">Status:</span>
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                  statusFilter === 'ALL'
                    ? 'bg-primary/20 text-primary border-primary/40'
                    : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                }`}
              >
                Alle ({exhausted.length})
              </button>
              {(Object.keys(statusStats) as StatusFilter[]).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(statusFilter === s ? 'ALL' : s)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                    statusFilter === s
                      ? 'bg-primary/20 text-primary border-primary/40'
                      : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  {STATUS_LABELS[s]} ({statusStats[s]})
                </button>
              ))}
            </div>
          )}

          {/* Category Filter Bar */}
          {availableCategories.length > 1 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <button
                onClick={() => setActiveFilter('ALL')}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                  activeFilter === 'ALL'
                    ? 'bg-destructive/20 text-destructive border-destructive/40'
                    : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                }`}
              >
                Alle ({exhausted.length})
              </button>
              {availableCategories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveFilter(activeFilter === cat ? 'ALL' : cat)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                    activeFilter === cat
                      ? CATEGORY_COLORS[cat]
                      : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  {CATEGORY_LABELS[cat]} ({categoryStats[cat]})
                </button>
              ))}
            </div>
          )}

          {/* Package List */}
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filteredPackages.map((pkg) => (
              <ExhaustedPackageRow
                key={pkg.package_id}
                pkg={pkg}
                onRepair={(packageId, action) =>
                  repairMutation.mutate({ packageId, action })
                }
                busyId={busyId}
              />
            ))}
          </div>

          {/* Summary hint */}
          <div className="text-[10px] text-muted-foreground border-t border-border/50 pt-2">
            💡 <strong>WIP-Cap:</strong> Force Pool-Fill funktioniert nur wenn Building-Slots frei sind (aktuell max 13).
            Bei "Exhausted" Paketen mit hohem Progress (&gt;80%) reicht oft ein einzelner "Validate Reset".
          </div>
        </>
      )}
    </div>
  );
}

export default RepairExhaustedAlert;
