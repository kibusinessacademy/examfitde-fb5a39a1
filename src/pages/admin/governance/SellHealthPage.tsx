import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Download, RefreshCw, ShoppingCart, AlertTriangle, TrendingUp, Activity, Wand2, HeartPulse } from "lucide-react";
import type { Projection, ActionItem, Severity } from "@/lib/sellHealth";

const SEV_VARIANT: Record<Severity, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};

const ACTION_LABEL: Record<string, string> = {
  PAID_NOT_FULFILLABLE: "Bezahlt — kein Grant",
  READY_BUT_UNPUBLISHED: "Ready, aber unveröffentlicht",
  PACKAGE_BLOCKED: "Paket blockiert",
  PRICING_VIEW_DROUGHT: "Pricing-Views fehlen",
  FUNNEL_CONTINUITY_BROKEN: "Funnel-Continuity gebrochen",
  TRACKING_GAP: "Tracking-Lücke",
  VARIANT_ATTRIBUTION_DRIFT: "Variant-Attribution-Drift",
  COLD_EXPERIMENT: "Kaltes Experiment",
  LOSING_VARIANT_LIVE: "Verlierende Variante live",
  CTA_HIGH_TRAFFIC_LOW_CONV: "CTA: viel Traffic, kein Checkout",
  CHECKOUT_PARITY_DRIFT: "Checkout-Parity-Drift",
  REVENUE_DROUGHT_24H: "Revenue-Stille (24h)",
};

const fmtEur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
const fmtPct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;

function csvDownload(rows: any[], filename: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function SellHealthPage() {
  const qc = useQueryClient();
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["sell-health"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("evaluate-sell-health", { body: {} });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.detail ?? "projector_failed");
      return data.projection as Projection;
    },
    refetchInterval: 60_000,
  });

  const act = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("sell-health-act", { body: payload });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.detail ?? data?.error ?? "act_failed");
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["sell-health"] });
    },
    onSettled: () => setPendingTarget(null),
  });

  const regrant = (orderId: string) => {
    setPendingTarget(orderId);
    act.mutate(
      { action: "regrant_paid_order", order_id: orderId },
      {
        onSuccess: (res) => {
          if (res.healed) toast.success(`Order ${orderId.slice(0, 8)} re-granted`);
          else toast.warning(`Re-grant ausgeführt, Order weiterhin nicht erfüllbar`);
        },
        onError: (e: Error) => toast.error(`Re-grant fehlgeschlagen: ${e.message}`),
      },
    );
  };

  const bulkPublish = (cap = 18) => {
    if (!confirm(`Bis zu ${cap} delivery-ready Pakete jetzt veröffentlichen (Standardpreis 24,90 € / 24 Monate)?`)) return;
    setPendingTarget("bulk_publish");
    act.mutate(
      { action: "bulk_publish_done", cap },
      {
        onSuccess: (res) => toast.success(`Bulk-Publish ausgeführt: ${JSON.stringify(res.result).slice(0, 200)}`),
        onError: (e: Error) => toast.error(`Bulk-Publish fehlgeschlagen: ${e.message}`),
      },
    );
  };

  const queue = useMemo<ActionItem[]>(() => data?.action_queue ?? [], [data]);
  const totals = data?.totals;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6" /> Selling Operator Cockpit
          </h1>
          <p className="text-sm text-muted-foreground">
            SELL.HEALTH.OS.1 · Read-only Projektion · Version {data?.projector_version ?? "—"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!queue.length}
            onClick={() => {
              csvDownload(queue, `sell-health-actions-${new Date().toISOString()}.csv`);
              toast.success(`${queue.length} Aktionen exportiert`);
            }}
          >
            <Download className="h-4 w-4 mr-2" /> Queue CSV
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">
            Projektor-Fehler: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></CardContent></Card>
      )}

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Revenue 7d" value={fmtEur(totals.revenue_7d_eur)} sub={`${fmtEur(totals.revenue_today_eur)} heute`} />
          <KpiCard
            label="Bezahlt ohne Grant"
            value={String(totals.orders_paid_not_fulfillable)}
            sub={`${fmtPct(totals.orders_paid_not_fulfillable_pct)} der bezahlten`}
            tone={totals.orders_paid_not_fulfillable > 0 ? "destructive" : undefined}
          />
          <KpiCard
            label="Ready, unveröffentlicht"
            value={String(totals.packages_ready_unpublished)}
            sub={`Potential ${fmtEur(totals.sellable_revenue_potential_eur)}`}
            tone={totals.packages_ready_unpublished > 0 ? "warning" : undefined}
          />
          <KpiCard
            label="Checkout-Completion 24h"
            value={fmtPct(totals.checkout_completion_rate)}
            sub={`${totals.checkout_complete_24h}/${totals.checkout_started_24h}`}
          />
          <KpiCard label="Pricing-Views 24h" value={String(totals.pricing_view_24h)} />
          <KpiCard label="Funnel-Continuity" value={totals.funnel_continuity_status} tone={totals.funnel_continuity_status !== "ok" ? "warning" : undefined} />
          <KpiCard label="Tracking-Completeness" value={`${totals.tracking_completeness_pct.toFixed(1)}%`} tone={totals.tracking_completeness_pct < 85 ? "warning" : undefined} />
          <KpiCard label="Variant-Coverage" value={`${totals.variant_coverage_pct.toFixed(1)}%`} tone={totals.variant_coverage_pct < 90 ? "warning" : undefined} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Action Queue ({queue.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {!queue.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Keine offenen Selling-Risiken.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Ziel</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>Empfehlung</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((q, i) => (
                  <TableRow key={`${q.code}-${q.target}-${i}`}>
                    <TableCell><Badge variant={SEV_VARIANT[q.severity]}>{q.severity}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{ACTION_LABEL[q.code] ?? q.code}</TableCell>
                    <TableCell className="font-mono text-xs">{q.target}</TableCell>
                    <TableCell className="text-sm">{q.detail}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{q.recommendation}</TableCell>
                    <TableCell className="text-right font-mono">{q.score}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data?.funnel_steps?.length ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Funnel 7d</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Step</TableHead><TableHead className="text-right">Count</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.funnel_steps.map((s) => (
                  <TableRow key={s.step}>
                    <TableCell className="font-mono text-xs">{s.step}</TableCell>
                    <TableCell className="text-right">{s.count.toLocaleString("de-DE")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {data?.unfulfilled_orders?.length ? (
        <Card>
          <CardHeader><CardTitle className="text-destructive">Bezahlt ohne Grant ({data.unfulfilled_orders.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Bezahlt</TableHead><TableHead className="text-right">Betrag</TableHead><TableHead>Items</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.unfulfilled_orders.map((o) => (
                  <TableRow key={o.order_id}>
                    <TableCell className="font-mono text-xs">{o.order_id.slice(0, 12)}</TableCell>
                    <TableCell className="text-xs">{o.paid_at?.slice(0, 19) ?? "—"}</TableCell>
                    <TableCell className="text-right">{fmtEur((o.total_cents ?? 0) / 100)}</TableCell>
                    <TableCell className="text-xs">{o.fulfillable_item_count ?? 0}/{o.item_count ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {data?.top_cta_underperformers?.length ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> CTA Underperformer</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Page</TableHead><TableHead>CTA</TableHead><TableHead>Variant</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">Checkout%</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.top_cta_underperformers.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{c.page_path}</TableCell>
                    <TableCell className="text-xs">{c.cta_location}</TableCell>
                    <TableCell className="text-xs">{c.variant ?? "—"}</TableCell>
                    <TableCell className="text-right">{c.clicks ?? 0}</TableCell>
                    <TableCell className="text-right">{(c.checkout_rate_pct ?? 0).toFixed(2)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function KpiCard({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: "destructive" | "warning" }) {
  const cls =
    tone === "destructive" ? "border-destructive" :
    tone === "warning" ? "border-yellow-500/60" : "";
  return (
    <Card className={cls}>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
