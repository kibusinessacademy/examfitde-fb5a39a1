import { Loader2, Clock, AlertTriangle, CheckCircle2, RotateCw } from 'lucide-react';
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
    label: 'Bild fehlgeschlagen',
    tone: 'bg-destructive/90 text-destructive-foreground border-destructive/40',
    Icon: AlertTriangle,
  },
};

interface Props {
  status?: BerufImageStatus;
  /** `ready` wird per default nicht gerendert (kein Hinweis nötig). */
  showWhenReady?: boolean;
  className?: string;
  /**
   * Bei `status === 'failed'` zeigen wir die Edge-Function-Fehlermeldung
   * gekürzt im `title`-Tooltip an, damit der Nutzer eine kurze Ursache
   * (z. B. "gateway 429: rate-limited") sieht.
   */
  errorReason?: string | null;
  /**
   * Wenn gesetzt, rendert das Badge zusätzlich einen Retry-Button. Der
   * Consumer soll hier den `retry(slug)`-Aufruf aus `useBerufImages` binden,
   * der die Edge Function mit `force: true` neu anstößt.
   */
  onRetry?: () => void;
}

/**
 * Kleines Status-Badge, das überlagernd auf Berufsbild-Visuals platziert wird,
 * solange die HeyGen-Generierung läuft oder fehlschlug. Im Fehlerfall blendet
 * es eine klare Ursache + Retry-Action ein.
 */
export function BerufImageStatusBadge({
  status,
  showWhenReady = false,
  className,
  errorReason,
  onRetry,
}: Props) {
  if (!status) return null;
  if (status === 'ready' && !showWhenReady) return null;
  const { label, tone, Icon } = COPY[status];
  const spinning = status === 'generating';
  const isFailed = status === 'failed';
  const shortReason = isFailed && errorReason
    ? errorReason.replace(/\s+/g, ' ').slice(0, 80)
    : null;
  return (
    <div
      role="status"
      aria-live="polite"
      title={shortReason ?? undefined}
      className={cn(
        'absolute z-10 inline-flex items-center gap-1.5 rounded-full',
        'border px-2.5 py-1 text-[11px] font-medium shadow-md backdrop-blur-sm',
        isFailed ? 'pointer-events-auto' : 'pointer-events-none',
        tone,
        className,
      )}
      data-testid="beruf-image-status-badge"
      data-status={status}
    >
      <Icon className={cn('h-3.5 w-3.5', spinning && 'animate-spin')} aria-hidden="true" />
      <span className="whitespace-nowrap">{label}</span>
      {isFailed && shortReason && (
        <span className="hidden sm:inline opacity-90 max-w-[160px] truncate">
          · {shortReason}
        </span>
      )}
      {isFailed && onRetry && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRetry();
          }}
          aria-label="Berufsbild neu generieren"
          className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 px-1.5 py-0.5 text-[10px] font-semibold transition"
          data-testid="beruf-image-retry"
        >
          <RotateCw className="h-3 w-3" /> Erneut
        </button>
      )}
    </div>
  );
}

export default BerufImageStatusBadge;
