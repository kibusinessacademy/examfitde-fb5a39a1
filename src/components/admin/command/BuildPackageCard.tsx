import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type BuildPackageCardBadge = {
  label: string;
  tone: 'red' | 'yellow';
};

type BuildPackageCardProps = {
  packageId: string;
  title: string;
  status: string;
  badges?: BuildPackageCardBadge[];
  className?: string;
};

export function BuildPackageCard({
  packageId,
  title,
  status,
  badges = [],
  className,
}: BuildPackageCardProps) {
  const safeTitle = title || 'Unbenannt';

  return (
    <Link
      to={`/admin/studio/${packageId}`}
      aria-label={`${safeTitle} im Studio öffnen`}
      tabIndex={0}
      className={cn(
        'group block rounded-xl border border-border bg-card p-3 transition-all hover:-translate-y-0.5 hover:scale-[1.01] hover:ring-2 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        className,
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{safeTitle}</div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {packageId.slice(0, 8)} · {status}
          </div>
        </div>
        <ArrowRight
          aria-hidden="true"
          className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5"
        />
      </div>

      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {badges.map((badge, index) => (
            <Badge
              key={`${badge.label}-${index}`}
              variant="outline"
              className={cn(
                'h-4 px-1.5 py-0 text-[9px]',
                badge.tone === 'red'
                  ? 'border-destructive/40 bg-destructive/5 text-destructive'
                  : 'border-warning/40 bg-warning/5 text-warning',
              )}
            >
              {badge.label}
            </Badge>
          ))}
        </div>
      )}
    </Link>
  );
}
