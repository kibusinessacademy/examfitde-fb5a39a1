import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCohortOverview } from "@/hooks/useB2bData";
import KpiCard from "@/components/b2b/KpiCard";
import RiskBadge from "@/components/b2b/RiskBadge";
import ReadinessBar from "@/components/b2b/ReadinessBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, AlertTriangle, CheckCircle, GraduationCap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface CurriculumOption { id: string; title: string }

export default function CohortOverviewPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const curriculumId = searchParams.get("curriculum") || null;

  const [curricula, setCurricula] = useState<CurriculumOption[]>([]);
  const [loadingCurricula, setLoadingCurricula] = useState(true);

  // Load curricula list
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("curricula")
        .select("id, titel")
        .order("titel");
      setCurricula((data ?? []).map((c: any) => ({ id: c.id, title: c.titel })));
      setLoadingCurricula(false);
      // Auto-select first if none
      if (!curriculumId && data && data.length > 0) {
        setSearchParams({ curriculum: data[0].id });
      }
    })();
  }, []);

  const { data, isLoading, error } = useCohortOverview(curriculumId);

  const avg = data?.avg_readiness_pct ?? 0;
  const atRisk = data?.at_risk_count ?? 0;
  const examReady = data?.exam_ready_count ?? 0;
  const totalLearners = data?.total_learners ?? 0;
  const weakestSkills: any[] = data?.weakest_skills ?? [];
  const learners: any[] = data?.learners ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kohortenübersicht</h1>
          <p className="text-sm text-muted-foreground">Prüfungsreife, Risiken und schwache Kompetenzen auf Kursebene</p>
        </div>
        <Select
          value={curriculumId ?? ""}
          onValueChange={(v) => setSearchParams({ curriculum: v })}
        >
          <SelectTrigger className="w-full sm:w-[280px]">
            <SelectValue placeholder={loadingCurricula ? "Lade…" : "Curriculum wählen"} />
          </SelectTrigger>
          <SelectContent>
            {curricula.map((c) => (
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
                      onClick={() => navigate(`/admin/b2b/learner?id=${l.learner_id}&curriculum=${curriculumId}`)}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{l.display_name || l.learner_id?.slice(0, 8)}</p>
                          {l.weakest_skill && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              schwach: {l.weakest_skill}
                            </p>
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
