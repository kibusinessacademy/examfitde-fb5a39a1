import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DollarSign, AlertTriangle, Scale, Search } from "lucide-react";

const fmtEur = (c: number) => (Number(c || 0) / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export default function ControllingPage() {
  const [rev, setRev] = useState<any[]>([]);
  const [vat, setVat] = useState<any[]>([]);
  const [refund, setRefund] = useState<any | null>(null);
  const [gaps, setGaps] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const today = new Date();
      const pFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const pTo = today.toISOString().slice(0, 10);
      const month = today.toISOString().slice(0, 7) + "-01";

      const [r1, r2, r3, r4] = await Promise.all([
        supabase.rpc("get_revenue_summary" as any, { p_from: pFrom, p_to: pTo }),
        supabase.rpc("get_monthly_vat_lines" as any, { p_month: month, p_currency: "eur" }),
        supabase.rpc("get_monthly_refund_kpi" as any, { p_month: month, p_currency: "eur" }),
        supabase.rpc("get_reconcile_gaps_details" as any, { p_limit: 20 }),
      ]);

      if (!r1.error) setRev(r1.data ?? []);
      if (!r2.error) setVat(r2.data ?? []);
      if (!r3.error) setRefund((r3.data ?? [])[0] ?? null);
      if (!r4.error) setGaps(r4.data ?? []);
    })();
  }, []);

  const gross30 = rev.reduce((a: number, r: any) => a + Number(r.gross_cents || 0), 0);
  const tax30 = rev.reduce((a: number, r: any) => a + Number(r.tax_cents || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-foreground">Controlling</h2>
        <p className="text-sm text-muted-foreground">Umsatz, Steuer, Refunds, Stripe-Reconcile (SSOT: finance_ledger)</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card border-green-500/20 bg-green-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{fmtEur(gross30)}</div>
                <div className="text-sm text-muted-foreground">Umsatz (30 Tage)</div>
                <div className="text-xs text-muted-foreground">Steueranteil: {fmtEur(tax30)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <div className="text-sm font-semibold">Refund KPI (Monat)</div>
                {refund ? (
                  <div className="text-sm text-muted-foreground">
                    Rate: <span className="font-bold">{(Number(refund.refund_rate || 0) * 100).toFixed(1)}%</span> · 
                    {refund.refunds}/{refund.payments} Txn
                  </div>
                ) : <div className="text-muted-foreground">—</div>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Scale className="h-5 w-5 text-primary" />
              <div>
                <div className="text-sm font-semibold">VAT (Monat)</div>
                <div className="space-y-0.5 text-sm text-muted-foreground">
                  {vat.slice(0, 3).map((v: any, i: number) => (
                    <div key={i} className="flex justify-between gap-4">
                      <span>{v.tax_country} {Number(v.tax_rate) * 100}%</span>
                      <span>{fmtEur(Number(v.tax_cents || 0))}</span>
                    </div>
                  ))}
                  {vat.length === 0 && <div>—</div>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Reconcile Gaps
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>PI</TableHead>
                <TableHead className="text-right">Betrag</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gaps.map((g: any) => (
                <TableRow key={g.order_id}>
                  <TableCell className="font-mono text-xs">{String(g.order_id).slice(0, 8)}…</TableCell>
                  <TableCell className="text-sm">{new Date(g.created_at).toLocaleDateString("de-DE")}</TableCell>
                  <TableCell className="font-mono text-xs">{g.stripe_payment_intent_id ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmtEur(Number(g.total_cents || 0))}</TableCell>
                  <TableCell>
                    <Badge variant={g.has_order_created ? "outline" : "destructive"}>
                      {g.has_order_created ? "order ✓" : "missing"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {gaps.length === 0 && (
                <TableRow><TableCell className="text-center text-muted-foreground py-8" colSpan={5}>Keine Gaps ✅</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
