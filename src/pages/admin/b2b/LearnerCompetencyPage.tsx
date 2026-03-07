import { useSearchParams, useNavigate } from "react-router-dom";
import { useLearnerProfile } from "@/hooks/useB2bData";
import { toast } from "sonner";
import RiskBadge from "@/components/b2b/RiskBadge";
import ReadinessBar from "@/components/b2b/ReadinessBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, GraduationCap, Shield, TrendingUp, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export default function LearnerCompetencyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const learnerId = searchParams.get("id");
  const curriculumId = searchParams.get("curriculum");
  const orgId = searchParams.get("org");

  const { data, isLoading, error } = useLearnerProfile(learnerId, curriculumId);

  const profile = data ?? {} as any;
  const strongestSkills: any[] = profile.strongest_skills ?? [];
  const weakestSkills: any[] = profile.weakest_skills ?? [];
  const recentSessions: any[] = profile.recent_sessions ?? [];

  // Build back-navigation URL preserving org context
  const buildBackUrl = () => {
    const params = new URLSearchParams();
    if (curriculumId) params.set("curriculum", curriculumId);
    if (orgId) params.set("org", orgId);
    return `/admin/b2b/cohort?${params.toString()}`;
  };

  if (!learnerId || !curriculumId) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Fehlende Parameter. <Button variant="link" onClick={() => navigate(-1)}>Zurück</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(buildBackUrl())}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {profile.display_name || learnerId?.slice(0, 8)}
          </h1>
          <p className="text-sm text-muted-foreground">{profile.curriculum_title || "Kompetenzprofil"}</p>
        </div>
        {!isLoading && <RiskBadge verdict={profile.verdict ?? "not_ready"} className="ml-auto" />}
      </div>

      {/* KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Prüfungsreife"
            value={`${Math.round(profile.readiness_pct ?? 0)}%`}
            icon={GraduationCap}
            valueClassName={
              (profile.readiness_pct ?? 0) >= 70 ? "text-success" :
              (profile.readiness_pct ?? 0) >= 40 ? "text-warning" : "text-destructive"
            }
          />
          <KpiCard
            title="Fail Risk"
            value={`${Math.round((profile.fail_risk ?? 0) * 100)}%`}
            icon={AlertTriangle}
            valueClassName={(profile.fail_risk ?? 0) > 0.4 ? "text-destructive" : "text-success"}
          />
          <KpiCard
            title="Confidence"
            value={`${Math.round((profile.confidence ?? 0) * 100)}%`}
            icon={Shield}
          />
          <KpiCard
            title="Trend"
            value={profile.trend ?? "–"}
            icon={TrendingUp}
          />
        </div>
      )}

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Fehler: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* Skills Grid */}
      {!isLoading && (weakestSkills.length > 0 || strongestSkills.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-destructive">Schwächste Kompetenzen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {weakestSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Daten</p>
              ) : (
                weakestSkills.map((s: any, i: number) => (
                  <div key={i}>
                    <p className="text-sm font-medium">{s.skill_title || s.competency}</p>
                    <ReadinessBar value={s.mastery ?? 0} size="sm" className="mt-1" />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-success">Stärkste Kompetenzen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {strongestSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Daten</p>
              ) : (
                strongestSkills.map((s: any, i: number) => (
                  <div key={i}>
                    <p className="text-sm font-medium">{s.skill_title || s.competency}</p>
                    <ReadinessBar value={s.mastery ?? 0} size="sm" className="mt-1" />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent Sessions */}
      {!isLoading && recentSessions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Letzte Prüfungen</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Fragen</TableHead>
                  <TableHead className="text-right">Dauer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentSessions.map((s: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">
                      {s.created_at ? format(new Date(s.created_at), "dd.MM.yyyy HH:mm") : "–"}
                    </TableCell>
                    <TableCell>
                      <ReadinessBar value={s.score_pct ?? 0} size="sm" showPercent />
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {s.correct ?? 0}/{s.total ?? 0}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {s.duration_min ? `${s.duration_min} min` : "–"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {!isLoading && (
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-3">
            <Button variant="default" disabled>Adaptive Prüfung starten</Button>
            <Button variant="outline" disabled>Remediation starten</Button>
            <Button variant="outline" disabled>Mit Tutor arbeiten</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
