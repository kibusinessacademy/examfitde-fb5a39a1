import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Shield, Activity, AlertTriangle, XCircle, Clock, Play, Loader2, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

interface GuardRow {
  package_id: string;
  title: string | null;
  package_status: string;
  guard_state: string | null;
  reason_code: string | null;
  last_validate_at: string | null;
  last_repair_at: string | null;
  delta_approved: number;
  delta_unresolved_flags: number;
  delta_missing_lf_coverage: number;
  validate_attempts_24h: number;
  repair_attempts_24h: number;
  has_active_lease: boolean;
  active_validate_jobs: number;
  active_repair_jobs: number;
  grace_until: string | null;
  consecutive_no_progress: number;
  recommended_action: string;
}

const STATE_CONFIG: Record<string, { label: string; icon: typeof Activity; tone: string; bg: string; border: string }> = {
  healthy: { label: 'Healthy', icon: Activity, tone: 'text-success', bg: 'bg-success/5', border: 'border-success/30' },
  recovering: { label: 'Recovering', icon: Clock, tone: 'text-primary', bg: 'bg-primary/5', border: 'border-primary/30' },
  soft_stalled: { label: 'Soft Stall', icon: AlertTriangle, tone: 'text-warning', bg: 'bg-warning/5', border: 'border-warning/30' },
  hard_stalled: { label: 'Hard Stall', icon: XCircle, tone: 'text-destructive', bg: 'bg-destructive/5', border: 'border-destructive/30' },
};

const ACTION_MAP: Record<string, { action: string; stepKey: string; label: string }> = {
  retry_validate: { action: 'retry_package_step', stepKey: 'validate_exam_pool', label: 'Validate neu starten' },
  repair_exam_pool: { action: 'repair_exam_pool_quality', stepKey: '', label: 'Exam-Pool reparieren' },
  repair_exam_pool_quality: { action: 'repair_exam_pool_quality', stepKey: '', label: 'Exam-Qualität reparieren' },
  escalate: { action: 'retry_package_step', stepKey: 'run_integrity_check', label: 'Integrity prüfen' },
  wait: { action: '', stepKey: '', label: 'Abwarten (Grace-Period)' },
};

function GuardStateRow({ row, onHeal, busy }: { row: GuardRow; onHeal: (packageId: string, action: string, stepKey?: string) => void; busy: boolean }) {
  const state = row.guard_state || 'healthy';
  const cfg = STATE_CONFIG[state] || STATE_CONFIG.healthy;
  const Icon = cfg.icon;
  const title = row.title || row.package_id.slice(0, 8);
  const actionInfo = ACTION_MAP[row.recommended_action];
  const needsAction = state !== 'healthy' && row.recommended_action !== 'none' && row.recommended_action !== 'wait';

  return (
    <div className={cn("rounded-lg border p-3", cfg.border, cfg.bg)}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <Link to={`/admin/studio/${row.package_id}`} className="flex items-center gap-2 min-w-0 flex-1 hover:text-primary transition-colors">
          <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.tone)} />
          <span className="text-sm font-medium text-foreground truncate">{title}</span>
        </Link>
        <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0", cfg.tone)}>
          {cfg.label}
        </Badge>
      </div>

      {row.reason_code && (
        <div className="text-[10px] font-mono text-muted-foreground mb-1.5">{row.reason_code}</div>
      )}

      <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        <div>Validate 24h: <span className="font-medium text-foreground">{row.validate_attempts_24h}</span></div>
        <div>Repair 24h: <span className="font-medium text-foreground">{row.repair_attempts_24h}</span></div>
        <div>No-Progress: <span className="font-medium text-foreground">{row.consecutive_no_progress}</span></div>
        <div>Δ Approved: <span className={cn("font-medium", row.delta_approved > 0 ? 'text-success' : row.delta_approved < 0 ? 'text-destructive' : 'text-foreground')}>{row.delta_approved > 0 ? '+' : ''}{row.delta_approved}</span></div>
        <div>Δ Flags: <span className={cn("font-medium", row.delta_unresolved_flags < 0 ? 'text-success' : row.delta_unresolved_flags > 0 ? 'text-destructive' : 'text-foreground')}>{row.delta_unresolved_flags > 0 ? '+' : ''}{row.delta_unresolved_flags}</span></div>
        <div>Δ LF: <span className={cn("font-medium", row.delta_missing_lf_coverage < 0 ? 'text-success' : row.delta_missing_lf_coverage > 0 ? 'text-destructive' : 'text-foreground')}>{row.delta_missing_lf_coverage > 0 ? '+' : ''}{row.delta_missing_lf_coverage}</span></div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2">
        {row.active_validate_jobs > 0 && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">Validate aktiv</Badge>}
        {row.active_repair_jobs > 0 && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">Repair aktiv</Badge>}
        {row.has_active_lease && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">Lease</Badge>}
        {row.grace_until && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">Grace bis {new Date(row.grace_until).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</Badge>}
      </div>

      {/* Heal action */}
      {needsAction && actionInfo && actionInfo.action && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <Button
            size="sm" variant="outline"
            className="h-6 text-[10px] px-2 gap-1"
            disabled={busy || row.active_validate_jobs > 0 || row.active_repair_jobs > 0}
            onClick={() => {
              if (actionInfo.stepKey) {
                onHeal(row.package_id, actionInfo.action, actionInfo.stepKey);
              } else {
                onHeal(row.package_id, actionInfo.action);
              }
            }}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
            {actionInfo.label}
          </Button>
        </div>
      )}
      {row.recommended_action === 'wait' && (
        <div className="mt-2 text-[10px] text-muted-foreground italic">
          → Abwarten empfohlen (Grace-Period aktiv)
        </div>
      )}
    </div>
  );
}

export default function ValidateGuardDiagnosticsCard() {
  const qc = useQueryClient();
  const { data: rows, isLoading } = useQuery({
    queryKey: ['validate-guard-diagnostics'],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .from('ops_validate_exam_pool_progress')
        .select('*')
        .limit(20);
      if (error) return [] as GuardRow[];
      return (data ?? []) as GuardRow[];
    },
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const healMutation = useMutation({
    mutationFn: async ({ packageId, action, stepKey }: { packageId: string; action: string; stepKey?: string }) => {
      if (action === 'retry_package_step') {
        return runAdminOpsAction('retry_package_step', { package_id: packageId, step_key: stepKey || 'validate_exam_pool' });
      }
      return runAdminOpsAction(action as any, { package_id: packageId });
    },
    onSuccess: () => {
      toast.success('Reparatur gestartet');
      qc.invalidateQueries({ queryKey: ['validate-guard-diagnostics'] });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) => toast.error(`Fehler: ${err.message}`),
  });

  if (isLoading || !rows || rows.length === 0) return null;

  const nonHealthy = rows.filter(r => r.guard_state && r.guard_state !== 'healthy');
  const showAll = nonHealthy.length === 0;
  const displayRows = showAll ? rows.slice(0, 5) : nonHealthy;

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
        <Shield className="h-4 w-4 text-muted-foreground" />
        Validate Guard Diagnostik
        {nonHealthy.length > 0 && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-warning/50 text-warning">
            {nonHealthy.length} auffällig
          </Badge>
        )}
      </h2>
      <div className="grid gap-2">
        {displayRows.map(row => (
          <GuardStateRow
            key={row.package_id}
            row={row}
            onHeal={(packageId, action, stepKey) => healMutation.mutate({ packageId, action, stepKey })}
            busy={healMutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}
