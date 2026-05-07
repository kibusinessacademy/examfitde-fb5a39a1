import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Network, AlertTriangle, CheckCircle2, Link2, ArrowDownRight, ArrowUpRight, Target, Coins } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import GrowthGraphBackfillControl from './GrowthGraphBackfillControl';
import GrowthGraphEdgePlanCard from './GrowthGraphEdgePlanCard';

type Summary = {
  generated_at: string;
  nodes_total: number;
  nodes_active: number;
  nodes_draft: number;
  nodes_by_asset: Record<string, number>;
  edges_total: number;
  edges_by_type: Record<string, number>;
};

type Orphan = {
  id: string;
  node_slug: string;
  title: string;
  asset_type: string;
  persona: string | null;
  funnel_stage: string | null;
  status: string;
  missing_inbound: boolean;
  missing_outbound: boolean;
  missing_funnel_next: boolean;
  missing_money_page: boolean;
};

type OrphansResult = { generated_at: string; total_nodes: number; orphans: Orphan[] };

type Severity = 'OK' | 'P2' | 'P1' | 'P0';

function severity(orphansShare: number, missingMoney: number, missingFunnel: number): {
  level: Severity;
  reason: string;
  action: string;
} {
  if (missingMoney === 0 && missingFunnel === 0 && orphansShare === 0) {
    return { level: 'OK', reason: 'Graph vollständig verlinkt.', action: 'Nichts zu tun. Beobachten.' };
  }
  if (missingMoney > 0) {
    return {
      level: 'P0',
      reason: `${missingMoney} Knoten ohne money_page-Edge → Conversion-Pfad fehlt.`,
      action: 'Money-Page-Links für Top-Orphans manuell registrieren (Phase 2C Backfill priorisieren).',
    };
  }
  if (orphansShare > 0.5 || missingFunnel > 10) {
    return {
      level: 'P1',
      reason: `${(orphansShare * 100).toFixed(0)} % der Knoten unverlinkt, ${missingFunnel} ohne funnel_next.`,
      action: 'Funnel-Next-Edges priorisieren. Hub-Nodes je Cluster definieren.',
    };
  }
  return {
    level: 'P2',
    reason: `Vereinzelte Orphans (${(orphansShare * 100).toFixed(0)} %).`,
    action: 'Top-Orphans in nächstem Content-Sweep verlinken.',
  };
}

const sevColor: Record<Severity, string> = {
  OK: 'bg-success-bg-subtle text-success border-success/30',
  P2: 'bg-warning-bg-subtle text-warning border-warning/30',
  P1: 'bg-warning-bg-subtle text-warning border-warning/40',
  P0: 'bg-destructive-bg-subtle text-destructive border-destructive/40',
};

function StatTile({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-subtle p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

export default function GrowthGraphLeitstelleCard() {
  const summaryQ = useQuery({
    queryKey: ['growth-graph-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_content_graph_summary');
      if (error) throw error;
      return data as unknown as Summary;
    },
    staleTime: 60_000,
  });

  const orphansQ = useQuery({
    queryKey: ['growth-graph-orphans'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_content_graph_orphans');
      if (error) throw error;
      return data as unknown as OrphansResult;
    },
    staleTime: 60_000,
  });

  const loading = summaryQ.isLoading || orphansQ.isLoading;
  const error = summaryQ.error || orphansQ.error;

  const refresh = () => {
    summaryQ.refetch();
    orphansQ.refetch();
  };

  const summary = summaryQ.data;
  const orphans = orphansQ.data?.orphans ?? [];
  const totals = {
    inbound: orphans.filter((o) => o.missing_inbound).length,
    outbound: orphans.filter((o) => o.missing_outbound).length,
    funnel: orphans.filter((o) => o.missing_funnel_next).length,
    money: orphans.filter((o) => o.missing_money_page).length,
  };
  const sev = severity(
    summary?.nodes_total ? orphans.length / summary.nodes_total : 0,
    totals.money,
    totals.funnel,
  );

  return (
    <Card className="shadow-elev-1">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-primary" />
            Growth Graph · Leitstelle
            <Badge variant="outline" className={`text-[10px] ${sevColor[sev.level]}`}>{sev.level}</Badge>
          </CardTitle>
          <CardDescription className="mt-1 text-xs">{sev.reason}</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="gap-1">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="rounded border border-destructive/30 bg-destructive-bg-subtle p-3 text-xs text-destructive">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Fehler beim Laden
            </div>
            <div className="mt-1 opacity-80">{(error as Error).message}</div>
            <Button size="sm" variant="outline" onClick={refresh} className="mt-2">Retry</Button>
          </div>
        )}

        {loading && !error && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        )}

        {!loading && !error && summary && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatTile label="Nodes total" value={summary.nodes_total} icon={Network}
                hint={`${summary.nodes_active} active · ${summary.nodes_draft} draft`} />
              <StatTile label="Edges total" value={summary.edges_total} icon={Link2} />
              <StatTile label="Orphans" value={orphans.length} icon={AlertTriangle}
                hint={summary.nodes_total ? `${((orphans.length / summary.nodes_total) * 100).toFixed(0)} %` : undefined} />
              <StatTile label="OK Nodes" value={Math.max(0, summary.nodes_total - orphans.length)} icon={CheckCircle2} />
              <StatTile label="Missing inbound" value={totals.inbound} icon={ArrowDownRight} />
              <StatTile label="Missing outbound" value={totals.outbound} icon={ArrowUpRight} />
              <StatTile label="Missing funnel_next" value={totals.funnel} icon={Target} />
              <StatTile label="Missing money_page" value={totals.money} icon={Coins} />
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="text-xs font-medium text-foreground">Empfohlene nächste Aktion</div>
              <div className="text-xs text-muted-foreground mt-0.5">{sev.action}</div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-foreground">Top 25 Orphans</h4>
                <span className="text-[11px] text-muted-foreground">
                  Edges by type:{' '}
                  {Object.entries(summary.edges_by_type ?? {}).map(([k, v]) => `${k}:${v}`).join(' · ') || '—'}
                </span>
              </div>
              {orphans.length === 0 ? (
                <div className="rounded border border-success/30 bg-success-bg-subtle p-3 text-xs text-success">
                  Keine Orphans. Graph vollständig verlinkt.
                </div>
              ) : (
                <ScrollArea className="h-[280px] rounded border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-subtle text-muted-foreground">
                      <tr>
                        <th className="text-left p-2 font-medium">Slug</th>
                        <th className="text-left p-2 font-medium">Type</th>
                        <th className="text-center p-2 font-medium">In</th>
                        <th className="text-center p-2 font-medium">Out</th>
                        <th className="text-center p-2 font-medium">Funnel</th>
                        <th className="text-center p-2 font-medium">Money</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orphans.slice(0, 25).map((o) => (
                        <tr key={o.id} className="border-t border-border/40">
                          <td className="p-2 font-mono text-[11px] text-foreground truncate max-w-[260px]">{o.node_slug}</td>
                          <td className="p-2 text-muted-foreground">{o.asset_type}</td>
                          <td className="p-2 text-center">{o.missing_inbound ? '❌' : '✓'}</td>
                          <td className="p-2 text-center">{o.missing_outbound ? '❌' : '✓'}</td>
                          <td className="p-2 text-center">{o.missing_funnel_next ? '❌' : '✓'}</td>
                          <td className="p-2 text-center">{o.missing_money_page ? '❌' : '✓'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </div>
          </>
        )}

        <GrowthGraphBackfillControl />
      </CardContent>
    </Card>
  );
}
