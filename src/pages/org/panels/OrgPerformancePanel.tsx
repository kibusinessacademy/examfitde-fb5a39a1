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
import CriticalCaseRow, { riskToVerdict } from "@/pages/org/components/CriticalCaseRow";
import CriticalOneClickActions from "@/pages/org/components/CriticalOneClickActions";

function formatDate(date?: string | null) {
  if (!date || date === '2000-01-01T00:00:00+00:00') return "–";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(date));
}

/** Sort: high risk first, then inactive, then by readiness ascending */
function sortRows(rows: OrgPerformanceRow[]): OrgPerformanceRow[] {
  return [...rows].sort((a, b) => {
    const bucketA = a.risk_level === 'high' ? 0 : a.inactive_days > 14 ? 1 : 2;
    const bucketB = b.risk_level === 'high' ? 0 : b.inactive_days > 14 ? 1 : 2;
    if (bucketA !== bucketB) return bucketA - bucketB;
    return a.readiness_score - b.readiness_score;
  });
}

interface Props {
  organizationId: string;
  onNavigateToInterventions?: () => void;
  onNavigateToLearner?: (userId: string, productId: string) => void;
}

export default function OrgPerformancePanel({ organizationId, onNavigateToInterventions, onNavigateToLearner }: Props) {
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

  const sortedRows = useMemo(() => sortRows(rows), [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedRows;
    return sortedRows.filter(r =>
      r.display_name?.toLowerCase().includes(q) ||
      r.product_title?.toLowerCase().includes(q)
    );
  }, [sortedRows, query]);

  const criticalRows = useMemo(
    () => sortedRows.filter(r => r.risk_level === 'high' || r.inactive_days > 14),
    [sortedRows]
  );

  const handleCriticalRowClick = (row: OrgPerformanceRow) => {
    if (onNavigateToLearner) {
      onNavigateToLearner(row.user_id, row.product_id);
    } else if (onNavigateToInterventions) {
      onNavigateToInterventions();
    }
  };

  if (loadingSummary || loadingRows) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const openInterventions = interventionSummary?.total_open ?? 0;
  const criticalInterventions = (interventionSummary?.critical_count ?? 0) + (interventionSummary?.high_count ?? 0);

  return (
    <div className="space-y-6">
      {/* KPI Cards – now includes intervention count */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
        <KpiCard
          icon={<ShieldAlert className="h-4 w-4 text-destructive" />}
          label="Offene Interventionen"
          value={openInterventions}
          highlight={criticalInterventions > 0}
          subtitle={criticalInterventions > 0 ? `${criticalInterventions} kritisch` : undefined}
          onClick={onNavigateToInterventions}
        />
      </div>

      {/* Critical Cases with explanations + one-click actions */}
      {criticalRows.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Kritische Fälle ({criticalRows.length})
            </CardTitle>
            <CardDescription>
              Lernende mit hohem Risiko oder längerer Inaktivität – Klick für Details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {criticalRows.slice(0, 8).map(row => (
                <div key={`${row.user_id}-${row.product_id}`}>
                  <CriticalCaseRow row={row} onClickRow={handleCriticalRowClick} />
                  <CriticalOneClickActions row={row} organizationId={organizationId} />
                </div>
              ))}
            </div>
            {criticalRows.length > 8 && (
              <Button variant="ghost" size="sm" className="w-full mt-2 text-muted-foreground" onClick={onNavigateToInterventions}>
                + {criticalRows.length - 8} weitere kritische Fälle
              </Button>
            )}
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

function KpiCard({ icon, label, value, highlight, subtitle, onClick }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  highlight?: boolean;
  subtitle?: string;
  onClick?: () => void;
}) {
  return (
    <Card className={onClick ? 'cursor-pointer hover:border-primary/40 transition-colors' : ''} onClick={onClick}>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className={`text-3xl ${highlight ? 'text-destructive' : ''}`}>
          {value}
        </CardTitle>
        {subtitle && (
          <p className="text-xs text-destructive font-medium">{subtitle}</p>
        )}
      </CardHeader>
    </Card>
  );
}
