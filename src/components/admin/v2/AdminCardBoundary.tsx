/**
 * AdminCardBoundary
 * ─────────────────
 * Error-Boundary für einzelne Admin-Karten/Sektionen. Verhindert dass ein
 * Render-Fehler in einer einzelnen Karte das ganze Cockpit zerschießt.
 *
 * Verwendung:
 *   <AdminCardBoundary label="RealtimePulse">
 *     <RealtimePulse />
 *   </AdminCardBoundary>
 */
import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  label?: string;
  /** Optional fallback render — überschreibt Default */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class AdminCardBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Lightweight log — Sentry/etc. fängt globale Errors woanders
    if (typeof console !== "undefined") {
      console.error(`[AdminCardBoundary:${this.props.label ?? "card"}]`, error);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <Card className="p-3 border-destructive/30 bg-destructive/5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">
                {this.props.label ?? "Karte"} konnte nicht geladen werden
              </div>
              <div className="text-xs text-muted-foreground truncate" title={this.state.error.message}>
                {this.state.error.message}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={this.reset} className="h-7 text-xs">
              Erneut versuchen
            </Button>
          </div>
        </Card>
      );
    }
    return this.props.children;
  }
}
