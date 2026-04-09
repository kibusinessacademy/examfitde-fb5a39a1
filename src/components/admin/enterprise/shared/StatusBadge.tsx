import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  active: 'border-success/30 bg-success/10 text-success',
  suspended: 'border-warning/30 bg-warning/10 text-warning',
  deactivated: 'border-destructive/30 bg-destructive/10 text-destructive',
  expired: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  cancelled: 'border-destructive/30 bg-destructive/10 text-destructive',
  trial: 'border-primary/30 bg-primary/10 text-primary',
  pilot: 'border-primary/30 bg-primary/10 text-primary',
  revoked: 'border-destructive/30 bg-destructive/10 text-destructive',
};

const ROLE_STYLES: Record<string, string> = {
  owner: 'border-primary/30 bg-primary/10 text-primary',
  admin: 'border-warning/30 bg-warning/10 text-warning',
  manager: 'border-success/30 bg-success/10 text-success',
  trainer: 'border-success/30 bg-success/10 text-success',
  learner: 'border-border bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] h-5 px-1.5 capitalize', STATUS_STYLES[status] || '')}>
      {status}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] h-5 px-1.5 capitalize', ROLE_STYLES[role] || '')}>
      {role}
    </Badge>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const sourceLabels: Record<string, string> = {
    manual: 'Manuell', scim: 'SCIM', bulk: 'Bulk', lti: 'LTI', stripe: 'Stripe',
  };
  return (
    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
      {sourceLabels[source] || source}
    </Badge>
  );
}

export function SeatUsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const tone = pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-warning' : 'bg-success';
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0">{used}/{total}</span>
    </div>
  );
}
