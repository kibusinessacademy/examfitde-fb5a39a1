import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Loader2, AlertTriangle, Users, TrendingUp, Activity, ShieldAlert } from "lucide-react";
import RiskBadge from "@/components/b2b/RiskBadge";
import ReadinessBar from "@/components/b2b/ReadinessBar";
import { useOrgPerformanceDashboard, useOrgPerformanceSummary } from "@/hooks/useOrgPerformance";
import { useOrgInterventionSummary } from "@/hooks/useOrgInterventions";
import type { OrgPerformanceRow } from "@/hooks/useOrgPerformance";

function formatDate(date?: string | null) {
  if (!date || date === '2000-01-01T00:00:00+00:00') return "–";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(date));
}

function riskToVerdict(risk: string): string {
  switch (risk) {
    case 'low': return 'exam_ready';
    case 'medium': return 'almost_ready';
    case 'high': return 'not_ready';
    case 'not_started': return 'needs_work';
    default: return risk;
  }
}

interface Props {
  organizationId: string;
  onNavigateToInterventions?: () => void;
}

export default function OrgPerformancePanel({ organizationId, onNavigateToInterventions }: Props) {
  const [productId, setProductId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");

  const { data: summary, isLoading: loadingSummary } = useOrgPerformanceSummary(organizationId, productId);
  const { data: rows = [], isLoading: loadingRows } = useOrgPerformanceDashboard(organizationId, productId);
  const { data: interventionSummary } = useOrgInterventionSummary(organizationId);

  const products = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach(r => { if (r.product_id && r.product_title) map.set(r.product_id, r.product_title); });
    return Array.from(map.entries());
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.display_name?.toLowerCase().includes(q) ||
      r.product_title?.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const criticalRows = useMemo(
    () => rows.filter(r => r.risk_level === 'high' || r.inactive_days > 14),
    [rows]
  );

  if (loadingSummary || loadingRows) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          label="Aktive Lernende"
          value={summary?.total_learners ?? 0}
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          label="Ø Prüfungsreife"
          value={`${Math.round(summary?.avg_readiness ?? 0)}%`}
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          label="High Risk"
          value={summary?.high_risk_count ?? 0}
          highlight={!!summary?.high_risk_count}
        />
        <KpiCard
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          label="Inaktiv (>14d)"
          value={summary?.inactive_count ?? 0}
        />
      </div>

      {/* Open Interventions Banner */}
      {(interventionSummary?.total_open ?? 0) > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <div>
                <p className="text-sm font-medium">
                  {interventionSummary!.total_open} offene Interventionen
                  {(interventionSummary!.critical_count + interventionSummary!.high_count) > 0 && (
                    <span className="text-destructive ml-1">
                      ({interventionSummary!.critical_count + interventionSummary!.high_count} kritisch/hoch)
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">Lernende benötigen Aufmerksamkeit</p>
              </div>
            </div>
            {onNavigateToInterventions && (
              <Button size="sm" variant="outline" onClick={onNavigateToInterventions}>
                Interventionen öffnen
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Critical Cases */}
      {criticalRows.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Kritische Fälle
            </CardTitle>
            <CardDescription>
              Lernende mit hohem Risiko oder längerer Inaktivität
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {criticalRows.slice(0, 6).map(row => (
                <div key={`${row.user_id}-${row.product_id}`} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium text-sm">{row.display_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.product_title} · {Math.round(row.readiness_score)}% Prüfungsreife
                      {row.inactive_days > 14 && ` · ${row.inactive_days} Tage inaktiv`}
                    </div>
                  </div>
                  <RiskBadge verdict={riskToVerdict(row.risk_level)} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nach Lernendem oder Produkt suchen…"
          className="sm:max-w-sm"
        />
        <Select
          value={productId ?? "all"}
          onValueChange={(v) => setProductId(v === "all" ? undefined : v)}
        >
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Alle Produkte" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Produkte</SelectItem>
            {products.map(([id, title]) => (
              <SelectItem key={id} value={id}>{title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Performance Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Lernende im Überblick</CardTitle>
          <CardDescription>{filteredRows.length} Lernende</CardDescription>
        </CardHeader>
        <CardContent>
          {filteredRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Noch keine Lernenden mit zugewiesenem Seat.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lernender</TableHead>
                  <TableHead>Produkt</TableHead>
                  <TableHead className="min-w-[180px]">Prüfungsreife</TableHead>
                  <TableHead>Risiko</TableHead>
                  <TableHead>Fortschritt</TableHead>
                  <TableHead>Letzte Prüfung</TableHead>
                  <TableHead>Inaktiv</TableHead>
                  <TableHead>Letzte Aktivität</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <PerformanceRow key={`${row.user_id}-${row.product_id}`} row={row} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PerformanceRow({ row }: { row: OrgPerformanceRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{row.display_name}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{row.product_title || "–"}</TableCell>
      <TableCell>
        <ReadinessBar value={row.readiness_score} size="sm" />
      </TableCell>
      <TableCell>
        <RiskBadge verdict={riskToVerdict(row.risk_level)} />
      </TableCell>
      <TableCell className="tabular-nums">{Math.round(row.progress_pct)}%</TableCell>
      <TableCell className="tabular-nums">{Math.round(row.last_exam_score)}%</TableCell>
      <TableCell className="tabular-nums text-sm">
        {row.inactive_days > 14 ? (
          <span className="text-destructive font-medium">{row.inactive_days}d</span>
        ) : (
          `${row.inactive_days}d`
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{formatDate(row.last_activity_at)}</TableCell>
    </TableRow>
  );
}

function KpiCard({ icon, label, value, highlight }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className={`text-3xl ${highlight ? 'text-destructive' : ''}`}>
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
