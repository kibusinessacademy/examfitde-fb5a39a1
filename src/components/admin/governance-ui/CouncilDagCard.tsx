import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Edge = {
  id: string;
  from_council: string;
  to_council: string;
  edge_type: string | null;
  condition: string | null;
  is_active: boolean;
};

type Chain = {
  id: string;
  root_finding_kind: string;
  package_id: string | null;
  chain: any;
  status: string;
  qualification_severity: string | null;
  opened_at: string;
};

export function CouncilDagCard() {
  const { data: edges } = useQuery({
    queryKey: ["council-dag-edges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("council_dag_edges")
        .select("*")
        .eq("is_active", true)
        .order("from_council");
      if (error) throw error;
      return (data ?? []) as Edge[];
    },
  });

  const { data: chains } = useQuery({
    queryKey: ["council-decision-chains"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("council_decision_chains")
        .select("id,root_finding_kind,package_id,chain,status,qualification_severity,opened_at")
        .order("opened_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as Chain[];
    },
    refetchInterval: 60_000,
  });

  // Group edges by from_council for a simple readable flow
  const grouped = (edges ?? []).reduce<Record<string, Edge[]>>((acc, e) => {
    (acc[e.from_council] ||= []).push(e);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Council DAG</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Edges (aktiv)</h3>
          {!edges?.length ? (
            <p className="text-sm text-muted-foreground">Keine aktiven Edges.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {Object.entries(grouped).map(([from, list]) => (
                <div key={from} className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono">{from}</Badge>
                  <span>→</span>
                  {list.map((e) => (
                    <Badge key={e.id} variant="secondary" className="font-mono">
                      {e.to_council}
                      {e.edge_type ? ` (${e.edge_type})` : ""}
                    </Badge>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Letzte Decision Chains</h3>
          {!chains?.length ? (
            <p className="text-sm text-muted-foreground">Keine Chains.</p>
          ) : (
            <ul className="space-y-2">
              {chains.map((c) => (
                <li key={c.id} className="rounded border p-2 text-xs space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={c.status === "open" ? "default" : "outline"}>{c.status}</Badge>
                    {c.qualification_severity && (
                      <Badge variant="secondary">{c.qualification_severity}</Badge>
                    )}
                    <span className="font-mono">{c.root_finding_kind}</span>
                    {c.package_id && (
                      <span className="font-mono text-muted-foreground">
                        pkg {c.package_id.slice(0, 8)}
                      </span>
                    )}
                    <span className="ml-auto text-muted-foreground">
                      {new Date(c.opened_at).toLocaleString()}
                    </span>
                  </div>
                  <pre className="overflow-x-auto bg-muted/30 p-2 rounded text-[10px]">
                    {JSON.stringify(c.chain, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
