import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Shield, Activity, AlertTriangle, XCircle, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';

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

function GuardStateRow({ row }: { row: GuardRow }) {
  const state = row.guard_state || 'healthy';
  const cfg = STATE_CONFIG[state] || STATE_CONFIG.healthy;
  const Icon = cfg.icon;
  const title = row.title || row.package_id.slice(0, 8);

  return (
    <Link
      to={`/admin/studio/${row.package_id}`}
      className={cn("block rounded-lg border p-3 hover:bg-muted/50 transition-colors", cfg.border, cfg.bg)}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.tone)} />
          <span className="text-sm font-medium text-foreground truncate">{title}</span>
        </div>
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
        {row.recommended_action !== 'none' && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-primary/40 text-primary">
            → {row.recommended_action}
          </Badge>
        )}
      </div>
    </Link>
  );
}

export default function ValidateGuardDiagnosticsCard() {
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
          <GuardStateRow key={row.package_id} row={row} />
        ))}
      </div>
    </div>
  );
}
