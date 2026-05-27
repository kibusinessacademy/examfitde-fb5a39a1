import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAgentVerticalMatrix } from "@/lib/berufs-ki/outcome";

export function AgentVerticalMatrix() {
  const q = useQuery({ queryKey: ["agent-vertical-matrix"], queryFn: getAgentVerticalMatrix });

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Agent × Branche · Coverage</CardTitle></CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-48 w-full" />
          : q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p>
          : !q.data?.agents?.length || !q.data?.verticals?.length ? (
            <p className="text-sm text-muted-foreground">Keine Daten.</p>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-card p-2 text-left font-medium">Agent</th>
                    {q.data.verticals.map(v => (
                      <th key={v.industry_key} className="p-2 text-left font-medium" title={v.name}>
                        {v.industry_key.slice(0, 6)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.data.agents.map(a => (
                    <tr key={a.slug} className="border-t border-border">
                      <td className="sticky left-0 bg-card p-2 font-medium">{a.slug.replace("outcome-", "")}</td>
                      {q.data.verticals.map(v => {
                        const cell = q.data.cells.find(c => c.agent_slug === a.slug && c.vertical_key === v.industry_key);
                        const count = cell?.bundle_count ?? 0;
                        const intensity = Math.min(count / 5, 1);
                        const bg = count === 0 ? "bg-muted/30" : "";
                        return (
                          <td key={v.industry_key} className={`p-2 text-center tabular-nums ${bg}`}
                              style={count > 0 ? { background: `hsl(var(--primary) / ${0.1 + intensity * 0.4})` } : {}}
                              title={cell ? `${count} bundles · avg ${cell.avg_completeness}%` : "no runs"}>
                            {count > 0 ? count : "·"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
