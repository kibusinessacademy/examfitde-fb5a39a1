/**
 * SeoDeadEndCoverageCard — E3d
 * SSOT: v_seo_dead_end_coverage via admin_get_seo_dead_end_coverage.
 * Read-only Leitstelle: kein Apply, kein Direct-Table-Read.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
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
import { ShieldAlert, RefreshCw, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";

const STATUS_ORDER = [
  "OK",
  "NO_PRODUCT_PAGE",
  "NO_PILLAR",
  "PILLAR_NOT_LINKED_TO_PACKAGE",
  "PILLAR_NOT_PUBLISHED",
  "NO_SPOKES",
  "SPOKES_NOT_PUBLISHED",
  "BLOG_CONTEXTUAL_LINKS_BLOCKED",
  "INTERNAL_LINKS_MISSING",
];

type Row = {
  package_id: string;
  package_title: string;
  product_slug: string | null;
  catalog_id: string | null;
  pillar_id: string | null;
  pillar_published: boolean | null;
  spokes_total: number;
  spokes_published: number;
  blog_total: number;
  blog_published: number;
  links_active: number;
  status: string;
  is_seo_dead_end: boolean;
  blocking_reason: string;
  recommended_next_action: string;
};

type Response = {
  summary: {
    total_published_packages: number;
    ok_count: number;
    dead_end_count: number;
    by_status: Record<string, number>;
  };
  rows: Row[];
};

export function SeoDeadEndCoverageCard() {
  const [statusFilter, setStatusFilter] = useState<string>("__all");
  const [limit, setLimit] = useState(100);

  const q = useQuery({
    queryKey: ["e3d-seo-dead-end", statusFilter, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_seo_dead_end_coverage" as any,
        {
          p_status: statusFilter === "__all" ? null : statusFilter,
          p_limit: limit,
        },
      );
      if (error) throw error;
      return data as unknown as Response;
    },
    refetchInterval: 120_000,
    staleTime: 30_000,
  });

  const summary = q.data?.summary;
  const rows = q.data?.rows ?? [];

  const topBlockers = useMemo(() => {
    if (!summary?.by_status) return [];
    return Object.entries(summary.by_status)
      .filter(([s]) => s !== "OK")
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 4);
  }, [summary]);

  const status =
    !summary
      ? "loading"
      : summary.dead_end_count === 0
        ? "OK"
        : summary.dead_end_count > summary.total_published_packages * 0.25
          ? "CRIT"
          : "WARN";

  const statusBadge =
    status === "OK"
      ? { variant: "default" as const, label: "all clear" }
      : status === "CRIT"
        ? { variant: "destructive" as const, label: `${summary?.dead_end_count ?? 0} dead-end` }
        : { variant: "outline" as const, label: `${summary?.dead_end_count ?? 0} drift` };

  function exportCsv() {
    if (rows.length === 0) return;
    const csv = toCsv(
      rows.map((r) => ({
        package_id: r.package_id,
        package_title: r.package_title,
        product_slug: r.product_slug ?? "",
        status: r.status,
        is_seo_dead_end: r.is_seo_dead_end,
        blocking_reason: r.blocking_reason,
        recommended_next_action: r.recommended_next_action,
        catalog_id: r.catalog_id ?? "",
        pillar_id: r.pillar_id ?? "",
        pillar_published: r.pillar_published ?? false,
        spokes_total: r.spokes_total,
        spokes_published: r.spokes_published,
        blog_total: r.blog_total,
        blog_published: r.blog_published,
        links_active: r.links_active,
      })),
    );
    downloadCsv(`seo-dead-end-coverage-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> SEO Dead-End Coverage (E3d)
          <Badge variant={statusBadge.variant} className="text-[10px]">
            {statusBadge.label}
          </Badge>
          {summary && (
            <Badge variant="secondary" className="text-[10px]">
              {summary.ok_count}/{summary.total_published_packages} OK
            </Badge>
          )}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All statuses</SelectItem>
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ").toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) =>
              setLimit(Math.min(500, Math.max(1, Number(e.target.value) || 1)))
            }
            className="h-8 w-20 text-xs"
            aria-label="Limit (max 500)"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={q.isFetching}
            onClick={() => q.refetch()}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${q.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={rows.length === 0}
            onClick={exportCsv}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            CSV
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.isError ? (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {(q.error as Error)?.message ?? "Load failed"}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="border rounded-md px-2 py-1.5 text-[11px]">
              <div className="text-text-tertiary">Total published</div>
              <div className="text-lg font-semibold tabular-nums">
                {summary?.total_published_packages ?? 0}
              </div>
            </div>
            <div className="border rounded-md px-2 py-1.5 text-[11px]">
              <div className="text-text-tertiary flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> OK
              </div>
              <div className="text-lg font-semibold tabular-nums text-success">
                {summary?.ok_count ?? 0}
              </div>
            </div>
            <div className="border rounded-md px-2 py-1.5 text-[11px]">
              <div className="text-text-tertiary">Dead-end</div>
              <div className="text-lg font-semibold tabular-nums text-destructive">
                {summary?.dead_end_count ?? 0}
              </div>
            </div>
            <div className="border rounded-md px-2 py-1.5 text-[11px]">
              <div className="text-text-tertiary">Top blocker</div>
              <div className="text-[11px] font-medium truncate">
                {topBlockers[0]
                  ? `${topBlockers[0][0].replace(/_/g, " ").toLowerCase()} · ${topBlockers[0][1]}`
                  : "—"}
              </div>
            </div>
          </div>

          {topBlockers.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {topBlockers.map(([s, c]) => (
                <Badge key={s} variant="outline" className="text-[10px]">
                  {s.replace(/_/g, " ").toLowerCase()}: <span className="ml-1 tabular-nums">{c as number}</span>
                </Badge>
              ))}
            </div>
          )}

          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Package</TableHead>
                  <TableHead className="text-[11px]">Status</TableHead>
                  <TableHead className="text-[11px]">Blocking reason</TableHead>
                  <TableHead className="text-[11px] text-right">Spokes</TableHead>
                  <TableHead className="text-[11px] text-right">Blog</TableHead>
                  <TableHead className="text-[11px] text-right">Links</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-[11px] text-muted-foreground py-4">
                      Keine Zeilen.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.slice(0, 50).map((r) => (
                    <TableRow key={r.package_id}>
                      <TableCell className="text-[11px]">
                        <div className="font-medium truncate max-w-[220px]" title={r.package_title}>
                          {r.package_title}
                        </div>
                        {r.product_slug && (
                          <div className="text-text-tertiary text-[10px] truncate">
                            /p/{r.product_slug}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <Badge
                          variant={r.is_seo_dead_end ? "destructive" : "default"}
                          className="text-[10px]"
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[11px] max-w-[280px]">
                        <div className="truncate" title={r.blocking_reason}>
                          {r.blocking_reason}
                        </div>
                        <div className="text-text-tertiary text-[10px] truncate" title={r.recommended_next_action}>
                          → {r.recommended_next_action}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px] text-right tabular-nums">
                        {r.spokes_published}/{r.spokes_total}
                      </TableCell>
                      <TableCell className="text-[11px] text-right tabular-nums">
                        {r.blog_published}/{r.blog_total}
                      </TableCell>
                      <TableCell className="text-[11px] text-right tabular-nums">
                        {r.links_active}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {rows.length > 50 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Zeige 50 von {rows.length} · CSV für vollständige Liste.
            </p>
          )}
        </>
      )}

      <p className="text-[10px] text-muted-foreground mt-2">
        SSOT: <code>v_seo_dead_end_coverage</code> · RPC:{" "}
        <code>admin_get_seo_dead_end_coverage</code> · Guard:{" "}
        <code>seo_dead_end_guard_detected</code> (fail-soft)
      </p>
    </Card>
  );
}
