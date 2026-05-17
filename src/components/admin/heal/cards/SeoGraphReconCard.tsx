/**
 * SeoGraphReconCard — E3d.2b
 * SSOT: v_seo_graph_authority_summary + 4 detail views
 *   via admin_get_seo_graph_recon_summary / _pillar_authority_weighted /
 *       _node_diversity / _node_reach / _seo_graph_patterns.
 *
 * Semantischer Tiefen-Recon nach E3d.3 Baseline.
 * Read-only. Keine Mutationen — Diagnostik für E3e (Authority Optimization Layer).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Microscope, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

type Summary = {
  pillars_analyzed: number;
  pillar_coverage_entropy: number;
  avg_hop_depth: number | null;
  max_hop_depth: number | null;
  unreachable_nodes: number;
  deep_nodes: number;
  pattern_one_way_contextual: number;
  pattern_cluster_deadend: number;
  pattern_overlinked_hub: number;
  pattern_low_contextual_degree: number;
  pattern_certification_island: number;
  pattern_structural_only: number;
  snapshot_at: string;
};

type PillarW = {
  pillar_url: string;
  inbound_total: number;
  inbound_from_spokes: number;
  inbound_contextual: number;
  outbound_total: number;
  authority_tier: string;
  base_score: number;
  weighted_authority: number;
  contextual_inbound_pct: number;
};

type Diversity = {
  source_url: string;
  contextual_outbound: number;
  distinct_targets: number;
  entropy_nats: number;
  diversity_score: number;
  diversity_tier: string;
};

type Reach = {
  node_url: string;
  node_role: string;
  hop_depth_to_pillar: number;
  reach_tier: string;
};

type PatternRow = {
  url: string;
  node_role: string;
  inbound_total: number;
  outbound_total: number;
  in_contextual: number;
  out_contextual: number;
  contextual_diversity: number;
  contextual_distinct_targets: number;
  hop_depth_to_pillar: number;
  reach_tier: string;
  one_way_contextual: boolean;
  cluster_deadend: boolean;
  overlinked_hub: boolean;
  low_contextual_degree: boolean;
  certification_island: boolean;
  structural_only: boolean;
};

type PatternKey =
  | "one_way_contextual"
  | "cluster_deadend"
  | "overlinked_hub"
  | "low_contextual_degree"
  | "certification_island"
  | "structural_only";

function rpc<T>(
  fn:
    | "admin_get_seo_graph_recon_summary"
    | "admin_get_seo_pillar_authority_weighted"
    | "admin_get_seo_node_diversity"
    | "admin_get_seo_node_reach"
    | "admin_get_seo_graph_patterns",
  args?: Record<string, unknown>,
) {
  return async (): Promise<T[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(fn, args ?? {});
    if (error) throw error;
    return (data ?? []) as T[];
  };
}

export function SeoGraphReconCard() {
  const [tab, setTab] = useState<
    "summary" | "pillars" | "diversity" | "reach" | "patterns"
  >("summary");
  const [pattern, setPattern] = useState<PatternKey>("low_contextual_degree");
  const [reachTier, setReachTier] = useState<string>("unreachable");

  const summaryQ = useQuery({
    queryKey: ["seo-recon-summary"],
    queryFn: rpc<Summary>("admin_get_seo_graph_recon_summary"),
    refetchInterval: 180_000,
    staleTime: 60_000,
  });
  const pillarsQ = useQuery({
    queryKey: ["seo-recon-pillars"],
    queryFn: rpc<PillarW>("admin_get_seo_pillar_authority_weighted", { p_limit: 25 }),
    enabled: tab === "pillars",
  });
  const diversityQ = useQuery({
    queryKey: ["seo-recon-diversity"],
    queryFn: rpc<Diversity>("admin_get_seo_node_diversity", { p_limit: 50 }),
    enabled: tab === "diversity",
  });
  const reachQ = useQuery({
    queryKey: ["seo-recon-reach", reachTier],
    queryFn: rpc<Reach>("admin_get_seo_node_reach", {
      p_limit: 100,
      p_tier: reachTier === "all" ? null : reachTier,
    }),
    enabled: tab === "reach",
  });
  const patternsQ = useQuery({
    queryKey: ["seo-recon-patterns", pattern],
    queryFn: rpc<PatternRow>("admin_get_seo_graph_patterns", {
      p_pattern: pattern,
      p_limit: 100,
    }),
    enabled: tab === "patterns",
  });

  const s = summaryQ.data?.[0];
  const totalPatterns = s
    ? s.pattern_one_way_contextual +
      s.pattern_cluster_deadend +
      s.pattern_overlinked_hub +
      s.pattern_certification_island
    : 0;
  const severity: "OK" | "WARN" | "CRIT" = !s
    ? "OK"
    : s.pattern_overlinked_hub > 0 || s.pattern_cluster_deadend > 50
      ? "CRIT"
      : totalPatterns > 100
        ? "WARN"
        : "OK";

  const refetchAll = () => {
    summaryQ.refetch();
    if (tab === "pillars") pillarsQ.refetch();
    if (tab === "diversity") diversityQ.refetch();
    if (tab === "reach") reachQ.refetch();
    if (tab === "patterns") patternsQ.refetch();
  };

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <Microscope className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              SEO Graph Recon (E3d.2b)
            </h3>
            <p className="text-sm text-muted-foreground">
              Semantischer Tiefen-Recon: Diversity, Reach, Pattern-Erkennung.
              Diagnose-Grundlage für E3e Authority-Optimization.
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
            disabled={summaryQ.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${summaryQ.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {summaryQ.isLoading || !s ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="pillars">Pillars (Weighted)</TabsTrigger>
            <TabsTrigger value="diversity">Diversity</TabsTrigger>
            <TabsTrigger value="reach">Reach</TabsTrigger>
            <TabsTrigger value="patterns">Patterns</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="pt-3 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi
                label="Pillar Coverage Entropy"
                value={Number(s.pillar_coverage_entropy).toFixed(3)}
                hint={`max ln(${s.pillars_analyzed}) = ${Math.log(s.pillars_analyzed).toFixed(2)}`}
              />
              <Kpi
                label="Avg Hop → Pillar"
                value={s.avg_hop_depth?.toString() ?? "—"}
                hint={`max ${s.max_hop_depth ?? "—"}`}
              />
              <Kpi
                label="Unreachable"
                value={s.unreachable_nodes.toString()}
                tone={s.unreachable_nodes > 50 ? "warn" : undefined}
              />
              <Kpi
                label="Deep Nodes (≥5)"
                value={s.deep_nodes.toString()}
                tone={s.deep_nodes > 20 ? "warn" : undefined}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              <PatternChip label="one_way_contextual" value={s.pattern_one_way_contextual} />
              <PatternChip label="cluster_deadend" value={s.pattern_cluster_deadend} />
              <PatternChip
                label="overlinked_hub"
                value={s.pattern_overlinked_hub}
                tone={s.pattern_overlinked_hub > 0 ? "crit" : undefined}
              />
              <PatternChip
                label="low_contextual_degree"
                value={s.pattern_low_contextual_degree}
              />
              <PatternChip
                label="certification_island"
                value={s.pattern_certification_island}
              />
              <PatternChip label="structural_only" value={s.pattern_structural_only} />
            </div>
            <p className="text-xs text-muted-foreground">
              Snapshot: {new Date(s.snapshot_at).toLocaleString()}. Hinweis:
              certification_island + structural_only sind primär eine Folge der
              strukturellen Trennung zwischen contextual-Blog-Graph und
              Pillar/Spoke-Layer — Input für E3e Bridging-Strategie.
            </p>
          </TabsContent>

          <TabsContent value="pillars" className="pt-3">
            <DataTable
              loading={pillarsQ.isLoading}
              empty="Keine Pillars."
              rows={pillarsQ.data ?? []}
              columns={[
                { h: "Pillar URL", c: (r: PillarW) => <span className="font-mono text-xs">{r.pillar_url}</span> },
                { h: "Weighted", c: (r: PillarW) => Number(r.weighted_authority).toFixed(1) },
                { h: "Ctx In %", c: (r: PillarW) => `${Number(r.contextual_inbound_pct).toFixed(0)}%` },
                { h: "Spokes In", c: (r: PillarW) => r.inbound_from_spokes },
                { h: "Ctx In", c: (r: PillarW) => r.inbound_contextual },
                { h: "Tier", c: (r: PillarW) => <Badge variant="outline">{r.authority_tier}</Badge> },
              ]}
            />
          </TabsContent>

          <TabsContent value="diversity" className="pt-3">
            <DataTable
              loading={diversityQ.isLoading}
              empty="Keine Daten."
              rows={diversityQ.data ?? []}
              columns={[
                { h: "Source URL", c: (r: Diversity) => <span className="font-mono text-xs">{r.source_url}</span> },
                { h: "Ctx Out", c: (r: Diversity) => r.contextual_outbound },
                { h: "Targets", c: (r: Diversity) => r.distinct_targets },
                { h: "Entropy", c: (r: Diversity) => Number(r.entropy_nats).toFixed(2) },
                { h: "Diversity", c: (r: Diversity) => Number(r.diversity_score).toFixed(2) },
                { h: "Tier", c: (r: Diversity) => <Badge variant="outline">{r.diversity_tier}</Badge> },
              ]}
            />
          </TabsContent>

          <TabsContent value="reach" className="pt-3 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Tier:</span>
              <Select value={reachTier} onValueChange={setReachTier}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="unreachable">unreachable</SelectItem>
                  <SelectItem value="deep">deep (≥5)</SelectItem>
                  <SelectItem value="moderate">moderate (3-4)</SelectItem>
                  <SelectItem value="shallow">shallow (≤2)</SelectItem>
                  <SelectItem value="direct">direct (1)</SelectItem>
                  <SelectItem value="is_pillar">is_pillar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DataTable
              loading={reachQ.isLoading}
              empty="Keine Knoten in diesem Tier."
              rows={reachQ.data ?? []}
              columns={[
                { h: "URL", c: (r: Reach) => <span className="font-mono text-xs">{r.node_url}</span> },
                { h: "Role", c: (r: Reach) => r.node_role },
                {
                  h: "Hop",
                  c: (r: Reach) =>
                    r.hop_depth_to_pillar >= 99 ? "∞" : r.hop_depth_to_pillar,
                },
                { h: "Tier", c: (r: Reach) => <Badge variant="outline">{r.reach_tier}</Badge> },
              ]}
            />
          </TabsContent>

          <TabsContent value="patterns" className="pt-3 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Pattern:</span>
              <Select value={pattern} onValueChange={(v) => setPattern(v as PatternKey)}>
                <SelectTrigger className="w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low_contextual_degree">low_contextual_degree</SelectItem>
                  <SelectItem value="cluster_deadend">cluster_deadend</SelectItem>
                  <SelectItem value="one_way_contextual">one_way_contextual</SelectItem>
                  <SelectItem value="overlinked_hub">overlinked_hub</SelectItem>
                  <SelectItem value="certification_island">certification_island</SelectItem>
                  <SelectItem value="structural_only">structural_only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DataTable
              loading={patternsQ.isLoading}
              empty="Keine Treffer für dieses Pattern."
              rows={patternsQ.data ?? []}
              columns={[
                { h: "URL", c: (r: PatternRow) => <span className="font-mono text-xs">{r.url}</span> },
                { h: "Role", c: (r: PatternRow) => r.node_role },
                { h: "In/Out", c: (r: PatternRow) => `${r.inbound_total}/${r.outbound_total}` },
                { h: "Ctx In/Out", c: (r: PatternRow) => `${r.in_contextual}/${r.out_contextual}` },
                { h: "Diversity", c: (r: PatternRow) => Number(r.contextual_diversity).toFixed(2) },
                {
                  h: "Hop",
                  c: (r: PatternRow) =>
                    r.hop_depth_to_pillar >= 99 ? "∞" : r.hop_depth_to_pillar,
                },
              ]}
            />
          </TabsContent>
        </Tabs>
      )}
    </Card>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
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
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function PatternChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "crit";
}) {
  return (
    <div
      className={`rounded border px-2 py-1 flex justify-between ${
        tone === "crit"
          ? "border-destructive/40 bg-destructive/5"
          : tone === "warn"
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-border bg-muted/40"
      }`}
    >
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
