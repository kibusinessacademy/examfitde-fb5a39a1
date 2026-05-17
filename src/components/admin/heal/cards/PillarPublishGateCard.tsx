/**
 * PillarPublishGateCard — E3f-Publish-Gate v1
 * SSOT: v_pillar_publish_readiness via admin_get_pillar_publish_readiness.
 * Live-Publish nur via admin_publish_certification_pillars (Reason ≥ 10 chars).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Rocket, RefreshCw, Download, AlertTriangle, PlayCircle, FlaskConical } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "sonner";

const DECISIONS = [
  "READY_TO_PUBLISH",
  "ALREADY_PUBLISHED",
  "QUALITY_TOO_LOW",
  "META_DESC_TOO_SHORT",
  "MISSING_META_TITLE",
  "MISSING_PACKAGE_LINK",
  "MISSING_CERT_LINK",
  "NO_PUBLISHED_PACKAGE",
  "PRODUCT_NOT_ACTIVE",
  "PRODUCT_NOT_PUBLIC",
  "INVALID_SLUG",
  "SLUG_NOT_UNIQUE",
];

type Row = {
  pillar_id: string;
  slug: string;
  decision: string;
  catalog_id: string | null;
  catalog_slug: string | null;
  package_id: string | null;
  package_title: string | null;
  product_slug: string | null;
  product_status: string | null;
  product_visibility: string | null;
  quality_score: number;
  word_count: number;
  outbound_links: number;
  meta_desc_len: number;
  meta_title_len: number;
  has_package_link: boolean;
  has_cert_link: boolean;
  slug_dup_count: number;
  is_published: boolean;
};

type RunResult = {
  ran_at: string;
  dry_run: boolean;
  limit: number;
  attempted: number;
  published: number;
  skipped: number;
  failed: number;
};

export function PillarPublishGateCard() {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<string>("READY_TO_PUBLISH");
  const [limit, setLimit] = useState(200);
  const [runLimit, setRunLimit] = useState(50);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);

  const q = useQuery({
    queryKey: ["e3f-publish-gate", decision, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_pillar_publish_readiness" as any,
        { p_decision: decision === "__all" ? null : decision, p_limit: limit },
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 120_000,
    staleTime: 30_000,
  });

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of q.data ?? []) m[r.decision] = (m[r.decision] ?? 0) + 1;
    return m;
  }, [q.data]);

  const dryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_publish_certification_pillars" as any,
        { p_limit: runLimit, p_dry_run: true, p_reason: null },
      );
      if (error) throw error;
      return data as RunResult;
    },
    onSuccess: (data) => {
      setLastRun(data);
      toast.success(`Dry-run: ${data.published} would publish · ${data.skipped} skipped · ${data.failed} failed`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const live = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 10) throw new Error("Reason must be ≥ 10 characters");
      const { data, error } = await supabase.rpc(
        "admin_publish_certification_pillars" as any,
        { p_limit: runLimit, p_dry_run: false, p_reason: reason.trim() },
      );
      if (error) throw error;
      return data as RunResult;
    },
    onSuccess: (data) => {
      setLastRun(data);
      setOpen(false);
      setReason("");
      toast.success(`Live: ${data.published} published · ${data.skipped} skipped · ${data.failed} failed`);
      qc.invalidateQueries({ queryKey: ["e3f-publish-gate"] });
      qc.invalidateQueries({ queryKey: ["e3d-seo-dead-end"] });
      qc.invalidateQueries({ queryKey: ["e3f-pillar-backfill"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = counts.READY_TO_PUBLISH ?? 0;
  const status = q.isLoading ? "loading" : ready === 0 ? "OK" : ready > 50 ? "WARN" : "INFO";
  const badge =
    status === "OK"
      ? { variant: "default" as const, label: "nothing to publish" }
      : status === "WARN"
        ? { variant: "outline" as const, label: `${ready} ready` }
        : { variant: "secondary" as const, label: `${ready} ready` };

  function exportCsv() {
    const rows = q.data ?? [];
    if (rows.length === 0) return;
    const csv = toCsv(rows.map((r) => ({
      pillar_id: r.pillar_id,
      slug: r.slug,
      decision: r.decision,
      catalog_slug: r.catalog_slug ?? "",
      package_title: r.package_title ?? "",
      product_slug: r.product_slug ?? "",
      product_status: r.product_status ?? "",
      product_visibility: r.product_visibility ?? "",
      quality_score: r.quality_score,
      outbound_links: r.outbound_links,
      meta_desc_len: r.meta_desc_len,
      meta_title_len: r.meta_title_len,
      has_package_link: r.has_package_link,
      has_cert_link: r.has_cert_link,
      slug_dup_count: r.slug_dup_count,
    })));
    downloadCsv(`pillar-publish-readiness-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const rows = q.data ?? [];

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Rocket className="h-4 w-4" /> Pillar Publish-Gate (E3f)
          <Badge variant={badge.variant} className="text-[10px]">{badge.label}</Badge>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={decision} onValueChange={setDecision}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue placeholder="Decision" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All decisions</SelectItem>
              {DECISIONS.map((d) => (
                <SelectItem key={d} value={d}>{d.replace(/_/g, " ").toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
            className="h-8 w-20 text-xs"
            aria-label="List limit"
          />
          <Button size="sm" variant="outline" disabled={q.isFetching} onClick={() => q.refetch()}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${q.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={exportCsv}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            CSV
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.isError ? (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {(q.error as Error)?.message ?? "Load failed"}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {[
              ["Ready", counts.READY_TO_PUBLISH ?? 0, "text-warning"],
              ["Already published", counts.ALREADY_PUBLISHED ?? 0, "text-success"],
              ["Quality / meta blocked", (counts.QUALITY_TOO_LOW ?? 0) + (counts.META_DESC_TOO_SHORT ?? 0) + (counts.MISSING_META_TITLE ?? 0), ""],
              ["Link / product issues", (counts.MISSING_PACKAGE_LINK ?? 0) + (counts.MISSING_CERT_LINK ?? 0) + (counts.NO_PUBLISHED_PACKAGE ?? 0) + (counts.PRODUCT_NOT_ACTIVE ?? 0) + (counts.PRODUCT_NOT_PUBLIC ?? 0), "text-destructive"],
            ].map(([label, val, cls]) => (
              <div key={String(label)} className="border rounded-md px-2 py-1.5 text-[11px]">
                <div className="text-text-tertiary">{label as string}</div>
                <div className={`text-lg font-semibold tabular-nums ${cls as string}`}>{val as number}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[11px] text-text-tertiary">Run cap (max 200):</span>
            <Input
              type="number"
              min={1}
              max={200}
              value={runLimit}
              onChange={(e) => setRunLimit(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
              className="h-8 w-20 text-xs"
              aria-label="Run cap"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={dryRun.isPending || ready === 0}
              onClick={() => dryRun.mutate()}
            >
              <FlaskConical className={`h-3.5 w-3.5 mr-1.5 ${dryRun.isPending ? "animate-spin" : ""}`} />
              Dry-run
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="petrol" disabled={ready === 0}>
                  <PlayCircle className="h-3.5 w-3.5 mr-1.5" /> Live publish
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Live Pillar publish</DialogTitle>
                  <DialogDescription>
                    Publiziert bis zu {runLimit} READY_TO_PUBLISH Pillars (setzt is_published=true + published_at).
                    Idempotent + fail-soft. Reason mit ≥ 10 Zeichen ist Pflicht und wird im Audit gespeichert.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="z.B. E3f publish wave 1: 50 pillars to close SEO dead-ends"
                  className="min-h-[80px] text-xs"
                />
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setOpen(false)} disabled={live.isPending}>
                    Cancel
                  </Button>
                  <Button
                    variant="petrol"
                    disabled={live.isPending || reason.trim().length < 10}
                    onClick={() => live.mutate()}
                  >
                    {live.isPending ? "Running…" : `Publish ${Math.min(runLimit, ready)} pillars`}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {lastRun && (
            <div className="mb-3 border rounded-md p-2 bg-surface-sunken text-[11px]">
              <div className="font-medium">
                Last run · {lastRun.dry_run ? "dry-run" : "LIVE"} · attempted {lastRun.attempted} ·
                {" "}published {lastRun.published} · skipped {lastRun.skipped} · failed {lastRun.failed}
              </div>
            </div>
          )}

          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Slug / Catalog</TableHead>
                  <TableHead className="text-[11px]">Decision</TableHead>
                  <TableHead className="text-[11px]">Package</TableHead>
                  <TableHead className="text-[11px]">Q · Meta · Links</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-[11px] text-muted-foreground py-4">
                      Keine Zeilen.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.slice(0, 50).map((r) => (
                    <TableRow key={r.pillar_id}>
                      <TableCell className="text-[11px]">
                        <div className="font-medium truncate max-w-[220px]" title={r.slug}>{r.slug}</div>
                        <div className="text-text-tertiary text-[10px] truncate">{r.catalog_slug ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <Badge
                          variant={r.decision === "READY_TO_PUBLISH" ? "outline" : r.decision === "ALREADY_PUBLISHED" ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {r.decision}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <div className="truncate max-w-[180px]" title={r.package_title ?? ""}>
                          {r.package_title ?? "—"}
                        </div>
                        {r.product_slug && (
                          <div className="text-text-tertiary text-[10px] truncate">
                            /p/{r.product_slug} · {r.product_status ?? "—"}/{r.product_visibility ?? "—"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px] tabular-nums">
                        {r.quality_score} · md {r.meta_desc_len} · out {r.outbound_links}
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
        SSOT: <code>v_pillar_publish_readiness</code> · RPC:{" "}
        <code>admin_publish_certification_pillars</code> (dry-run default, reason ≥ 10 chars für live, cap 200, idempotent, fail-soft).
      </p>
    </Card>
  );
}
