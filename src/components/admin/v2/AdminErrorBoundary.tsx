import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AdminErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
}

interface AdminErrorBoundaryState {
  hasError: boolean;
  message: string | null;
}

export default class AdminErrorBoundary extends Component<AdminErrorBoundaryProps, AdminErrorBoundaryState> {
  state: AdminErrorBoundaryState = {
    hasError: false,
    message: null,
  };

  static getDerivedStateFromError(error: Error): AdminErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Unbekannter Fehler im Adminbereich.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[admin-v2] route crash', error, errorInfo);
  }

  componentDidUpdate(prevProps: AdminErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: null });
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
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
                Die aktuelle Admin-Ansicht ist abgestürzt. Die Navigation bleibt benutzbar — wechsle in eine stabile Ansicht oder lade den Bereich neu.
              </p>
            </div>

            {this.state.message ? (
              <div className="rounded-xl border border-destructive/20 bg-background/60 p-3 text-xs font-mono text-destructive break-words">
                {this.state.message}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href="/admin/command">Zur Leitstelle</a>
              </Button>
              <Button asChild variant="outline">
                <a href="/admin/studio">Zu den Kursen</a>
              </Button>
              <Button asChild variant="outline">
                <a href="/admin/queue">Zur Queue</a>
              </Button>
              <Button onClick={this.handleReload}>
                <RefreshCcw className="mr-2 h-4 w-4" /> Neu laden
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
