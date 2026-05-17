/**
 * PillarGenerationBackfillCard — E3f
 * SSOT: v_pillar_generation_backfill_candidates via admin_get_pillar_backfill_candidates.
 * Live-Backfill nur per admin_backfill_certification_pillars (Reason ≥ 10 chars).
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
import { Layers, RefreshCw, Download, AlertTriangle, PlayCircle, FlaskConical } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "sonner";

const DECISIONS = [
  "READY_TO_GENERATE",
  "PILLAR_ALREADY_EXISTS",
  "NO_CATALOG_MAPPING",
  "AMBIGUOUS_MAPPING",
  "PACKAGE_NOT_PUBLISHED",
  "PRODUCT_NOT_PUBLIC",
  "SKIP_NOT_SELLABLE",
];

type Row = {
  package_id: string;
  package_title: string;
  decision: string;
  catalog_id: string | null;
  catalog_slug: string | null;
  catalog_title: string | null;
  existing_pillar_id: string | null;
  product_slug: string | null;
  product_status: string | null;
  product_visibility: string | null;
  catalog_match_count: number;
};

type RunResult = {
  ok: boolean;
  dry_run: boolean;
  attempted: number;
  created: number;
  skipped: number;
  failed: number;
  results: Array<{ package_id: string; status: string; pillar_slug?: string; error?: string; reason?: string }>;
};

export function PillarGenerationBackfillCard() {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<string>("READY_TO_GENERATE");
  const [limit, setLimit] = useState(200);
  const [runLimit, setRunLimit] = useState(25);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);

  const q = useQuery({
    queryKey: ["e3f-pillar-backfill", decision, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_pillar_backfill_candidates" as any,
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
        "admin_backfill_certification_pillars" as any,
        { p_limit: runLimit, p_dry_run: true, p_reason: null },
      );
      if (error) throw error;
      return data as RunResult;
    },
    onSuccess: (data) => {
      setLastRun(data);
      toast.success(`Dry-run: ${data.created} would be created, ${data.skipped} skipped, ${data.failed} failed`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const live = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 10) throw new Error("Reason must be ≥ 10 characters");
      const { data, error } = await supabase.rpc(
        "admin_backfill_certification_pillars" as any,
        { p_limit: runLimit, p_dry_run: false, p_reason: reason.trim() },
      );
      if (error) throw error;
      return data as RunResult;
    },
    onSuccess: (data) => {
      setLastRun(data);
      setOpen(false);
      setReason("");
      toast.success(`Live: ${data.created} created · ${data.skipped} skipped · ${data.failed} failed`);
      qc.invalidateQueries({ queryKey: ["e3f-pillar-backfill"] });
      qc.invalidateQueries({ queryKey: ["e3d-seo-dead-end"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = counts.READY_TO_GENERATE ?? 0;
  const status = q.isLoading ? "loading" : ready === 0 ? "OK" : ready > 50 ? "CRIT" : "WARN";
  const badge =
    status === "OK"
      ? { variant: "default" as const, label: "no backfill needed" }
      : status === "CRIT"
        ? { variant: "destructive" as const, label: `${ready} ready` }
        : { variant: "outline" as const, label: `${ready} ready` };

  function exportCsv() {
    const rows = q.data ?? [];
    if (rows.length === 0) return;
    const csv = toCsv(rows.map((r) => ({
      package_id: r.package_id,
      package_title: r.package_title,
      decision: r.decision,
      catalog_id: r.catalog_id ?? "",
      catalog_slug: r.catalog_slug ?? "",
      catalog_title: r.catalog_title ?? "",
      existing_pillar_id: r.existing_pillar_id ?? "",
      product_slug: r.product_slug ?? "",
      product_status: r.product_status ?? "",
      product_visibility: r.product_visibility ?? "",
      catalog_match_count: r.catalog_match_count,
    })));
    downloadCsv(`pillar-backfill-candidates-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const rows = q.data ?? [];

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Layers className="h-4 w-4" /> Pillar Generation Backfill (E3f)
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
              ["Ready", counts.READY_TO_GENERATE ?? 0, "text-warning"],
              ["Already exists", counts.PILLAR_ALREADY_EXISTS ?? 0, "text-success"],
              ["No mapping", counts.NO_CATALOG_MAPPING ?? 0, "text-destructive"],
              ["Skipped (not sellable / not public)", (counts.SKIP_NOT_SELLABLE ?? 0) + (counts.PRODUCT_NOT_PUBLIC ?? 0), ""],
            ].map(([label, val, cls]) => (
              <div key={String(label)} className="border rounded-md px-2 py-1.5 text-[11px]">
                <div className="text-text-tertiary">{label as string}</div>
                <div className={`text-lg font-semibold tabular-nums ${cls as string}`}>{val as number}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[11px] text-text-tertiary">Run cap (max 100):</span>
            <Input
              type="number"
              min={1}
              max={100}
              value={runLimit}
              onChange={(e) => setRunLimit(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
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
                  <PlayCircle className="h-3.5 w-3.5 mr-1.5" /> Live backfill
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Live Pillar backfill</DialogTitle>
                  <DialogDescription>
                    Erzeugt bis zu {runLimit} Pillar-Pages (draft) für READY_TO_GENERATE. Idempotent + fail-soft.
                    Reason mit ≥ 10 Zeichen ist Pflicht und wird im Audit gespeichert.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="z.B. E3f wave 1: backfill 25 mapped catalogs to close SEO dead-ends"
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
                    {live.isPending ? "Running…" : `Backfill ${Math.min(runLimit, ready)} pillars`}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {lastRun && (
            <div className="mb-3 border rounded-md p-2 bg-surface-sunken text-[11px]">
              <div className="font-medium mb-1">
                Last run · {lastRun.dry_run ? "dry-run" : "LIVE"} ·
                {" "}attempted {lastRun.attempted} ·
                {" "}created {lastRun.created} ·
                {" "}skipped {lastRun.skipped} ·
                {" "}failed {lastRun.failed}
              </div>
              {lastRun.results.slice(0, 5).map((r, i) => (
                <div key={i} className="text-text-tertiary truncate">
                  {r.status} · {r.pillar_slug ?? r.reason ?? r.error ?? "—"}
                </div>
              ))}
              {lastRun.results.length > 5 && (
                <div className="text-text-tertiary">… +{lastRun.results.length - 5} more</div>
              )}
            </div>
          )}

          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Package</TableHead>
                  <TableHead className="text-[11px]">Decision</TableHead>
                  <TableHead className="text-[11px]">Catalog</TableHead>
                  <TableHead className="text-[11px]">Product</TableHead>
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
                    <TableRow key={r.package_id}>
                      <TableCell className="text-[11px]">
                        <div className="font-medium truncate max-w-[220px]" title={r.package_title}>
                          {r.package_title}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <Badge
                          variant={r.decision === "READY_TO_GENERATE" ? "outline" : "secondary"}
                          className="text-[10px]"
                        >
                          {r.decision}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <div className="truncate max-w-[200px]" title={r.catalog_title ?? ""}>
                          {r.catalog_title ?? "—"}
                        </div>
                        {r.catalog_slug && (
                          <div className="text-text-tertiary text-[10px] truncate">{r.catalog_slug}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {r.product_slug ? (
                          <>
                            <div className="truncate">/p/{r.product_slug}</div>
                            <div className="text-text-tertiary text-[10px]">
                              {r.product_status ?? "—"} · {r.product_visibility ?? "—"}
                            </div>
                          </>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
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
        SSOT: <code>v_pillar_generation_backfill_candidates</code> · RPC:{" "}
        <code>admin_backfill_certification_pillars</code> (dry-run default, reason ≥ 10 chars für live, cap 100, idempotent, fail-soft).
      </p>
    </Card>
  );
}
