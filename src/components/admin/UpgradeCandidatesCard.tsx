import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUpgradeCandidates } from "@/hooks/useUpgradeCandidates";
import { LoadingState } from "@/components/admin/ops/LoadingState";
import { ErrorState } from "@/components/admin/ops/ErrorState";
import TrackBadge from "@/components/admin/TrackBadge";
import { StatusDot } from "@/components/admin/ops/StatusDot";
import { Button } from "@/components/ui/button";

export function UpgradeCandidatesCard() {
  const { data, isLoading, error } = useUpgradeCandidates();

  if (isLoading) return <LoadingState label="Lade Upgrade Candidates…" />;
  if (error) return <ErrorState label="Upgrade Candidates konnten nicht geladen werden." />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Upgrade Candidates</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {data && data.length > 0 ? (
          <table className="w-full min-w-[1100px] text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2">⚑</th>
                <th className="py-2 pr-3">Kurs</th>
                <th className="py-2 pr-3">Aktuell</th>
                <th className="py-2 pr-3">Empfohlen</th>
                <th className="py-2 pr-2">Decision</th>
                <th className="py-2 pr-2 text-right">Score</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2">Published</th>
                <th className="py-2 pr-2 text-right">Exam</th>
                <th className="py-2 pr-2 text-right">HB</th>
                <th className="py-2 pr-2 text-right">Tutor</th>
                <th className="py-2">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row: any) => {
                const dot = row.latest_upgrade_decision === "upgrade" ? "green" : row.latest_upgrade_decision === "monitor" ? "yellow" : "gray";
                return (
                  <tr key={row.package_id} className="border-b border-border/50 align-top hover:bg-muted/30">
                    <td className="py-2 pr-2"><StatusDot state={dot} /></td>
                    <td className="py-2 pr-3 font-medium truncate max-w-[260px]">{row.course_title || row.curriculum_title}</td>
                    <td className="py-2 pr-3"><TrackBadge track={row.package_track} size="xs" /></td>
                    <td className="py-2 pr-3"><TrackBadge track={row.latest_upgrade_recommended_track} size="xs" /></td>
                    <td className="py-2 pr-2 text-muted-foreground">{row.latest_upgrade_decision}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.latest_upgrade_score ?? "—"}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{row.package_status}</td>
                    <td className="py-2 pr-2">{row.is_published ? "✅" : "❌"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.approved_exam_questions}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.handbook_chapters}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.tutor_index_items}</td>
                    <td className="py-2"><Button size="sm" variant="outline" className="h-6 text-[10px]">Upgrade prüfen</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">Keine Upgrade-Kandidaten vorhanden.</p>
        )}
      </CardContent>
    </Card>
  );
}
