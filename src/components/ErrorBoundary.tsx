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
  errorId: string | null;
}

/**
 * Extracts likely resource identifiers (course/package/lesson UUIDs) from the
 * current route so error reports can be triaged without manual repro.
 */
function extractRouteContext(pathname: string): {
  routePattern: string;
  courseId: string | null;
  packageId: string | null;
  lessonId: string | null;
  resourceSlug: string | null;
} {
  const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const segs = pathname.split('/').filter(Boolean);
  let courseId: string | null = null;
  let packageId: string | null = null;
  let lessonId: string | null = null;
  let resourceSlug: string | null = null;

  for (let i = 0; i < segs.length; i++) {
    const cur = segs[i];
    const next = segs[i + 1];
    if (!next) continue;
    const isUuid = UUID_RX.test(next);
    if (cur === 'course' || cur === 'kurs') {
      if (isUuid) courseId = next;
      else resourceSlug = next;
    } else if (cur === 'paket' || cur === 'package') {
      if (isUuid) packageId = next;
      else resourceSlug = next;
    } else if (cur === 'lesson' || cur === 'lektion') {
      if (isUuid) lessonId = next;
    }
  }

  // Build a route pattern by replacing UUIDs/numbers with placeholders
  const routePattern = '/' + segs
    .map((s) => (UUID_RX.test(s) ? ':uuid' : /^\d+$/.test(s) ? ':num' : s))
    .join('/');

  return { routePattern, courseId, packageId, lessonId, resourceSlug };
}

/**
 * Global Error Boundary — catches React render errors, chunk load failures,
 * and other unrecoverable runtime exceptions.
 * Reports errors to admin_notifications via edge function with structured
 * route/resource context (route pattern, course/package/lesson IDs, stack,
 * component stack, error id) for fast triage.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, isChunkError: false, errorId: null };

  static getDerivedStateFromError(error: Error): State {
    const isChunkError =
      /loading chunk/i.test(error.message) ||
      /dynamically imported module/i.test(error.message) ||
      /failed to fetch/i.test(error.message) ||
      /load failed/i.test(error.message);

    return {
      hasError: true,
      error,
      isChunkError,
      errorId: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const ctx = extractRouteContext(window.location.pathname);
    // Structured local log so devs can grep in DevTools / session replay.
    console.error('[ErrorBoundary]', {
      errorId: this.state.errorId,
      message: error.message,
      route: window.location.pathname,
      routePattern: ctx.routePattern,
      courseId: ctx.courseId,
      packageId: ctx.packageId,
      lessonId: ctx.lessonId,
      resourceSlug: ctx.resourceSlug,
      stack: error.stack,
      componentStack: info.componentStack,
    });
    this.reportError(error, info);
  }

  private reportError(error: Error, info?: ErrorInfo) {
    const isChunkError =
      /loading chunk|dynamically imported module|failed to fetch|load failed/i.test(error.message);
    const ctx = extractRouteContext(window.location.pathname);

    try {
      supabase.functions.invoke('report-frontend-error', {
        body: {
          errorId: this.state.errorId,
          message: error.message,
          name: error.name,
          stack: error.stack ?? null,
          componentStack: info?.componentStack ?? null,
          url: window.location.href,
          pathname: window.location.pathname,
          routePattern: ctx.routePattern,
          courseId: ctx.courseId,
          packageId: ctx.packageId,
          lessonId: ctx.lessonId,
          resourceSlug: ctx.resourceSlug,
          referrer: document.referrer || null,
          userAgent: navigator.userAgent,
          viewport: { w: window.innerWidth, h: window.innerHeight },
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
    this.setState({ hasError: false, error: null, isChunkError: false, errorId: null });
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

    const { isChunkError, error, errorId } = this.state;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-destructive-bg-subtle flex items-center justify-center">
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
