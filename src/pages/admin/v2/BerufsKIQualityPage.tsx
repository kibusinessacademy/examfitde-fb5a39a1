/**
 * Admin: Berufs-KI Quality Dashboard — Phase 3.
 *
 * Aggregiert pro Workflow: OK-Rate, Fehlerquote, Latenz, Sektions-Coverage,
 * User-Ratings, Lock→Pro-Conversion. SSOT: admin_berufs_ki_quality_dashboard.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Sparkles, TrendingDown, TrendingUp, Lock as LockIcon, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { adminGetQualityDashboard } from "@/lib/berufs-ki/api";
import type { AdminQualityRow } from "@/lib/berufs-ki/types";
import { CATEGORY_LABEL } from "@/lib/berufs-ki/copy";

const WINDOWS: Array<{ value: number; label: string }> = [
  { value: 24, label: "24h" },
  { value: 168, label: "7 Tage" },
  { value: 720, label: "30 Tage" },
];

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function fmtMs(n: number) {
  if (!n) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

export default function BerufsKIQualityPage() {
  const [rows, setRows] = useState<AdminQualityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [windowH, setWindowH] = useState<number>(168);

  async function refresh() {
    setLoading(true);
    try {
      const res = await adminGetQualityDashboard(windowH);
      setRows(res);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowH]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const active = list.filter((r) => r.runs_window > 0);
    const totalRuns = active.reduce((s, r) => s + r.runs_window, 0);
    const totalOk = active.reduce((s, r) => s + r.ok_runs, 0);
    const totalErr = active.reduce((s, r) => s + r.error_runs, 0);
    const totalBlocked = active.reduce((s, r) => s + r.blocked_runs, 0);
    const totalConv = active.reduce((s, r) => s + r.lock_conversions, 0);
    return {
      totalRuns,
      okRate: totalRuns > 0 ? totalOk / totalRuns : 0,
      errRate: totalRuns > 0 ? totalErr / totalRuns : 0,
      lockBlocked: totalBlocked,
      lockConv: totalConv,
      lockConvRate: totalBlocked > 0 ? totalConv / totalBlocked : 0,
    };
  }, [rows]);

  const top = useMemo(() => {
    if (!rows) return [];
    return [...rows]
      .filter((r) => r.runs_window >= 5 && r.rating_score != null)
      .sort((a, b) => (b.rating_score ?? 0) - (a.rating_score ?? 0))
      .slice(0, 5);
  }, [rows]);

  const low = useMemo(() => {
    if (!rows) return [];
    return [...rows]
      .filter((r) => r.runs_window >= 5)
      .sort((a, b) => {
        const aBad = (a.rating_score ?? 0) - (1 - a.ok_rate);
        const bBad = (b.rating_score ?? 0) - (1 - b.ok_rate);
        return aBad - bBad;
      })
      .slice(0, 5);
  }, [rows]);

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Berufs-KI · Qualität
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Quality Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lernende Workflow-Qualität pro Beruf, Kompetenz und Blueprint.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(windowH)} onValueChange={(v) => setWindowH(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w.value} value={String(w.value)}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Aktualisieren
          </Button>
        </div>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Läufe gesamt</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{stats.totalRuns}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">OK-Rate</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{pct(stats.okRate)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Fehlerquote</div>
            <div className="mt-1 flex items-center gap-1.5 text-2xl font-bold tabular-nums">
              {stats.errRate > 0.05 && <AlertTriangle className="h-5 w-5 text-amber-600" />}
              {pct(stats.errRate)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Lock-Trigger</div>
            <div className="mt-1 flex items-center gap-1.5 text-2xl font-bold tabular-nums">
              <LockIcon className="h-4 w-4 text-muted-foreground" />
              {stats.lockBlocked}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Lock → Pro</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {stats.lockConv}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({pct(stats.lockConvRate)})
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-emerald-600" /> Top Workflows
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="text-right">Läufe</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((r) => (
                  <TableRow key={r.workflow_id}>
                    <TableCell>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground">{CATEGORY_LABEL[r.category]}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.runs_window}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.rating_score != null ? (r.rating_score >= 0 ? `+${r.rating_score.toFixed(2)}` : r.rating_score.toFixed(2)) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {top.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-4 text-center text-xs text-muted-foreground">
                      Noch zu wenig bewertete Läufe.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-4 w-4 text-amber-600" /> Verbesserungsbedarf
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="text-right">Coverage</TableHead>
                  <TableHead className="text-right">Fehler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {low.map((r) => (
                  <TableRow key={r.workflow_id}>
                    <TableCell>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground">v{r.version} · {r.runs_window} Läufe</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.avg_coverage_pct.toFixed(0)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(r.error_rate)}</TableCell>
                  </TableRow>
                ))}
                {low.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-4 text-center text-xs text-muted-foreground">
                      Keine Auffälligkeiten.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alle Workflows ({rows?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workflow</TableHead>
                <TableHead>Kategorie</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Läufe</TableHead>
                <TableHead className="text-right">OK</TableHead>
                <TableHead className="text-right">Fehler</TableHead>
                <TableHead className="text-right">Coverage</TableHead>
                <TableHead className="text-right">Latenz</TableHead>
                <TableHead className="text-right">Rating</TableHead>
                <TableHead className="text-right">Lock→Pro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => (
                <TableRow key={r.workflow_id}>
                  <TableCell>
                    <div className="font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">v{r.version}{r.is_active ? "" : " · inaktiv"}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{CATEGORY_LABEL[r.category]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.tier_required === "free" ? "secondary" : "default"}>
                      {r.tier_required}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.runs_window}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.ok_rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.error_rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.avg_coverage_pct.toFixed(0)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMs(r.avg_latency_ms)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.rating_score != null ? r.rating_score.toFixed(2) : "—"}
                    {(r.helpful_count + r.partial_count + r.unhelpful_count) > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        👍{r.helpful_count} ➖{r.partial_count} 👎{r.unhelpful_count}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.lock_conversions}/{r.lock_blocked}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && (rows?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">
                    Keine Daten im Zeitfenster.
                  </TableCell>
                </TableRow>
              )}
              {loading && (
                <TableRow>
                  <TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
