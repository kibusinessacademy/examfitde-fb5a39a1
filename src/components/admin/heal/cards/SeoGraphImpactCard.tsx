/**
 * SeoGraphImpactCard — E3d.3
 * SSOT: v_seo_graph_metrics / v_seo_pillar_authority / v_seo_orphan_analysis /
 *       v_seo_contextual_density / v_seo_graph_hubs
 * via admin_get_seo_graph_metrics / _pillar_authority / _graph_orphans /
 *     _contextual_density / _seo_graph_hubs.
 *
 * Read-only Leitstelle. Misst den realen Internal-SEO-Link-Graph
 * nach der E3d.2a Contextual-Materialization (+454% active edges).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Network, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

type GraphMetrics = {
  edges_total: number;
  edges_cluster_to_pillar: number;
  edges_pillar_to_cluster: number;
  edges_cluster_to_cluster: number;
  edges_contextual: number;
  edges_cluster_to_product: number;
  nodes_total: number;
  pillars_total: number;
  spokes_total: number;
  nodes_no_inbound: number;
  nodes_no_outbound: number;
  nodes_orphan: number;
  avg_inbound: number;
  avg_outbound: number;
  max_inbound: number;
  max_outbound: number;
  contextual_ratio_pct: number;
  snapshot_at: string;
};

type PillarRow = {
  pillar_url: string;
  inbound_total: number;
  inbound_from_spokes: number;
  inbound_contextual: number;
  outbound_total: number;
  outbound_to_spokes: number;
  authority_tier: string;
  authority_score: number;
};

type OrphanRow = {
  url: string;
  node_role: string;
  inbound_total: number;
  outbound_total: number;
  orphan_class: string;
};

type DensityRow = {
  source_url: string;
  contextual_outbound: number;
  distinct_targets: number;
  avg_relevance: number;
};

type HubRow = {
  url: string;
  node_role: string;
  inbound_total: number;
  outbound_total: number;
  total_degree: number;
};

function rpcMany<T>(
  fn:
    | "admin_get_seo_graph_metrics"
    | "admin_get_pillar_authority"
    | "admin_get_graph_orphans"
    | "admin_get_contextual_density"
    | "admin_get_seo_graph_hubs",
  args?: Record<string, unknown>,
) {
  return async (): Promise<T[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(fn, args ?? {});
    if (error) throw error;
    return (data ?? []) as T[];
  };
}

function tierTone(tier: string) {
  switch (tier) {
    case "strong_hub":
      return "default" as const;
    case "moderate_hub":
      return "secondary" as const;
    case "weak_hub":
      return "outline" as const;
    default:
      return "destructive" as const;
  }
}

export function SeoGraphImpactCard() {
  const [tab, setTab] = useState<"overview" | "pillars" | "orphans" | "density" | "hubs">(
    "overview",
  );

  const metricsQ = useQuery({
    queryKey: ["seo-graph-metrics"],
    queryFn: rpcMany<GraphMetrics>("admin_get_seo_graph_metrics"),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const pillarsQ = useQuery({
    queryKey: ["seo-graph-pillars"],
    queryFn: rpcMany<PillarRow>("admin_get_pillar_authority", { p_limit: 25 }),
    enabled: tab === "pillars",
  });
  const orphansQ = useQuery({
    queryKey: ["seo-graph-orphans"],
    queryFn: rpcMany<OrphanRow>("admin_get_graph_orphans", { p_limit: 100 }),
    enabled: tab === "orphans",
  });
  const densityQ = useQuery({
    queryKey: ["seo-graph-density"],
    queryFn: rpcMany<DensityRow>("admin_get_contextual_density", { p_limit: 50 }),
    enabled: tab === "density",
  });
  const hubsQ = useQuery({
    queryKey: ["seo-graph-hubs"],
    queryFn: rpcMany<HubRow>("admin_get_seo_graph_hubs", { p_limit: 25 }),
    enabled: tab === "hubs",
  });

  const m = metricsQ.data?.[0];
  const orphanRate =
    m && m.nodes_total > 0
      ? Math.round((m.nodes_orphan / m.nodes_total) * 10000) / 100
      : 0;
  const noInboundRate =
    m && m.nodes_total > 0
      ? Math.round((m.nodes_no_inbound / m.nodes_total) * 10000) / 100
      : 0;

  const severity: "OK" | "WARN" | "CRIT" =
    !m
      ? "OK"
      : m.nodes_orphan > 0 || noInboundRate > 5
        ? "CRIT"
        : m.nodes_no_outbound > 50
          ? "WARN"
          : "OK";

  const refetchAll = () => {
    metricsQ.refetch();
    if (tab === "pillars") pillarsQ.refetch();
    if (tab === "orphans") orphansQ.refetch();
    if (tab === "density") densityQ.refetch();
    if (tab === "hubs") hubsQ.refetch();
  };

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <Network className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              SEO Graph Impact (E3d.3)
            </h3>
            <p className="text-sm text-muted-foreground">
              SSOT der internen Linkökonomie nach E3d.2a Materialization.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              severity === "OK"
                ? "secondary"
                : severity === "WARN"
                  ? "outline"
                  : "destructive"
            }
          >
            {severity === "OK" ? (
              <CheckCircle2 className="h-3 w-3 mr-1" />
            ) : (
              <AlertTriangle className="h-3 w-3 mr-1" />
            )}
            {severity}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={refetchAll}
            disabled={metricsQ.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${metricsQ.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {metricsQ.isLoading || !m ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Kpi label="Active Edges" value={m.edges_total.toLocaleString()} />
            <Kpi label="Nodes" value={m.nodes_total.toLocaleString()} />
            <Kpi
              label="Contextual %"
              value={`${Number(m.contextual_ratio_pct).toFixed(1)}%`}
            />
            <Kpi
              label="Avg In/Out"
              value={`${Number(m.avg_inbound).toFixed(1)} / ${Number(m.avg_outbound).toFixed(1)}`}
            />
            <Kpi label="Pillars" value={m.pillars_total.toLocaleString()} />
            <Kpi label="Spokes" value={m.spokes_total.toLocaleString()} />
            <Kpi
              label="No Inbound"
              value={`${m.nodes_no_inbound} (${noInboundRate}%)`}
              tone={noInboundRate > 5 ? "warn" : undefined}
            />
            <Kpi
              label="Full Orphans"
              value={`${m.nodes_orphan} (${orphanRate}%)`}
              tone={m.nodes_orphan > 0 ? "crit" : undefined}
            />
          </div>

          {/* Edge breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4 text-xs">
            <EdgeChip label="cluster→pillar" value={m.edges_cluster_to_pillar} />
            <EdgeChip label="pillar→cluster" value={m.edges_pillar_to_cluster} />
            <EdgeChip label="cluster↔cluster" value={m.edges_cluster_to_cluster} />
            <EdgeChip label="contextual" value={m.edges_contextual} />
            <EdgeChip label="cluster→product" value={m.edges_cluster_to_product} />
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="pillars">Pillars</TabsTrigger>
              <TabsTrigger value="orphans">Orphans</TabsTrigger>
              <TabsTrigger value="density">Density</TabsTrigger>
              <TabsTrigger value="hubs">Top Hubs</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-3">
              <p className="text-sm text-muted-foreground">
                Snapshot: {new Date(m.snapshot_at).toLocaleString()} ·
                Max degree {m.max_inbound} in / {m.max_outbound} out.
                Reichweitenregel: orphan-rate &lt; 1%, no-inbound &lt; 5%, contextual ≥ 60%.
              </p>
            </TabsContent>

            <TabsContent value="pillars" className="pt-3">
              <DataTable
                loading={pillarsQ.isLoading}
                empty="Keine Pillars."
                rows={pillarsQ.data ?? []}
                columns={[
                  { h: "Pillar URL", c: (r: PillarRow) => <span className="font-mono text-xs">{r.pillar_url}</span> },
                  { h: "In", c: (r: PillarRow) => r.inbound_total },
                  { h: "From Spokes", c: (r: PillarRow) => r.inbound_from_spokes },
                  { h: "Ctx In", c: (r: PillarRow) => r.inbound_contextual },
                  { h: "Out", c: (r: PillarRow) => r.outbound_total },
                  {
                    h: "Tier",
                    c: (r: PillarRow) => (
                      <Badge variant={tierTone(r.authority_tier)}>{r.authority_tier}</Badge>
                    ),
                  },
                  { h: "Score", c: (r: PillarRow) => Number(r.authority_score).toFixed(1) },
                ]}
              />
            </TabsContent>

            <TabsContent value="orphans" className="pt-3">
              <DataTable
                loading={orphansQ.isLoading}
                empty="Keine Orphans — Graph vollständig verbunden."
                rows={orphansQ.data ?? []}
                columns={[
                  { h: "URL", c: (r: OrphanRow) => <span className="font-mono text-xs">{r.url}</span> },
                  { h: "Role", c: (r: OrphanRow) => r.node_role },
                  {
                    h: "Class",
                    c: (r: OrphanRow) => (
                      <Badge
                        variant={r.orphan_class === "full_orphan" ? "destructive" : "outline"}
                      >
                        {r.orphan_class}
                      </Badge>
                    ),
                  },
                  { h: "In", c: (r: OrphanRow) => r.inbound_total },
                  { h: "Out", c: (r: OrphanRow) => r.outbound_total },
                ]}
              />
            </TabsContent>

            <TabsContent value="density" className="pt-3">
              <DataTable
                loading={densityQ.isLoading}
                empty="Keine Daten."
                rows={densityQ.data ?? []}
                columns={[
                  { h: "Source URL", c: (r: DensityRow) => <span className="font-mono text-xs">{r.source_url}</span> },
                  { h: "Ctx Out", c: (r: DensityRow) => r.contextual_outbound },
                  { h: "Distinct Targets", c: (r: DensityRow) => r.distinct_targets },
                  { h: "Avg Relevance", c: (r: DensityRow) => Number(r.avg_relevance).toFixed(2) },
                ]}
              />
            </TabsContent>

            <TabsContent value="hubs" className="pt-3">
              <DataTable
                loading={hubsQ.isLoading}
                empty="Keine Daten."
                rows={hubsQ.data ?? []}
                columns={[
                  { h: "URL", c: (r: HubRow) => <span className="font-mono text-xs">{r.url}</span> },
                  { h: "Role", c: (r: HubRow) => r.node_role },
                  { h: "In", c: (r: HubRow) => r.inbound_total },
                  { h: "Out", c: (r: HubRow) => r.outbound_total },
                  { h: "Degree", c: (r: HubRow) => r.total_degree },
                ]}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </Card>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "crit";
}) {
  return (
    <div
      className={`rounded-md border bg-card p-3 ${
        tone === "crit"
          ? "border-destructive/40"
          : tone === "warn"
            ? "border-amber-500/40"
            : "border-border"
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function EdgeChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-muted/40 px-2 py-1 flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value.toLocaleString()}</span>
    </div>
  );
}

type Col<T> = { h: string; c: (row: T) => React.ReactNode };
function DataTable<T>({
  rows,
  columns,
  loading,
  empty,
}: {
  rows: T[];
  columns: Col<T>[];
  loading: boolean;
  empty: string;
}) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground py-4">{empty}</p>;
  return (
    <div className="border rounded-md overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.h}>{col.h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col.h}>{col.c(row)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
