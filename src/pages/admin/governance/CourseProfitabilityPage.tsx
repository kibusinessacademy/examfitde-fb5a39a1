import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Play, TrendingUp, AlertTriangle, Snowflake, Sparkles, Download, Clock, Flame } from "lucide-react";

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

// Priority for the Top Action Queue: higher value = more urgent.
const RECOMMENDATION_PRIORITY: Record<string, number> = {
  INVESTIGATE_REFUNDS: 100,
  SCALE: 80,
  FREEZE_PRODUCTION: 70,
  PRICE_EXPERIMENT: 50,
  BUNDLE_CANDIDATE: 40,
  REVIVE: 30,
  HOLD: 10,
};

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: any[]) {
  if (!rows.length) return;
  const cols = [
    "product_id", "product_slug", "product_title", "class", "recommendation_code",
    "units_sold", "gross_revenue_cents", "net_revenue_cents", "total_cost_cents",
    "margin_cents", "margin_ratio", "payback_units", "confidence",
    "window_days", "evaluator_version", "created_at",
  ];
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c])).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `course-profitability-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function CourseProfitabilityPage() {
  const qc = useQueryClient();
  const [windowDays, setWindowDays] = useState(90);
  const [filterClass, setFilterClass] = useState<string>("all");

  const { data: snapshots, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["course-profit-latest", filterClass],
    queryFn: async () => {
      let q = supabase
        .from("v_course_profitability_latest")
        .select("*")
        .order("margin_cents", { ascending: false })
        .limit(500);
      if (filterClass !== "all") q = q.eq("class", filterClass);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
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
      qc.invalidateQueries({ queryKey: ["course-profit-latest"] });
    },
    onError: (e: any) => toast.error(`Fehler: ${e.message}`),
  });

  const totals = useMemo(() => snapshots?.reduce(
    (acc, s) => {
      acc.gross += s.gross_revenue_cents; acc.net += s.net_revenue_cents;
      acc.cost += s.total_cost_cents; acc.margin += s.margin_cents;
      acc.units += s.units_sold; return acc;
    },
    { gross: 0, net: 0, cost: 0, margin: 0, units: 0 },
  ) ?? { gross: 0, net: 0, cost: 0, margin: 0, units: 0 }, [snapshots]);

  // Top Action Queue: rank by recommendation priority × |margin impact|.
  const actionQueue = useMemo(() => {
    if (!snapshots?.length) return [];
    return [...snapshots]
      .map((s) => {
        const prio = RECOMMENDATION_PRIORITY[s.recommendation_code] ?? 0;
        const impact = Math.abs(s.margin_cents) + s.gross_revenue_cents / 4;
        return { ...s, score: prio * 1000 + impact };
      })
      .filter((s) => s.recommendation_code !== "HOLD")
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [snapshots]);

  const classCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of snapshots ?? []) c[s.class] = (c[s.class] ?? 0) + 1;
    return c;
  }, [snapshots]);

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Course Profitability Cockpit</h1>
        <p className="text-muted-foreground">
          Unit-Economics pro Kurspaket. Deterministisch, append-only, täglich auto-aktualisiert (03:17 UTC).
          Empfehlungen sind read-only — Operator entscheidet, System macht keine Mutationen.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Pakete bewertet</div><div className="text-2xl font-bold">{snapshots?.length ?? 0}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Einheiten (90d)</div><div className="text-2xl font-bold">{totals.units}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Brutto-Umsatz</div><div className="text-2xl font-bold">{fmtEur(totals.gross)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Gesamtkosten</div><div className="text-2xl font-bold">{fmtEur(totals.cost)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Marge</div><div className={`text-2xl font-bold ${totals.margin >= 0 ? "text-green-600" : "text-destructive"}`}>{fmtEur(totals.margin)}</div></CardContent></Card>
      </div>

      {actionQueue.length > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-amber-500" />
              Top Action Queue — die 5 wichtigsten Hebel jetzt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {actionQueue.map((a, i) => {
                const meta = CLASS_META[a.class] ?? CLASS_META.insufficient_data;
                return (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                    <div className="text-2xl font-bold text-muted-foreground w-8">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{a.product_title ?? a.product_slug}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.recommendation_reason}</div>
                    </div>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <Badge variant="outline" className="font-medium">{REC_LABEL[a.recommendation_code]}</Badge>
                    <div className={`text-sm font-semibold tabular-nums w-24 text-right ${a.margin_cents >= 0 ? "text-green-600" : "text-destructive"}`}>
                      {fmtEur(a.margin_cents)}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Auswertung</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Zeitfenster (Tage)</label>
            <Input type="number" min={7} max={365} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="w-32" />
          </div>
          <Button onClick={() => runEval.mutate()} disabled={runEval.isPending}>
            {runEval.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Jetzt manuell auswerten
          </Button>
          <Button variant="outline" onClick={() => downloadCsv(snapshots ?? [])} disabled={!snapshots?.length}>
            <Download className="mr-2 h-4 w-4" /> CSV-Export ({snapshots?.length ?? 0})
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            {(["all", "winner", "building", "long_tail", "loser", "insufficient_data"] as const).map((c) => (
              <Button key={c} variant={filterClass === c ? "default" : "outline"} size="sm" onClick={() => setFilterClass(c)}>
                {c === "all" ? `Alle (${snapshots?.length ?? 0})` : `${CLASS_META[c]?.label} (${classCounts[c] ?? 0})`}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pakete nach Profitabilität</CardTitle>
          {dataUpdatedAt > 0 && (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> aktualisiert {new Date(dataUpdatedAt).toLocaleTimeString("de-DE")}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lade …</div>
          ) : !snapshots?.length ? (
            <div className="text-muted-foreground text-sm">
              Noch keine Snapshots — Cron läuft täglich 03:17 UTC, oder hier manuell auswerten.
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
                  {snapshots.map((s) => {
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
                            <Icon className="h-3 w-3" /> {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.units_sold}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtEur(s.net_revenue_cents)}</TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">{fmtEur(s.total_cost_cents)}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${s.margin_cents >= 0 ? "text-green-600" : "text-destructive"}`}>
                          {fmtEur(s.margin_cents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.payback_units ?? "—"}</TableCell>
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
