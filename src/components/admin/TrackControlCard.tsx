import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTrackCompliance } from "@/hooks/useTrackCompliance";
import { LoadingState } from "@/components/admin/ops/LoadingState";
import { ErrorState } from "@/components/admin/ops/ErrorState";
import TrackBadge from "@/components/admin/TrackBadge";
import { StatusDot } from "@/components/admin/ops/StatusDot";

export function TrackControlCard() {
  const { data, isLoading, error } = useTrackCompliance();

  if (isLoading) return <LoadingState label="Lade Track Control…" />;
  if (error) return <ErrorState label="Track Control konnte nicht geladen werden." />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Track Control</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-2">⚑</th>
              <th className="py-2 pr-3">Kurs</th>
              <th className="py-2 pr-3">Track</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-2 text-right">Exam</th>
              <th className="py-2 pr-2 text-right">Lessons</th>
              <th className="py-2 pr-2 text-right">MC</th>
              <th className="py-2 pr-2 text-right">HB</th>
              <th className="py-2 pr-2 text-right">Tutor</th>
              <th className="py-2 pr-2">OK</th>
              <th className="py-2">Violation</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((row: any) => (
              <tr key={row.package_id} className="border-b border-border/50 align-top hover:bg-muted/30">
                <td className="py-2 pr-2"><StatusDot state={row.track_compliant ? "green" : "red"} /></td>
                <td className="py-2 pr-3 font-medium truncate max-w-[260px]">{row.course_title || row.curriculum_title}</td>
                <td className="py-2 pr-3"><TrackBadge track={row.package_track} size="xs" /></td>
                <td className="py-2 pr-3 text-muted-foreground">{row.package_status}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.approved_exam_questions}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.learning_lessons}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.approved_minicheck_questions}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.handbook_chapters}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.tutor_index_items}</td>
                <td className="py-2 pr-2">{row.track_compliant ? "✅" : "❌"}</td>
                <td className="py-2 text-destructive text-[10px]">{row.track_violation_code ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!data || data.length === 0) && <p className="text-sm text-muted-foreground py-4 text-center">Keine Pakete gefunden.</p>}
      </CardContent>
    </Card>
  );
}
