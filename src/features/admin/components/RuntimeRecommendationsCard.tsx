import { useQuery } from "@tanstack/react-query";
import { Lightbulb, Workflow, AlertTriangle, Info, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface Recommendation {
  kind: "high_failure_rate" | "cascade_pattern" | "cooldown_pressure" | "heal_pattern_link";
  severity: "info" | "warning" | "critical";
  action_key: string | null;
  message: string;
  suggestion: string;
  evidence: Record<string, unknown>;
}

const kindIcon = {
  high_failure_rate: AlertTriangle,
  cascade_pattern: Workflow,
  cooldown_pressure: Shield,
  heal_pattern_link: Info,
} as const;

const sevTone: Record<string, string> = {
  info: "bg-info-bg-subtle text-info",
  warning: "bg-warning-bg-subtle text-warning",
  critical: "bg-destructive text-destructive-foreground",
};

/**
 * Runtime Recommendations Card v1.3
 * Read-only advisory feed. Bridges:
 *  - Hohe Fehlerquoten (Intelligence-View)
 *  - Cascade-Pattern (A→B Sequenzen)
 *  - Cooldown-Druck (haeufige Blocks)
 *  - Heal-Pattern-Recommendations (bestehende AI-Empfehlungen)
 * Niemals autonom — Operator entscheidet.
 */
export default function RuntimeRecommendationsCard() {
  const q = useQuery({
    queryKey: ["runtime-recommendations"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_runtime_recommendations");
      if (error) throw error;
      return (data ?? []) as unknown as Recommendation[];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4" /> Runtime Recommendations
          <Badge variant="outline" className="text-[10px]">advisory · read-only</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {q.isLoading && <Skeleton className="h-24 w-full" />}
        {q.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive-bg-subtle p-3 text-sm text-destructive">
            Fehler: {(q.error as Error).message}
          </div>
        )}
        {q.data && q.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Keine offenen Empfehlungen. Runtime stabil.
          </p>
        )}
        {q.data?.map((r, i) => {
          const Icon = kindIcon[r.kind] ?? Info;
          return (
            <div key={i} className="rounded-md border border-border bg-surface-1 p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge className={sevTone[r.severity] ?? sevTone.info}>
                  <Icon className="mr-1 h-3 w-3" /> {r.kind.replace(/_/g, " ")}
                </Badge>
                {r.action_key && (
                  <span className="font-mono text-xs text-muted-foreground">{r.action_key}</span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground">{r.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Vorschlag: </span>
                {r.suggestion}
              </p>
              {r.evidence && Object.keys(r.evidence).length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-muted-foreground">
                    Evidence
                  </summary>
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-background p-2 text-[11px]">
                    {JSON.stringify(r.evidence, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
