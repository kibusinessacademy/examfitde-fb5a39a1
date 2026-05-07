import { useQuery } from '@tanstack/react-query';
import { GitBranch, RefreshCw, AlertTriangle, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';

type Proposal = {
  to_node_slug: string;
  to_title: string;
  edge_type: 'money_page' | 'funnel_next';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
};
type NodeRow = {
  from_node_id: string;
  from_slug: string;
  from_title: string;
  from_asset: string;
  high_count: number;
  medium_count: number;
  low_count: number;
  proposals: Proposal[];
};
type EdgePlan = {
  generated_at: string;
  totals: {
    nodes_missing_money: number;
    nodes_missing_funnel: number;
    proposals_high: number;
    proposals_medium: number;
    proposals_low: number;
    proposals_total: number;
  };
  nodes: NodeRow[];
  note: string;
};

const confColor: Record<Proposal['confidence'], string> = {
  high: 'bg-success-bg-subtle text-success border-success/30',
  medium: 'bg-warning-bg-subtle text-warning border-warning/30',
  low: 'bg-muted text-muted-foreground border-border/40',
};

export default function GrowthGraphEdgePlanCard() {
  const planQ = useQuery({
    queryKey: ['growth-graph-edge-plan'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_preview_content_graph_edge_plan', {
        p_limit_per_node: 3,
        p_max_nodes: 100,
      });
      if (error) throw error;
      return data as unknown as EdgePlan;
    },
    staleTime: 60_000,
  });

  // Flatten Top 25 proposals across all nodes, sorted by confidence then edge_type
  const flatTop = (planQ.data?.nodes ?? [])
    .flatMap((n) =>
      n.proposals.map((p) => ({ ...p, from_slug: n.from_slug, from_asset: n.from_asset })),
    )
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      if (order[a.confidence] !== order[b.confidence]) return order[a.confidence] - order[b.confidence];
      return a.edge_type.localeCompare(b.edge_type);
    })
    .slice(0, 25);

  return (
    <div className="rounded-lg border border-border/60 bg-surface-subtle p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <GitBranch className="h-3.5 w-3.5 text-primary" />
          Phase 2E · Edge Plan
          <Badge variant="outline" className="text-[10px]">read-only</Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={() => planQ.refetch()} disabled={planQ.isFetching} className="h-7 gap-1">
          <RefreshCw className={`h-3 w-3 ${planQ.isFetching ? 'animate-spin' : ''}`} />
          <span className="text-[11px]">Refresh</span>
        </Button>
      </div>

      {planQ.isLoading && (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      )}

      {planQ.error && (
        <div className="rounded border border-destructive/30 bg-destructive-bg-subtle p-2 text-xs text-destructive">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-3 w-3" /> Edge-Plan-Fehler
          </div>
          <div className="mt-1 opacity-80">{(planQ.error as Error).message}</div>
          <Button size="sm" variant="outline" onClick={() => planQ.refetch()} className="mt-2 h-7">Retry</Button>
        </div>
      )}

      {planQ.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <div className="rounded border border-border/40 bg-background p-2">
              <div className="text-muted-foreground text-[11px]">Missing money_page</div>
              <div className="text-lg font-semibold tabular-nums">{planQ.data.totals.nodes_missing_money}</div>
            </div>
            <div className="rounded border border-border/40 bg-background p-2">
              <div className="text-muted-foreground text-[11px]">Missing funnel_next</div>
              <div className="text-lg font-semibold tabular-nums">{planQ.data.totals.nodes_missing_funnel}</div>
            </div>
            <div className="rounded border border-border/40 bg-background p-2">
              <div className="text-muted-foreground text-[11px]">Proposals total</div>
              <div className="text-lg font-semibold tabular-nums">{planQ.data.totals.proposals_total}</div>
            </div>
            <div className="rounded border border-success/30 bg-success-bg-subtle p-2">
              <div className="text-success text-[11px]">High</div>
              <div className="text-lg font-semibold tabular-nums text-success">{planQ.data.totals.proposals_high}</div>
            </div>
            <div className="rounded border border-warning/30 bg-warning-bg-subtle p-2">
              <div className="text-warning text-[11px]">Medium</div>
              <div className="text-lg font-semibold tabular-nums text-warning">{planQ.data.totals.proposals_medium}</div>
            </div>
            <div className="rounded border border-border/40 bg-background p-2">
              <div className="text-muted-foreground text-[11px]">Low</div>
              <div className="text-lg font-semibold tabular-nums">{planQ.data.totals.proposals_low}</div>
            </div>
          </div>

          <div className="rounded border border-primary/30 bg-primary/5 p-2 text-[11px] text-muted-foreground flex items-start gap-2">
            <Eye className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
            <span>Read-only Vorschläge. Es werden keine Edges geschrieben. Apply (high-confidence, max 25/Run) folgt in Phase 2F.</span>
          </div>

          <div>
            <div className="text-xs font-medium text-foreground mb-2">Top 25 Vorschläge</div>
            {flatTop.length === 0 ? (
              <div className="rounded border border-success/30 bg-success-bg-subtle p-3 text-xs text-success">
                Keine offenen Vorschläge.
              </div>
            ) : (
              <ScrollArea className="h-[300px] rounded border border-border/60">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-subtle text-muted-foreground">
                    <tr>
                      <th className="text-left p-2 font-medium">From</th>
                      <th className="text-left p-2 font-medium">→ To</th>
                      <th className="text-left p-2 font-medium">Type</th>
                      <th className="text-left p-2 font-medium">Conf.</th>
                      <th className="text-left p-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flatTop.map((p, i) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="p-2 font-mono text-[11px] text-foreground truncate max-w-[180px]" title={p.from_slug}>{p.from_slug}</td>
                        <td className="p-2 font-mono text-[11px] text-foreground truncate max-w-[180px]" title={p.to_node_slug}>{p.to_node_slug}</td>
                        <td className="p-2 text-muted-foreground">{p.edge_type}</td>
                        <td className="p-2">
                          <Badge variant="outline" className={`text-[10px] ${confColor[p.confidence]}`}>{p.confidence}</Badge>
                        </td>
                        <td className="p-2 text-muted-foreground text-[11px]">{p.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </div>
        </>
      )}
    </div>
  );
}
