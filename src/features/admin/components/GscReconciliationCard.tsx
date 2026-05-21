/**
 * P6 Cut 5 — GSC Reconciliation & Validation Cockpit Card.
 *
 * Reads `admin_get_gsc_reconciliation_summary` + `admin_get_gsc_reconciliation_detail`
 * and lets admins mark URLs for GSC re-validation
 * (`admin_mark_gsc_url_for_validation`). Includes CSV export of the
 * currently filtered drilldown. No direct table reads — RPC only.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Download, RefreshCw, Search, CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toCsv, downloadCsv } from "@/lib/csv";

type Decision =
  | "valid"
  | "expected_noindex"
  | "expected_redirect"
  | "gone_expected"
  | "needs_fix"
  | "unclassified_needs_fix";

const DECISION_ORDER: Decision[] = [
  "needs_fix",
  "unclassified_needs_fix",
  "expected_redirect",
  "expected_noindex",
  "gone_expected",
  "valid",
];

const DECISION_TONE: Record<
  Decision,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  needs_fix: { label: "NEEDS FIX", variant: "destructive" },
  unclassified_needs_fix: { label: "UNCLASSIFIED", variant: "destructive" },
  expected_redirect: { label: "REDIRECT OK", variant: "secondary" },
  expected_noindex: { label: "NOINDEX OK", variant: "secondary" },
  gone_expected: { label: "GONE OK", variant: "outline" },
  valid: { label: "VALID", variant: "default" },
};

interface SummaryRow {
  decision: Decision;
  total: number;
  pending_validation: number;
  requested: number;
}

interface DetailRow {
  id: string;
  url: string;
  path: string;
  gsc_status: string;
  coverage_state: string | null;
  last_crawled_at: string | null;
  source_report: string;
  validation_status: "pending" | "requested" | "validated" | "still_failing";
  validation_requested_at: string | null;
  imported_at: string;
  decision: Decision;
  matched_pattern: string | null;
  matched_state: "index" | "noindex" | "redirect" | "gone" | null;
  redirect_to: string | null;
}

export function GscReconciliationCard() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Decision | "all">("needs_fix");
  const [marking, setMarking] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ["gsc-recon-summary"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "admin_get_gsc_reconciliation_summary",
      );
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
    staleTime: 30_000,
  });

  const detail = useQuery({
    queryKey: ["gsc-recon-detail", filter],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "admin_get_gsc_reconciliation_detail",
        {
          _decision: filter === "all" ? null : filter,
          _limit: 200,
          _offset: 0,
        },
      );
      if (error) throw error;
      return (data ?? []) as DetailRow[];
    },
    staleTime: 30_000,
  });

  const summaryByDecision = useMemo(() => {
    const map = new Map<Decision, SummaryRow>();
    (summary.data ?? []).forEach((r) => map.set(r.decision, r));
    return map;
  }, [summary.data]);

  const totalProblems = useMemo(
    () => (summary.data ?? []).reduce((s, r) => s + r.total, 0),
    [summary.data],
  );

  async function markForValidation(url: string) {
    setMarking(url);
    try {
      const { error } = await (supabase.rpc as any)(
        "admin_mark_gsc_url_for_validation",
        { _url: url },
      );
      if (error) throw error;
      toast.success("Für GSC-Validierung markiert");
      qc.invalidateQueries({ queryKey: ["gsc-recon-summary"] });
      qc.invalidateQueries({ queryKey: ["gsc-recon-detail"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Markieren fehlgeschlagen: ${msg}`);
    } finally {
      setMarking(null);
    }
  }

  function exportCsv() {
    const rows = (detail.data ?? []).map((r) => ({
      url: r.url,
      path: r.path,
      decision: r.decision,
      gsc_status: r.gsc_status,
      coverage_state: r.coverage_state ?? "",
      matched_pattern: r.matched_pattern ?? "",
      matched_state: r.matched_state ?? "",
      redirect_to: r.redirect_to ?? "",
      validation_status: r.validation_status,
      last_crawled_at: r.last_crawled_at ?? "",
      imported_at: r.imported_at,
    }));
    if (!rows.length) {
      toast.info("Keine Zeilen zum Export.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadCsv(`gsc-reconciliation-${filter}-${stamp}.csv`, toCsv(rows));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Search className="h-4 w-4" /> GSC Reconciliation & Validation
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              P6 Cut 5 — klassifiziert Google-Search-Console-Funde gegen
              <span className="font-mono"> route_crawl_policy</span>.
              {totalProblems > 0 && (
                <> Total problem URLs: <span className="font-medium">{totalProblems}</span>.</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["gsc-recon-summary"] });
                qc.invalidateQueries({ queryKey: ["gsc-recon-detail"] });
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {DECISION_ORDER.map((d) => {
            const row = summaryByDecision.get(d);
            const tone = DECISION_TONE[d];
            const active = filter === d;
            return (
              <button
                key={d}
                onClick={() => setFilter(active ? "all" : d)}
                className={`text-left rounded-lg border p-3 transition-colors ${
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <Badge variant={tone.variant} className="text-[10px]">
                    {tone.label}
                  </Badge>
                </div>
                <div className="mt-2 text-2xl font-semibold">
                  {row?.total ?? 0}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  pending {row?.pending_validation ?? 0} · requested{" "}
                  {row?.requested ?? 0}
                </div>
              </button>
            );
          })}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filter:</span>
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as Decision | "all")}
          >
            <SelectTrigger className="w-[260px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Decisions</SelectItem>
              {DECISION_ORDER.map((d) => (
                <SelectItem key={d} value={d}>
                  {DECISION_TONE[d].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {detail.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Drilldown table */}
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[34%]">URL / Path</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>GSC</TableHead>
                <TableHead>Matched Policy</TableHead>
                <TableHead>Validation</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">
                    Lade…
                  </TableCell>
                </TableRow>
              ) : (detail.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">
                    Keine Einträge. Tipp: erst <span className="font-mono">admin_ingest_gsc_problem_urls</span> aufrufen.
                  </TableCell>
                </TableRow>
              ) : (
                (detail.data ?? []).map((r) => {
                  const tone = DECISION_TONE[r.decision];
                  const canMark =
                    r.decision === "needs_fix" ||
                    r.decision === "unclassified_needs_fix" ||
                    r.decision === "expected_redirect";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-[11px] align-top">
                        <div className="truncate max-w-[420px]" title={r.url}>
                          {r.path || r.url}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[420px]">
                          {r.url}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={tone.variant} className="text-[10px]">
                          {tone.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <div>{r.gsc_status}</div>
                        {r.coverage_state && (
                          <div className="text-[10px] text-muted-foreground">
                            {r.coverage_state}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {r.matched_pattern ? (
                          <>
                            <span className="font-mono">{r.matched_pattern}</span>
                            <div className="text-[10px] text-muted-foreground">
                              state: {r.matched_state}
                              {r.redirect_to && <> → {r.redirect_to}</>}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">— kein Match —</span>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <Badge
                          variant={
                            r.validation_status === "validated"
                              ? "default"
                              : r.validation_status === "still_failing"
                                ? "destructive"
                                : r.validation_status === "requested"
                                  ? "secondary"
                                  : "outline"
                          }
                          className="text-[10px]"
                        >
                          {r.validation_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !canMark ||
                            marking === r.url ||
                            r.validation_status === "requested" ||
                            r.validation_status === "validated"
                          }
                          onClick={() => markForValidation(r.url)}
                        >
                          {marking === r.url ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                              Fehlerbehebung prüfen
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
