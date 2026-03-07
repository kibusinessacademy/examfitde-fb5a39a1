import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCohortOverview, useB2bCurricula } from "@/hooks/useB2bData";
import KpiCard from "@/components/b2b/KpiCard";
import RiskBadge from "@/components/b2b/RiskBadge";
import ReadinessBar from "@/components/b2b/ReadinessBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Users, AlertTriangle, CheckCircle, GraduationCap, ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function CohortOverviewPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const curriculumId = searchParams.get("curriculum") || null;
  const orgId = searchParams.get("org") || undefined;

  const { data: curricula = [], isLoading: loadingCurricula } = useB2bCurricula();

  // Auto-select first curriculum if none specified
  useEffect(() => {
    if (!curriculumId && curricula.length > 0) {
      const params: Record<string, string> = { curriculum: curricula[0].id };
      if (orgId) params.org = orgId;
      setSearchParams(params);
    }
  }, [curriculumId, curricula]);

  const handleCurriculumChange = (v: string) => {
    const params: Record<string, string> = { curriculum: v };
    if (orgId) params.org = orgId;
    setSearchParams(params);
  };

  const { data, isLoading, error } = useCohortOverview(curriculumId, orgId);

  const avg = data?.avg_readiness_pct ?? 0;
  const atRisk = data?.at_risk_count ?? 0;
  const examReady = data?.exam_ready_count ?? 0;
  const totalLearners = data?.total_learners ?? 0;
  const weakestSkills: any[] = data?.weakest_skills ?? [];
  const learners: any[] = data?.learners ?? [];

  const buildLearnerUrl = (learnerId: string) => {
    const params = new URLSearchParams({ id: learnerId, curriculum: curriculumId! });
    if (orgId) params.set("org", orgId);
    return `/admin/b2b/learner?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          {orgId && (
            <Button variant="ghost" size="icon" onClick={() => navigate(`/admin/b2b/org?org=${orgId}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Kohortenübersicht</h1>
            <p className="text-sm text-muted-foreground">Prüfungsreife, Risiken und schwache Kompetenzen auf Kursebene</p>
          </div>
        </div>
        <Select
          value={curriculumId ?? ""}
          onValueChange={handleCurriculumChange}
        >
          <SelectTrigger className="w-full sm:w-[280px]">
            <SelectValue placeholder={loadingCurricula ? "Lade…" : "Curriculum wählen"} />
          </SelectTrigger>
          <SelectContent>
            {curricula.map((c: any) => (
              <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Row */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Ø Prüfungsreife"
            value={`${Math.round(avg)}%`}
            icon={GraduationCap}
            valueClassName={avg >= 70 ? "text-success" : avg >= 40 ? "text-warning" : "text-destructive"}
          />
          <KpiCard
            title="Gefährdete Azubis"
            value={atRisk}
            icon={AlertTriangle}
            valueClassName={atRisk > 0 ? "text-destructive" : "text-success"}
          />
          <KpiCard
            title="Prüfungsreif"
            value={examReady}
            icon={CheckCircle}
            valueClassName="text-success"
          />
          <KpiCard
            title="Lernende gesamt"
            value={totalLearners}
            icon={Users}
          />
        </div>
      )}

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Fehler beim Laden: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* Weakest Skills */}
      {!isLoading && weakestSkills.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Schwächste Kompetenzen</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kompetenz</TableHead>
                    <TableHead>Lernfeld</TableHead>
                    <TableHead className="w-[180px]">Ø Mastery</TableHead>
                    <TableHead className="text-right">Lernende</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weakestSkills.slice(0, 10).map((s: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{s.skill_title || s.competency}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.learning_field || "–"}</TableCell>
                      <TableCell>
                        <ReadinessBar value={s.avg_mastery ?? 0} size="sm" />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.learner_count ?? "–"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Learner Table */}
      {!isLoading && learners.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Teilnehmer</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Azubi</TableHead>
                    <TableHead className="w-[160px]">Prüfungsreife</TableHead>
                    <TableHead className="text-center">Confidence</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Mastered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {learners
                    .sort((a: any, b: any) => (a.readiness_pct ?? 0) - (b.readiness_pct ?? 0))
                    .map((l: any) => (
                    <TableRow
                      key={l.learner_id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(buildLearnerUrl(l.learner_id))}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{l.display_name || l.learner_id?.slice(0, 8)}</p>
                          {l.weakest_skill && (
                            <p className="text-xs text-muted-foreground mt-0.5">schwach: {l.weakest_skill}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ReadinessBar value={l.readiness_pct ?? 0} size="sm" />
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm">
                        {l.confidence != null ? `${Math.round(l.confidence * 100)}%` : "–"}
                      </TableCell>
                      <TableCell className="text-center">
                        <RiskBadge verdict={l.verdict ?? "not_ready"} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {l.mastered ?? 0}/{l.total_skills ?? 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && totalLearners === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Keine Lerndaten für dieses Curriculum vorhanden.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
