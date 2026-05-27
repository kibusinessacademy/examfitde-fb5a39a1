import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getBundleDecisionHistory } from "@/lib/berufs-ki/outcome";

const DECISION_TONE: Record<string, string> = {
  created: "bg-muted text-muted-foreground",
  in_review: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approve: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  reject: "bg-destructive/10 text-destructive",
  apply: "bg-primary/10 text-primary",
  rollback: "bg-muted text-muted-foreground",
  exported: "bg-status-bg-subtle text-foreground",
};

export function BundleDecisionTimeline({ bundleId }: { bundleId: string }) {
  const q = useQuery({
    queryKey: ["outcome-bundle-history", bundleId],
    queryFn: () => getBundleDecisionHistory(bundleId),
    enabled: !!bundleId,
  });

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Freigabehistorie</CardTitle></CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : q.error ? (
          <p className="text-sm text-destructive">Nicht ladbar: {(q.error as Error).message}</p>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Entscheidungen geloggt.</p>
        ) : (
          <ol className="space-y-2">
            {(q.data ?? []).map((h, i) => (
              <li key={`${h.created_at}-${i}`} className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
                <Badge className={DECISION_TONE[h.decision] ?? "bg-muted"}>{h.decision}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{h.reason ?? <span className="text-muted-foreground italic">(keine Begründung)</span>}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {new Date(h.created_at).toLocaleString()}{h.actor_id ? ` · actor ${h.actor_id.slice(0, 8)}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
