import { AlertTriangle, CheckCircle2, Loader2, Lock, RefreshCw, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import type { OralStartability } from '@/hooks/useOralStartability';

interface OralStartabilityCardProps {
  startability: OralStartability & { isLoading: boolean };
  /** Last server error code/message captured from a failed start attempt. */
  lastError?: { code?: string; message?: string; requestId?: string } | null;
  curriculumId?: string | null;
  curriculumTitle?: string;
  onRetry?: () => void;
}

/**
 * Diagnose-Karte für den Oral-Exam-Start.
 * Macht sichtbar, warum (oder warum nicht) gestartet werden kann —
 * nicht als Toast, sondern als ruhige, persistente UI.
 */
export function OralStartabilityCard({
  startability,
  lastError,
  curriculumId,
  curriculumTitle,
  onRetry,
}: OralStartabilityCardProps) {
  const { status, blueprintCount, isLoading } = startability;

  if (status === 'no_curriculum') return null;

  if (lastError) {
    return (
      <ErrorBlock
        title="Prüfung konnte nicht gestartet werden"
        body={lastError.message || 'Unbekannter Fehler.'}
        code={lastError.code}
        requestId={lastError.requestId}
        onRetry={onRetry}
        curriculumId={curriculumId}
      />
    );
  }

  if (isLoading || status === 'checking') {
    return (
      <Block tone="muted" icon={<Loader2 className="h-4 w-4 animate-spin" />} title="Verfügbarkeit wird geprüft …">
        Wir prüfen Login, Berechtigung und freigegebene Prüfungsfragen.
      </Block>
    );
  }

  if (status === 'error') {
    return (
      <Block tone="warn" icon={<AlertTriangle className="h-4 w-4" />} title="Verfügbarkeit konnte nicht geprüft werden">
        Bitte später erneut versuchen.
      </Block>
    );
  }

  if (status === 'no_blueprints') {
    return (
      <Block tone="warn" icon={<AlertTriangle className="h-4 w-4" />} title="Mündliche Prüfung noch nicht verfügbar">
        <p>
          Für {curriculumTitle ? <strong>{curriculumTitle}</strong> : 'diesen Beruf'} sind noch keine
          freigegebenen Prüfungsblueprints hinterlegt. Wir arbeiten daran.
        </p>
        <div className="mt-2 flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/berufe">Anderen Beruf wählen</Link>
          </Button>
        </div>
      </Block>
    );
  }

  if (status === 'login_required') {
    return (
      <Block tone="info" icon={<Lock className="h-4 w-4" />} title="Login erforderlich">
        <p>Bitte melde dich an, um die mündliche Prüfung zu starten.</p>
        <div className="mt-2 flex gap-2">
          <Button asChild size="sm">
            <Link to="/auth">Anmelden</Link>
          </Button>
        </div>
      </Block>
    );
  }

  if (status === 'not_entitled') {
    return (
      <Block tone="info" icon={<ShoppingBag className="h-4 w-4" />} title="Paket erforderlich">
        <p>
          Der Oral-Exam-Trainer ist Teil eines kostenpflichtigen Kurspakets. Sobald du den Kurs für{' '}
          {curriculumTitle ? <strong>{curriculumTitle}</strong> : 'diesen Beruf'} erworben hast,
          kannst du die mündliche Prüfung beliebig oft simulieren.
        </p>
        <div className="mt-2 flex gap-2">
          <Button asChild size="sm">
            <Link to={curriculumId ? `/berufe?curriculum=${curriculumId}` : '/berufe'}>
              Paket ansehen
            </Link>
          </Button>
        </div>
      </Block>
    );
  }

  // ready
  return (
    <Block tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} title="Prüfung verfügbar">
      {blueprintCount} freigegebene Prüfungsfragen für diesen Beruf bereit.
    </Block>
  );
}

function Block({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'ok' | 'info' | 'warn' | 'muted';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const toneCls = {
    ok: 'border-emerald-300 bg-emerald-50/60 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800',
    info: 'border-sky-300 bg-sky-50/60 text-sky-900 dark:bg-sky-950/30 dark:text-sky-200 dark:border-sky-800',
    warn: 'border-amber-300 bg-amber-50/60 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800',
    muted: 'border-border bg-muted/40 text-muted-foreground',
  }[tone];
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-sm ${toneCls}`}
      role="status"
      data-testid="oral-startability-card"
    >
      <div className="flex items-center gap-2 font-medium">
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-1 text-xs leading-relaxed">{children}</div>
    </div>
  );
}

function ErrorBlock({
  title,
  body,
  code,
  requestId,
  onRetry,
  curriculumId,
}: {
  title: string;
  body: string;
  code?: string;
  requestId?: string;
  onRetry?: () => void;
  curriculumId?: string | null;
}) {
  const showBuyCta = code === 'NOT_ENTITLED';
  const showBlueprintCta = code === 'NO_ORAL_BLUEPRINTS';
  const showRetry = !showBuyCta && !showBlueprintCta;
  return (
    <div
      className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm text-destructive"
      role="alert"
      data-testid="oral-start-error-card"
      data-error-code={code ?? 'UNKNOWN'}
    >
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" />
        <span>{title}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed">{body}</p>
      {(code || requestId) && (
        <p className="mt-1 text-[10px] opacity-70 font-mono">
          {code ? `Code: ${code}` : null}
          {code && requestId ? ' · ' : null}
          {requestId ? `req: ${requestId}` : null}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {showRetry && onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Erneut versuchen
          </Button>
        )}
        {showBuyCta && (
          <Button size="sm" asChild>
            <Link to={curriculumId ? `/berufe?curriculum=${curriculumId}` : '/berufe'}>
              <ShoppingBag className="h-3.5 w-3.5 mr-1.5" /> Paket ansehen
            </Link>
          </Button>
        )}
        {showBlueprintCta && (
          <Button size="sm" variant="outline" asChild>
            <Link to="/berufe">Anderen Beruf wählen</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
