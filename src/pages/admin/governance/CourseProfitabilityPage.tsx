import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Play, TrendingUp, AlertTriangle, Snowflake, Sparkles } from "lucide-react";

const fmtEur = (cents: number | null | undefined) =>
  cents == null ? "—" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);

const CLASS_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  winner: { label: "Winner", variant: "default", icon: TrendingUp },
  building: { label: "Building", variant: "secondary", icon: Sparkles },
  long_tail: { label: "Long Tail", variant: "outline", icon: Snowflake },
  loser: { label: "Loser", variant: "destructive", icon: AlertTriangle },
  insufficient_data: { label: "Zu wenig Daten", variant: "outline", icon: AlertTriangle },
};

const REC_LABEL: Record<string, string> = {
  SCALE: "Skalieren",
  BUNDLE_CANDIDATE: "Bundle-Kandidat",
  PRICE_EXPERIMENT: "Preis-Test",
  FREEZE_PRODUCTION: "Produktion einfrieren",
  REVIVE: "Wiederbeleben",
  HOLD: "Halten",
  INVESTIGATE_REFUNDS: "Refunds prüfen",
};

export default function CourseProfitabilityPage() {
  const qc = useQueryClient();
  const [windowDays, setWindowDays] = useState(90);
  const [filterClass, setFilterClass] = useState<string>("all");

  const { data: snapshots, isLoading } = useQuery({
    queryKey: ["course-profit-snapshots", filterClass],
    queryFn: async () => {
      let q = supabase
        .from("course_profitability_snapshots")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (filterClass !== "all") q = q.eq("class", filterClass);
      const { data, error } = await q;
      if (error) throw error;
      // Dedupe per product_id: latest only
      const latest = new Map<string, any>();
      for (const row of data ?? []) {
        if (!latest.has(row.product_id)) latest.set(row.product_id, row);
      }
      return Array.from(latest.values());
    },
  });

  const runEval = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("evaluate-course-profitability", {
        body: { window_days: windowDays, limit: 300 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(`Auswertung: ${data.evaluated} Produkte · ${data.inserted} neu · ${data.skipped_idempotent} unverändert`);
      qc.invalidateQueries({ queryKey: ["course-profit-snapshots"] });
    },
    onError: (e: any) => toast.error(`Fehler: ${e.message}`),
  });

  const totals = snapshots?.reduce(
    (acc, s) => {
      acc.gross += s.gross_revenue_cents;
      acc.net += s.net_revenue_cents;
      acc.cost += s.total_cost_cents;
      acc.margin += s.margin_cents;
      acc.units += s.units_sold;
      return acc;
    },
    { gross: 0, net: 0, cost: 0, margin: 0, units: 0 },
  ) ?? { gross: 0, net: 0, cost: 0, margin: 0, units: 0 };

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Course Profitability Cockpit</h1>
        <p className="text-muted-foreground">
          Unit-Economics pro Kurspaket. Deterministisch, append-only. Empfehlungen sind read-only —
          Operator entscheidet, System macht keine Mutationen.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Pakete</div><div className="text-2xl font-bold">{snapshots?.length ?? 0}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Einheiten (90d)</div><div className="text-2xl font-bold">{totals.units}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Brutto-Umsatz</div><div className="text-2xl font-bold">{fmtEur(totals.gross)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Gesamtkosten</div><div className="text-2xl font-bold">{fmtEur(totals.cost)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Marge</div><div className={`text-2xl font-bold ${totals.margin >= 0 ? "text-green-600" : "text-destructive"}`}>{fmtEur(totals.margin)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Auswertung starten</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Zeitfenster (Tage)</label>
            <Input type="number" min={7} max={365} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="w-32" />
          </div>
          <Button onClick={() => runEval.mutate()} disabled={runEval.isPending}>
            {runEval.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Profitabilität auswerten
          </Button>
          <div className="ml-auto flex gap-2">
            {(["all", "winner", "building", "long_tail", "loser", "insufficient_data"] as const).map((c) => (
              <Button key={c} variant={filterClass === c ? "default" : "outline"} size="sm" onClick={() => setFilterClass(c)}>
                {c === "all" ? "Alle" : CLASS_META[c]?.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pakete nach Profitabilität</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lade …</div>
          ) : !snapshots?.length ? (
            <div className="text-muted-foreground text-sm">
              Noch keine Snapshots. Klick auf „Profitabilität auswerten" um den ersten Lauf zu starten.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paket</TableHead>
                    <TableHead>Klasse</TableHead>
                    <TableHead className="text-right">Einheiten</TableHead>
                    <TableHead className="text-right">Netto</TableHead>
                    <TableHead className="text-right">Kosten</TableHead>
                    <TableHead className="text-right">Marge</TableHead>
                    <TableHead className="text-right">Payback</TableHead>
                    <TableHead>Empfehlung</TableHead>
                    <TableHead className="text-right">Conf.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots
                    .sort((a, b) => b.margin_cents - a.margin_cents)
                    .map((s) => {
                      const meta = CLASS_META[s.class] ?? CLASS_META.insufficient_data;
                      const Icon = meta.icon;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="max-w-xs">
                            <div className="font-medium truncate">{s.product_title ?? s.product_id.slice(0, 8)}</div>
                            <div className="text-xs text-muted-foreground truncate">{s.product_slug}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={meta.variant} className="gap-1">
                              <Icon className="h-3 w-3" />
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{s.units_sold}</TableCell>
                          <TableCell className="text-right">{fmtEur(s.net_revenue_cents)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{fmtEur(s.total_cost_cents)}</TableCell>
                          <TableCell className={`text-right font-medium ${s.margin_cents >= 0 ? "text-green-600" : "text-destructive"}`}>
                            {fmtEur(s.margin_cents)}
                          </TableCell>
                          <TableCell className="text-right">{s.payback_units ?? "—"}</TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">{REC_LABEL[s.recommendation_code] ?? s.recommendation_code}</div>
                            <div className="text-xs text-muted-foreground line-clamp-2">{s.recommendation_reason}</div>
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">{(s.confidence * 100).toFixed(0)}%</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
