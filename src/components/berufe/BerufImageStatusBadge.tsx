import { Loader2, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BerufImageStatus = 'ready' | 'generating' | 'queued' | 'failed';

const COPY: Record<BerufImageStatus, { label: string; tone: string; Icon: typeof Loader2 }> = {
  ready: {
    label: 'Bild bereit',
    tone: 'bg-emerald-500/90 text-white border-emerald-400/40',
    Icon: CheckCircle2,
  },
  generating: {
    label: 'Bild wird erzeugt',
    tone: 'bg-primary/90 text-primary-foreground border-primary/30',
    Icon: Loader2,
  },
  queued: {
    label: 'In der Warteschlange',
    tone: 'bg-amber-500/90 text-white border-amber-400/40',
    Icon: Clock,
  },
  failed: {
    label: 'Erneuter Versuch',
    tone: 'bg-destructive/90 text-destructive-foreground border-destructive/40',
    Icon: AlertTriangle,
  },
};

interface Props {
  status?: BerufImageStatus;
  /** `ready` wird per default nicht gerendert (kein Hinweis nötig). */
  showWhenReady?: boolean;
  className?: string;
}

/**
 * Kleines Status-Badge, das überlagernd auf Berufsbild-Visuals platziert wird,
 * solange die HeyGen-Generierung läuft oder fehlschlug. Lässt den Nutzer wissen,
 * dass das angezeigte Bild ein Fallback ist und ein echtes Foto bald folgt.
 */
export function BerufImageStatusBadge({ status, showWhenReady = false, className }: Props) {
  if (!status) return null;
  if (status === 'ready' && !showWhenReady) return null;
  const { label, tone, Icon } = COPY[status];
  const spinning = status === 'generating';
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none absolute z-10 inline-flex items-center gap-1.5 rounded-full',
        'border px-2.5 py-1 text-[11px] font-medium shadow-md backdrop-blur-sm',
        tone,
        className,
      )}
      data-testid="beruf-image-status-badge"
      data-status={status}
    >
      <Icon className={cn('h-3.5 w-3.5', spinning && 'animate-spin')} aria-hidden="true" />
      <span className="whitespace-nowrap">{label}</span>
    </div>
  );
}

export default BerufImageStatusBadge;
