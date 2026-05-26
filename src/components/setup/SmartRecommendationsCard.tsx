import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, AlertTriangle, Sparkles, RefreshCw } from "lucide-react";
import { useSetupRecommendations } from "@/hooks/useSetupRecommendations";
import { severityClass, categoryLabel, type Recommendation } from "@/lib/setup/recommendations";

interface Props {
  orgId: string | null;
  limit?: number;
}

function RecRow({ r }: { r: Recommendation }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-base p-4 hover:border-border-strong transition-colors">
      <div className="flex items-start gap-3">
        <Badge className={severityClass(r.severity)} variant="outline">
          {r.severity === "critical" ? "P0" : r.severity === "warning" ? "P1" : "P2"}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-muted uppercase tracking-wide">{categoryLabel(r.category)}</span>
            {r.auto_fix_available && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Sparkles className="h-3 w-3" /> Auto-Fix verfügbar
              </Badge>
            )}
          </div>
          <h4 className="font-medium text-text-primary mt-1">{r.title}</h4>
          <p className="text-sm text-text-secondary mt-1">{r.description}</p>
          {r.recommended_action && (
            <p className="text-sm text-text-primary mt-2">
              <span className="font-medium">Empfohlen: </span>{r.recommended_action}
            </p>
          )}
          <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
            <span>Impact {r.impact_score}</span>
            <span>·</span>
            <span>Effort {r.effort_score}</span>
            <span>·</span>
            <span>Quelle: {r.evidence.source}{r.evidence.count != null ? ` (${r.evidence.count})` : ""}</span>
          </div>
        </div>
        {r.deep_link && (
          <Button asChild size="sm" variant="outline">
            <Link to={r.deep_link}>
              Öffnen <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export function SmartRecommendationsCard({ orgId, limit = 10 }: Props) {
  const { data, isLoading, refetch, isFetching } = useSetupRecommendations(orgId);
  const recs = data?.recommendations ?? [];
  const shown = recs.slice(0, limit);
  const criticalCount = recs.filter((r) => r.severity === "critical").length;

  return (
    <Card className="shadow-elev-1">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-status-info-text" />
            Smart Setup Recommendations
          </CardTitle>
          <p className="text-sm text-text-secondary mt-1">
            Deterministische Empfehlungen aus echten SSOT-Signalen — keine Halluzinationen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <Badge className="bg-status-error-bg-subtle text-status-error-text border-status-error-border gap-1" variant="outline">
              <AlertTriangle className="h-3 w-3" /> {criticalCount} kritisch
            </Badge>
          )}
          <Button size="icon" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : shown.length === 0 ? (
          <div className="rounded-lg border border-status-success-border bg-status-success-bg-subtle p-4 text-status-success-text text-sm">
            Alle erkannten Aktivierungs-, Curriculum- und Governance-Pfade sind ok. Keine offenen Empfehlungen.
          </div>
        ) : (
          shown.map((r) => <RecRow key={r.id} r={r} />)
        )}
        {recs.length > limit && (
          <p className="text-xs text-text-muted text-center">
            + {recs.length - limit} weitere Empfehlungen
          </p>
        )}
      </CardContent>
    </Card>
  );
}
