import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrgCompetencyDashboard } from "@/hooks/useB2bData";
import KpiCard from "@/components/b2b/KpiCard";
import RiskBadge from "@/components/b2b/RiskBadge";
import ReadinessBar from "@/components/b2b/ReadinessBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, GraduationCap, AlertTriangle, CheckCircle, ArrowRight, Building2, RefreshCw } from "lucide-react";

function verdictFromReadiness(pct: number): string {
  if (pct >= 80) return "exam_ready";
  if (pct >= 60) return "almost_ready";
  if (pct >= 40) return "needs_work";
  return "not_ready";
}

interface OrgOption { id: string; name: string }

export default function OrgDashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const orgIdParam = searchParams.get("org");

  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(orgIdParam);

  // Load available organizations
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("organizations")
        .select("id, name")
        .order("name");
      const list = (data ?? []).map((o) => ({ id: o.id, name: o.name }));
      setOrgs(list);
      setLoadingOrgs(false);
      if (!selectedOrgId && list.length > 0) {
        setSelectedOrgId(list[0].id);
        setSearchParams({ org: list[0].id });
      }
    })();
  }, []);

  const handleOrgChange = (id: string) => {
    setSelectedOrgId(id);
    setSearchParams({ org: id });
  };

  const { data, isLoading, error, refetch } = useOrgCompetencyDashboard(selectedOrgId);

  const totalLearners = data?.total_learners ?? 0;
  const overallReadiness = data?.overall_readiness_pct ?? 0;
  const totalAtRisk = data?.total_at_risk ?? 0;
  const totalExamReady = data?.total_exam_ready ?? 0;
  const curricula: any[] = data?.curricula ?? [];

  // Sort curricula by readiness ascending for priority list
  const criticalCurricula = [...curricula]
    .sort((a, b) => (a.avg_readiness_pct ?? 0) - (b.avg_readiness_pct ?? 0))
    .slice(0, 3);

  // Distribution counts
  const dist = { green: 0, yellow: 0, orange: 0, red: 0 };
  curricula.forEach((c) => {
    const r = c.avg_readiness_pct ?? 0;
    if (r >= 80) dist.green++;
    else if (r >= 60) dist.yellow++;
    else if (r >= 40) dist.orange++;
    else dist.red++;
  });

  const orgName = orgs.find((o) => o.id === selectedOrgId)?.name;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Betriebsdashboard</h1>
          <p className="text-sm text-muted-foreground">
            Prüfungsreife und Risiko über alle aktiven Curricula
            {orgName && <span className="font-medium text-foreground"> · {orgName}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {orgs.length > 1 && (
            <Select value={selectedOrgId ?? ""} onValueChange={handleOrgChange}>
              <SelectTrigger className="w-full sm:w-[240px]">
                <SelectValue placeholder={loadingOrgs ? "Lade…" : "Organisation wählen"} />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Aktualisieren">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Lernende gesamt"
            value={totalLearners}
            icon={Users}
          />
          <KpiCard
            title="Ø Prüfungsreife"
            value={`${Math.round(overallReadiness)}%`}
            icon={GraduationCap}
            valueClassName={
              overallReadiness >= 70 ? "text-success" :
              overallReadiness >= 40 ? "text-warning" : "text-destructive"
            }
          />
          <KpiCard
            title="Gefährdete Azubis"
            value={totalAtRisk}
            icon={AlertTriangle}
            valueClassName={totalAtRisk > 0 ? "text-destructive" : "text-success"}
          />
          <KpiCard
            title="Prüfungsreif"
            value={totalExamReady}
            icon={CheckCircle}
            valueClassName="text-success"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-center justify-between">
            <p className="text-sm text-destructive">
              Fehler beim Laden: {(error as Error).message}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Erneut versuchen
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Distribution badges */}
      {!isLoading && curricula.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-success/10 text-success border border-success/20">
            <span className="tabular-nums">{dist.green}</span> Prüfungsreif
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-warning/10 text-warning border border-warning/20">
            <span className="tabular-nums">{dist.yellow}</span> Fast bereit
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)] border-[hsl(25,95%,53%)]/20 border">
            <span className="tabular-nums">{dist.orange}</span> Aufholbedarf
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
            <span className="tabular-nums">{dist.red}</span> Kritisch
          </div>
        </div>
      )}

      {/* Priority Action List */}
      {!isLoading && criticalCurricula.length > 0 && criticalCurricula[0]?.avg_readiness_pct < 80 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Handlungsbedarf zuerst
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {criticalCurricula
              .filter((c) => (c.avg_readiness_pct ?? 0) < 80)
              .map((c: any) => (
              <div
                key={c.curriculum_id}
                className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                onClick={() => navigate(`/admin/b2b/cohort?curriculum=${c.curriculum_id}&org=${selectedOrgId}`)}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.title || c.curriculum_id?.slice(0, 8)}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{c.learner_count ?? 0} Lernende</span>
                    <span>·</span>
                    <span className="text-destructive font-medium">{c.at_risk_count ?? 0} gefährdet</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <ReadinessBar value={c.avg_readiness_pct ?? 0} size="sm" className="w-24 hidden sm:flex" />
                  <RiskBadge verdict={verdictFromReadiness(c.avg_readiness_pct ?? 0)} />
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Curricula Table */}
      {!isLoading && curricula.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Alle Curricula</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Curriculum</TableHead>
                    <TableHead className="text-center">Lernende</TableHead>
                    <TableHead className="w-[180px]">Ø Prüfungsreife</TableHead>
                    <TableHead className="text-center">Gefährdet</TableHead>
                    <TableHead className="text-center">Prüfungsreif</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {curricula.map((c: any) => (
                    <TableRow
                      key={c.curriculum_id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(`/admin/b2b/cohort?curriculum=${c.curriculum_id}&org=${selectedOrgId}`)}
                    >
                      <TableCell className="font-medium text-sm max-w-[240px] truncate">
                        {c.title || c.curriculum_id?.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm">
                        {c.learner_count ?? 0}
                      </TableCell>
                      <TableCell>
                        <ReadinessBar value={c.avg_readiness_pct ?? 0} size="sm" />
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`tabular-nums text-sm font-medium ${(c.at_risk_count ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {c.at_risk_count ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="tabular-nums text-sm font-medium text-success">
                          {c.exam_ready_count ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <RiskBadge verdict={verdictFromReadiness(c.avg_readiness_pct ?? 0)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm">
                          Zur Kohorte <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border">
              {curricula.map((c: any) => (
                <div
                  key={c.curriculum_id}
                  className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate(`/admin/b2b/cohort?curriculum=${c.curriculum_id}&org=${selectedOrgId}`)}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-medium">{c.title || c.curriculum_id?.slice(0, 8)}</p>
                    <RiskBadge verdict={verdictFromReadiness(c.avg_readiness_pct ?? 0)} />
                  </div>
                  <ReadinessBar value={c.avg_readiness_pct ?? 0} size="sm" className="mb-2" />
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{c.learner_count ?? 0} Lernende</span>
                    <span className={`font-medium ${(c.at_risk_count ?? 0) > 0 ? "text-destructive" : ""}`}>
                      {c.at_risk_count ?? 0} gefährdet
                    </span>
                    <span className="text-success font-medium">{c.exam_ready_count ?? 0} bereit</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && !error && totalLearners === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              Keine aktiven Lernenden oder Curricula für diese Organisation vorhanden.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
