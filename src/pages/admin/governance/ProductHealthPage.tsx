import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Download, RefreshCw, AlertTriangle, Package, ShoppingCart, GitMerge } from "lucide-react";

type Severity = "critical" | "high" | "medium" | "low";

interface ActionItem {
  code: string; severity: Severity; target: string; metric: number;
  detail: string; recommendation: string;
}
interface DriftRow {
  package_id: string; product_id: string | null;
  classification: string; signals: string[];
}
interface Projection {
  generated_at: string;
  projector_version: string;
  totals: {
    packages_total: number; sellable_and_deliverable: number;
    public_but_undeliverable: number; private_but_priced: number;
    no_price: number; missing_stripe_price_id: number;
    duplicate_products: number; stripe_manual_review: number;
    course_not_published: number; lessons_gap_unknown: number;
    sellable_rate: number; public_conversion_rate: number;
  };
  action_queue: ActionItem[];
  drift_top: DriftRow[];
  duplicate_clusters: { certification_id: string | null; canonical: string | null; duplicates: string[] }[];
  teaser_quality_alerts: { category: string | null; entries: number | null; pct_real_usp: number | null }[];
  block_reason_breakdown: { reason: string; count: number }[];
}

const SEV_VARIANT: Record<Severity, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive", high: "default", medium: "secondary", low: "outline",
};
const ACTION_LABEL: Record<string, string> = {
  PUBLIC_BUT_UNDELIVERABLE: "Öffentlich aber unlieferbar",
  DUPLICATE_PRODUCT: "Duplicate Product",
  STRIPE_PRICE_MISSING: "Stripe-Preis fehlt",
  STRIPE_MANUAL_REVIEW: "Stripe Manual Review",
  PRIVATE_BUT_PRICED: "Privat aber bepreist",
  NO_PRICE: "Kein Preis",
  COURSE_NOT_PUBLISHED: "Kurs unveröffentlicht",
  LESSONS_GAP_UNKNOWN: "Lessons-Gap unbekannt",
  TEASER_FALLBACK_HEAVY: "Teaser Fallback-Heavy",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

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
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function ProductHealthPage() {
  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["product-health"],
    queryFn: async (): Promise<Projection> => {
      const { data, error } = await supabase.functions.invoke("evaluate-product-health", { body: {} });
      if (error) throw error;
      if (!data?.projection) throw new Error("Keine Projektion erhalten");
      return data.projection as Projection;
    },
    refetchInterval: 90_000,
  });

  const t = data?.totals;
  const queueRows = useMemo(
    () => (data?.action_queue ?? []).map((q) => ({
      action: ACTION_LABEL[q.code] ?? q.code,
      severity: q.severity,
      target: q.target,
      metric: q.metric,
      detail: q.detail,
      recommendation: q.recommendation,
    })),
    [data],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Package className="h-6 w-6" /> Product Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Deterministischer Operator-Layer über Pricing/Sellable/Catalog SSOT. Read-only.
            {data && (
              <span className="ml-2">
                Stand: {new Date(data.generated_at).toLocaleTimeString("de-DE")} ·
                v{data.projector_version}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetch(); toast.success("Re-evaluiere…"); }}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Aktualisieren
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => csvDownload(queueRows, `product-action-queue-${Date.now()}.csv`)}
          >
            <Download className="h-4 w-4 mr-1" /> Action-Queue CSV
          </Button>
        </div>
      </div>

      {/* KPI Grid */}
      {t && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="Pakete gesamt" value={t.packages_total} />
          <Kpi label="Sellable & deliverable" value={t.sellable_and_deliverable} sub={pct(t.sellable_rate)} />
          <Kpi
            label="Öffentlich, aber unlieferbar"
            value={t.public_but_undeliverable}
            danger={t.public_but_undeliverable > 0}
          />
          <Kpi label="Duplicate Products" value={t.duplicate_products} warn={t.duplicate_products > 0} />
          <Kpi label="Privat, aber bepreist" value={t.private_but_priced} warn={t.private_but_priced > 0} />
          <Kpi label="Kein Stripe-Preis" value={t.no_price} warn={t.no_price > 0} />
          <Kpi label="Stripe-Price-ID fehlt" value={t.missing_stripe_price_id} warn={t.missing_stripe_price_id > 0} />
          <Kpi label="Kurs nicht published" value={t.course_not_published} />
        </div>
      )}

      {/* Action Queue */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> Action Queue
            <Badge variant="outline">{queueRows.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">#</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Empfehlung</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queueRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Keine offenen Aktionen — Product-Layer ist sauber.
                  </TableCell>
                </TableRow>
              )}
              {queueRows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.action}</TableCell>
                  <TableCell>
                    <Badge variant={SEV_VARIANT[r.severity]}>{r.severity}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.target}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.metric}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-md">{r.detail}</TableCell>
                  <TableCell className="text-sm">{r.recommendation}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Drift Top */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" /> Drift Top-50 (Sellable vs Public vs Priced)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Klassifikation</TableHead>
                <TableHead>Signale</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.drift_top ?? []).map((d) => (
                <TableRow key={d.package_id}>
                  <TableCell className="font-mono text-xs">{d.package_id}</TableCell>
                  <TableCell className="font-mono text-xs">{d.product_id ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={d.classification === "PUBLIC_BUT_UNDELIVERABLE" ? "destructive" : "secondary"}>
                      {d.classification}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.signals.join(", ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Duplicate Clusters & Block Reasons */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5" /> Duplicate Cluster
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zertifikat</TableHead>
                  <TableHead>Canonical</TableHead>
                  <TableHead>Duplikate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.duplicate_clusters ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">Keine Duplikate</TableCell></TableRow>
                )}
                {(data?.duplicate_clusters ?? []).map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{c.certification_id}</TableCell>
                    <TableCell className="font-mono text-xs">{c.canonical}</TableCell>
                    <TableCell className="font-mono text-xs">{c.duplicates.join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Catalog-Blocker by Reason</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.block_reason_breakdown ?? []).map((b) => (
                  <TableRow key={b.reason}>
                    <TableCell>{b.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {data?.teaser_quality_alerts && data.teaser_quality_alerts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Teaser-Quality Alerts</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategorie</TableHead>
                  <TableHead className="text-right">Einträge</TableHead>
                  <TableHead className="text-right">% echte USP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.teaser_quality_alerts.map((t, i) => (
                  <TableRow key={i}>
                    <TableCell>{t.category}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.entries}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.pct_real_usp ?? 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data && (
        <p className="text-xs text-muted-foreground text-right">
          Letzte Aktualisierung: {new Date(dataUpdatedAt).toLocaleString("de-DE")}
        </p>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, warn, danger }: { label: string; value: number | string; sub?: string; warn?: boolean; danger?: boolean }) {
  return (
    <Card className={danger ? "border-destructive" : warn ? "border-amber-500" : ""}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums ${danger ? "text-destructive" : ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
