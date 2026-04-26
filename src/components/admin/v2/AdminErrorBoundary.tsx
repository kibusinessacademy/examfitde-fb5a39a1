import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AdminErrorBoundaryProps {
  children: ReactNode;
  /** Wenn sich der resetKey ändert (z.B. pathname), wird der Fehlerzustand zurückgesetzt. */
  resetKey?: string;
  /** Wohin Auto-Recovery navigiert (Default: /admin/queue?tab=live). */
  safeRoute?: string;
  /** Auto-Recovery aktivieren (Default: true). */
  autoRecover?: boolean;
}

interface AdminErrorBoundaryState {
  hasError: boolean;
  message: string | null;
  recoveryAttempted: boolean;
}

const SAFE_ROUTE_DEFAULT = '/admin/queue?tab=live';
const RECOVERY_GUARD_KEY = 'admin-v2-recovery-attempt';
const RECOVERY_GUARD_TTL_MS = 30_000; // verhindert Recovery-Schleifen

export default class AdminErrorBoundary extends Component<AdminErrorBoundaryProps, AdminErrorBoundaryState> {
  state: AdminErrorBoundaryState = {
    hasError: false,
    message: null,
    recoveryAttempted: false,
  };

  static getDerivedStateFromError(error: Error): AdminErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Unbekannter Fehler im Adminbereich.',
      recoveryAttempted: false,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[admin-v2] route crash', error, errorInfo);

    const safeRoute = this.props.safeRoute ?? SAFE_ROUTE_DEFAULT;
    const autoRecover = this.props.autoRecover !== false;

    if (!autoRecover || typeof window === 'undefined') return;

    // Bereits auf safe-Route? Dann zeigen wir den manuellen Fallback.
    const here = `${window.location.pathname}${window.location.search}`;
    if (here === safeRoute) return;

    // Loop-Schutz: max. 1 automatischer Recovery-Versuch pro 30s
    try {
      const last = Number(sessionStorage.getItem(RECOVERY_GUARD_KEY) ?? '0');
      if (Date.now() - last < RECOVERY_GUARD_TTL_MS) {
        return; // schon kürzlich versucht → manuelle UI zeigen
      }
      sessionStorage.setItem(RECOVERY_GUARD_KEY, String(Date.now()));
    } catch {
      // sessionStorage nicht verfügbar → kein Auto-Recover
      return;
    }

    this.setState({ recoveryAttempted: true });
    // Defer in Microtask damit React Render-Cycle abschließt
    queueMicrotask(() => {
      window.location.replace(safeRoute);
    });
  }

  componentDidUpdate(prevProps: AdminErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: null, recoveryAttempted: false });
      try { sessionStorage.removeItem(RECOVERY_GUARD_KEY); } catch { /* noop */ }
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: null, recoveryAttempted: false });
    try { sessionStorage.removeItem(RECOVERY_GUARD_KEY); } catch { /* noop */ }
  };

  private handleReload = () => {
    try { sessionStorage.removeItem(RECOVERY_GUARD_KEY); } catch { /* noop */ }
    window.location.reload();
  };

  private handleGoSafe = () => {
    try { sessionStorage.removeItem(RECOVERY_GUARD_KEY); } catch { /* noop */ }
    window.location.assign(this.props.safeRoute ?? SAFE_ROUTE_DEFAULT);
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Auto-Recovery läuft → schlanker Übergangs-Hinweis
    if (this.state.recoveryAttempted) {
      return (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <RefreshCcw className="h-4 w-4 animate-spin text-warning" />
            <div className="text-sm text-foreground">
              Ansicht abgestürzt — schalte automatisch auf Queue (Live) zurück…
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-destructive/10 p-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Admin-Bereich temporär gestört</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Die aktuelle Admin-Ansicht ist abgestürzt. Auto-Recovery wurde bereits versucht — wechsle in eine stabile Ansicht oder lade neu.
              </p>
            </div>

            {this.state.message ? (
              <div className="rounded-xl border border-destructive/20 bg-background/60 p-3 text-xs font-mono text-destructive break-words">
                {this.state.message}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button onClick={this.handleGoSafe}>
                <Home className="mr-2 h-4 w-4" /> Stabile Queue-Ansicht
              </Button>
              <Button variant="outline" onClick={this.handleRetry}>
                Erneut versuchen
              </Button>
              <Button variant="outline" onClick={this.handleReload}>
                <RefreshCcw className="mr-2 h-4 w-4" /> Neu laden
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
