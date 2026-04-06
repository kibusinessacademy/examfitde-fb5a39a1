import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminPackagesSSOT, AdminPackageSSOT } from '@/hooks/useAdminPackagesSSOT';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowRight, Search, Package, ChevronDown, Play, RotateCcw,
  Loader2, Skull, Trash2, Unlock, AlertTriangle, CheckCircle2,
  TrendingDown, Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_FILTERS = [
  { key: 'all', label: 'Alle' },
  { key: 'ready_for_approval', label: '🟢 Publish-Ready' },
  { key: 'waiting_for_council', label: '🟡 Council offen' },
  { key: 'early_pipeline', label: '⚪ Frühe Pipeline' },
  { key: 'building', label: 'Building' },
  { key: 'council_review', label: 'Council' },
  { key: 'queued', label: 'Queued' },
  { key: 'published', label: 'Published' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'failed', label: 'Failed' },
  { key: 'stuck', label: 'Festgefahren' },
  { key: 'publish_drift', label: 'Publish Drift' },
] as const;

function statusBadge(pkg: AdminPackageSSOT) {
  const badges: { label: string; className: string }[] = [];
  const statusMap: Record<string, { label: string; className: string }> = {
    published: { label: 'Veröffentlicht', className: 'bg-success/10 text-success border-success/30' },
    building: { label: 'Building', className: 'bg-primary/10 text-primary border-primary/30' },
    council_review: { label: 'Council', className: 'bg-warning/10 text-warning border-warning/30' },
    queued: { label: 'Queued', className: 'bg-muted text-muted-foreground border-border' },
    blocked: { label: 'Blockiert', className: 'bg-destructive/10 text-destructive border-destructive/30' },
    failed: { label: 'Fehlgeschlagen', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  };
  const s = statusMap[pkg.status] || { label: pkg.status, className: 'bg-muted text-muted-foreground border-border' };
  badges.push(s);
  if (pkg.is_stuck) badges.push({ label: 'Festgefahren', className: 'bg-destructive/10 text-destructive border-destructive/30' });
  if (pkg.has_publish_drift) badges.push({ label: 'Publish Drift', className: 'bg-destructive/10 text-destructive border-destructive/30' });
  if (pkg.has_stale_publish) badges.push({ label: 'Stale Publish', className: 'bg-warning/10 text-warning border-warning/30' });
  if (pkg.council_complete && !pkg.council_approved) badges.push({ label: 'Council ✓ / Approval ✗', className: 'bg-warning/10 text-warning border-warning/30' });
  if (pkg.council_sessions_pending > 0) badges.push({ label: `Council ${pkg.council_sessions_pending} offen`, className: 'bg-warning/10 text-warning border-warning/30' });
  if (pkg.jobs_failed > 0) badges.push({ label: `${pkg.jobs_failed} Jobs failed`, className: 'bg-destructive/10 text-destructive border-destructive/30' });
  return badges;
}

function diagnosePkg(pkg: AdminPackageSSOT): { text: string; severity: 'info' | 'warning' | 'error' }[] {
  const diags: { text: string; severity: 'info' | 'warning' | 'error' }[] = [];

  if (pkg.is_stuck) {
    diags.push({ text: `Festgefahren: ${pkg.stuck_reason || 'Pipeline stalled ohne aktive Jobs'}`, severity: 'error' });
  }
  if (pkg.has_publish_drift) {
    diags.push({ text: 'Publish Drift: Status ist „published", aber Integrity/Council nicht bestanden.', severity: 'error' });
  }
  if (pkg.has_stale_publish) {
    diags.push({ text: 'Stale Publish: Historischer Publish-Marker, aber Paket nicht veröffentlicht.', severity: 'warning' });
  }
  if (pkg.status === 'blocked' && pkg.blocked_reason) {
    diags.push({ text: `Blockiert: ${pkg.blocked_reason}`, severity: 'warning' });
  }
  if (pkg.jobs_failed > 0) {
    diags.push({ text: `${pkg.jobs_failed} fehlgeschlagene Jobs. ${pkg.last_job_error ? `Letzter Fehler: ${pkg.last_job_error.slice(0, 100)}` : ''}`, severity: 'warning' });
  }
  if (pkg.status === 'council_review' && (pkg.build_progress ?? 0) < 50) {
    diags.push({ text: 'Status-Mismatch: Council Review bei nur ' + (pkg.build_progress ?? 0) + '% Fortschritt.', severity: 'warning' });
  }

  return diags;
}

function getHealActions(pkg: AdminPackageSSOT): { key: string; label: string; icon: React.ReactNode; action: string; payload: Record<string, any> }[] {
  const healActions: { key: string; label: string; icon: React.ReactNode; action: string; payload: Record<string, any> }[] = [];

  if (pkg.is_stuck) {
    healActions.push({
      key: 'restart_pipeline',
      label: 'Pipeline neu starten',
      icon: <Play className="h-3 w-3" />,
      action: 'retry_stalled_step',
      payload: { package_id: pkg.package_id, step_key: pkg.current_step || 'generate_learning_content' },
    });
  }

  if (pkg.status === 'blocked') {
    healActions.push({
      key: 'unblock',
      label: 'Entblockieren',
      icon: <Unlock className="h-3 w-3" />,
      action: 'unblock_package',
      payload: { package_id: pkg.package_id, reason: 'Admin-Unblock via Kurse-Seite' },
    });
  }

  if (pkg.status === 'council_review' && (pkg.build_progress ?? 0) < 50) {
    healActions.push({
      key: 'reset_to_building',
      label: 'Zurück auf Building',
      icon: <RotateCcw className="h-3 w-3" />,
      action: 'retry_package_step',
      payload: { package_id: pkg.package_id, step_key: 'generate_learning_content' },
    });
  }

  if (pkg.has_publish_drift && !pkg.integrity_passed) {
    healActions.push({
      key: 'retry_integrity',
      label: 'Integrity neu prüfen',
      icon: <RotateCcw className="h-3 w-3" />,
      action: 'retry_stalled_step',
      payload: { package_id: pkg.package_id, step_key: 'run_integrity_check' },
    });
  }

  if (pkg.has_publish_drift && !pkg.council_approved) {
    healActions.push({
      key: 'retry_council',
      label: 'Council neu starten',
      icon: <RotateCcw className="h-3 w-3" />,
      action: 'retry_stalled_step',
      payload: { package_id: pkg.package_id, step_key: 'quality_council' },
    });
  }

  if (pkg.jobs_failed > 0 && pkg.current_step) {
    healActions.push({
      key: 'retry_current_step',
      label: `Step "${pkg.current_step}" neu starten`,
      icon: <Play className="h-3 w-3" />,
      action: 'retry_package_step',
      payload: { package_id: pkg.package_id, step_key: pkg.current_step },
    });
  }

  if (pkg.status === 'building' || pkg.status === 'processing') {
    healActions.push({
      key: 'cancel_build',
      label: 'Build abbrechen',
      icon: <Trash2 className="h-3 w-3" />,
      action: 'cancel_package_build',
      payload: { package_id: pkg.package_id },
    });
  }

  return healActions;
}

function PackageRow({ pkg, onHeal, healPending }: {
  pkg: AdminPackageSSOT;
  onHeal: (action: string, payload: Record<string, any>) => void;
  healPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const title = pkg.canonical_title || pkg.raw_title || 'Unbenannt';
  const badges = statusBadge(pkg);
  const diags = diagnosePkg(pkg);
  const healActions = getHealActions(pkg);
  const hasIssues = diags.length > 0 || healActions.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <button
          className="min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
          onClick={() => hasIssues && setExpanded(!expanded)}
        >
          <div className="text-sm font-semibold text-foreground truncate">{title}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground font-mono">{pkg.package_id.slice(0, 8)}</span>
            {pkg.priority != null && <span className="text-[10px] text-muted-foreground">P{pkg.priority}</span>}
            {(pkg.build_progress ?? 0) > 0 && <span className="text-[10px] text-muted-foreground">{pkg.build_progress}%</span>}
            {pkg.approved_questions > 0 && <span className="text-[10px] text-muted-foreground">{pkg.approved_questions} Fragen</span>}
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {badges.map((b, i) => (
              <Badge key={i} variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4", b.className)}>
                {b.label}
              </Badge>
            ))}
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {hasIssues && (
            <button onClick={() => setExpanded(!expanded)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
          <Link to={`/admin/studio/${pkg.package_id}`} className="p-1 text-muted-foreground hover:text-primary transition-colors">
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-border pt-2.5">
          {/* Diagnoses */}
          {diags.map((d, i) => (
            <div key={i} className={cn(
              "rounded-lg border p-2 text-xs",
              d.severity === 'error' ? "border-destructive/20 bg-destructive/5" :
              d.severity === 'warning' ? "border-warning/20 bg-warning/5" :
              "border-border bg-muted/30"
            )}>
              <div className="font-semibold flex items-center gap-1 mb-0.5" style={{
                color: d.severity === 'error' ? 'hsl(var(--destructive))' : 'hsl(var(--warning))'
              }}>
                <AlertTriangle className="h-3 w-3" /> Diagnose
              </div>
              <div className="text-foreground">{d.text}</div>
            </div>
          ))}

          {/* Details */}
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="text-muted-foreground">Integrity: {pkg.integrity_passed ? '✅' : '❌'}</span>
            <span className="text-muted-foreground">Council: {pkg.council_approved ? '✅' : '❌'}</span>
            {pkg.current_step && <span className="text-muted-foreground">Step: {pkg.current_step}</span>}
            {pkg.last_error && <span className="text-destructive truncate max-w-[200px]">Fehler: {pkg.last_error.slice(0, 60)}</span>}
          </div>

          {/* Heal Actions */}
          {healActions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {healActions.map(ha => (
                <Button key={ha.key} size="sm" variant="outline" disabled={healPending} className="text-xs h-8"
                  onClick={() => onHeal(ha.action, ha.payload)}>
                  {healPending ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <span className="mr-1.5">{ha.icon}</span>}
                  {ha.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function KursePage() {
  const { data: packages, isLoading, error } = useAdminPackagesSSOT();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { toast } = useToast();
  const qc = useQueryClient();

  const healMutation = useMutation({
    mutationFn: async ({ action, payload }: { action: string; payload: Record<string, any> }) => {
      return runAdminOpsAction(action as any, payload);
    },
    onSuccess: () => {
      toast({ title: 'Heal-Aktion ausgeführt' });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  const filtered = useMemo(() => {
    if (!packages) return [];
    let list = packages;
    if (statusFilter === 'ready_for_approval') {
      list = list.filter(p => p.council_complete && !p.council_approved && p.approved_questions > 0);
    } else if (statusFilter === 'waiting_for_council') {
      list = list.filter(p => p.council_sessions_pending > 0);
    } else if (statusFilter === 'early_pipeline') {
      list = list.filter(p => p.approved_questions === 0 && !p.council_complete && p.status !== 'published');
    } else if (statusFilter === 'stuck') {
      list = list.filter(p => p.is_stuck);
    } else if (statusFilter === 'publish_drift') {
      list = list.filter(p => p.has_publish_drift);
    } else if (statusFilter === 'has_failed_jobs') {
      list = list.filter(p => p.jobs_failed > 0);
    } else if (statusFilter !== 'all') {
      list = list.filter(p => p.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        (p.canonical_title || p.raw_title || '').toLowerCase().includes(q) ||
        p.package_id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [packages, search, statusFilter]);

  const isFallback = packages?.some(p => p._source === 'fallback_course_packages');

  const counts = useMemo(() => {
    if (!packages) return null;
    return {
      stuck: packages.filter(p => p.is_stuck).length,
      blocked: packages.filter(p => p.status === 'blocked').length,
      failed: packages.filter(p => p.jobs_failed > 0).length,
      drift: packages.filter(p => p.has_publish_drift).length,
    };
  }, [packages]);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Fehler: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground">Kurse</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Kanonische Paketliste · SSOT</p>
        </div>
        {isFallback && (
          <Badge variant="outline" className="border-warning/50 text-warning text-[10px] px-1.5 py-0.5">
            Fallback-Modus
          </Badge>
        )}
      </div>

      {/* Issue summary */}
      {counts && (counts.stuck > 0 || counts.blocked > 0 || counts.failed > 0 || counts.drift > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {counts.stuck > 0 && (
            <button onClick={() => setStatusFilter('stuck')} className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-center hover:bg-destructive/10 transition-colors">
              <div className="text-lg font-bold text-destructive">{counts.stuck}</div>
              <div className="text-[10px] text-muted-foreground">Festgefahren</div>
            </button>
          )}
          {counts.blocked > 0 && (
            <button onClick={() => setStatusFilter('blocked')} className="rounded-lg border border-warning/30 bg-warning/5 p-2 text-center hover:bg-warning/10 transition-colors">
              <div className="text-lg font-bold text-warning">{counts.blocked}</div>
              <div className="text-[10px] text-muted-foreground">Blockiert</div>
            </button>
          )}
          {counts.failed > 0 && (
            <button onClick={() => setStatusFilter('has_failed_jobs')} className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-center hover:bg-destructive/10 transition-colors">
              <div className="text-lg font-bold text-destructive">{counts.failed}</div>
              <div className="text-[10px] text-muted-foreground">Failed Jobs</div>
            </button>
          )}
          {counts.drift > 0 && (
            <button onClick={() => setStatusFilter('publish_drift')} className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-center hover:bg-destructive/10 transition-colors">
              <div className="text-lg font-bold text-destructive">{counts.drift}</div>
              <div className="text-[10px] text-muted-foreground">Publish Drift</div>
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suchen nach Name oder ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-10 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
                statusFilter === f.key
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              {f.label}
              {f.key !== 'all' && packages && (
                <span className="ml-1 text-[10px] opacity-60">
                  {f.key === 'stuck' ? packages.filter(p => p.is_stuck).length
                    : f.key === 'publish_drift' ? packages.filter(p => p.has_publish_drift).length
                    : f.key === 'ready_for_approval' ? packages.filter(p => p.council_complete && !p.council_approved && p.approved_questions > 0).length
                    : f.key === 'waiting_for_council' ? packages.filter(p => p.council_sessions_pending > 0).length
                    : f.key === 'early_pipeline' ? packages.filter(p => p.approved_questions === 0 && !p.council_complete && p.status !== 'published').length
                    : packages.filter(p => p.status === f.key).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Keine Pakete gefunden.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(pkg => (
            <PackageRow
              key={pkg.package_id}
              pkg={pkg}
              onHeal={(action, payload) => healMutation.mutate({ action, payload })}
              healPending={healMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
