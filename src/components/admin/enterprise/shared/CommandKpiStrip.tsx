import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: number | string;
  icon: ReactNode;
  tone?: 'green' | 'yellow' | 'red' | 'neutral';
  onClick?: () => void;
}

export function KpiCard({ label, value, icon, tone = 'neutral', onClick }: KpiCardProps) {
  const toneClasses = {
    green: 'border-success/30 bg-success/5',
    yellow: 'border-warning/30 bg-warning/5',
    red: 'border-destructive/30 bg-destructive/5',
    neutral: 'border-border bg-card',
  };
  return (
    <div
      className={cn(
        'rounded-xl border p-3 flex items-start gap-3',
        toneClasses[tone],
        onClick && 'cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all active:scale-[0.98]'
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <div className="text-lg font-bold text-foreground leading-tight">{value}</div>
        <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{label}</div>
      </div>
    </div>
  );
}

export function CommandKpiStrip({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {children}
    </div>
  );
}
