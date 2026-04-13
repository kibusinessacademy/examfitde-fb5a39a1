import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

/**
 * Global Error Boundary — catches React render errors, chunk load failures,
 * and other unrecoverable runtime exceptions.
 * Reports errors to admin_notifications via edge function.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, isChunkError: false };

  static getDerivedStateFromError(error: Error): State {
    const isChunkError =
      /loading chunk/i.test(error.message) ||
      /dynamically imported module/i.test(error.message) ||
      /failed to fetch/i.test(error.message) ||
      /load failed/i.test(error.message);

    return { hasError: true, error, isChunkError };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.reportError(error);
  }

  private reportError(error: Error) {
    const isChunkError =
      /loading chunk|dynamically imported module|failed to fetch|load failed/i.test(error.message);

    try {
      supabase.functions.invoke('report-frontend-error', {
        body: {
          message: error.message,
          stack: error.stack ?? null,
          url: window.location.href,
          pathname: window.location.pathname,
          isChunkError,
          buildVersion: import.meta.env.VITE_APP_VERSION ?? null,
          timestamp: new Date().toISOString(),
        },
      }).catch(() => { /* silent */ });
    } catch {
      // never throw from error boundary
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null, isChunkError: false });
  };

  handleHome = () => {
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    const { isChunkError, error } = this.state;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-display font-semibold text-foreground">
              {isChunkError ? 'Update verfügbar' : 'Etwas ist schiefgelaufen'}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isChunkError
                ? 'Eine neue Version ist verfügbar. Bitte lade die Seite neu, um fortzufahren.'
                : 'Ein unerwarteter Fehler ist aufgetreten. Du kannst es erneut versuchen oder zur Startseite zurückkehren.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {isChunkError ? (
              <Button onClick={this.handleReload} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Seite neu laden
              </Button>
            ) : (
              <>
                <Button onClick={this.handleRetry} variant="default" className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Erneut versuchen
                </Button>
                <Button onClick={this.handleHome} variant="outline" className="gap-2">
                  <Home className="h-4 w-4" />
                  Zur Startseite
                </Button>
              </>
            )}
          </div>

          {import.meta.env.DEV && error && (
            <details className="mt-6 text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Technische Details
              </summary>
              <pre className="mt-2 p-3 bg-muted rounded-lg text-xs text-muted-foreground overflow-auto max-h-40 whitespace-pre-wrap break-words">
                {error.message}
                {'\n\n'}
                {error.stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
