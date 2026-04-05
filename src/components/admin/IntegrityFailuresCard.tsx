import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useIntegrityFailures } from "@/hooks/useIntegrityFailures";
import { LoadingState } from "@/components/admin/ops/LoadingState";
import { ErrorState } from "@/components/admin/ops/ErrorState";
import TrackBadge from "@/components/admin/TrackBadge";
import { StatusDot } from "@/components/admin/ops/StatusDot";

export function IntegrityFailuresCard() {
  const { data, isLoading, error } = useIntegrityFailures();

  if (isLoading) return <LoadingState label="Lade Integrity Failures…" />;
  if (error) return <ErrorState label="Integrity Failures konnten nicht geladen werden." />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Integrity Failures</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {data && data.length > 0 ? (
          <table className="w-full min-w-[1100px] text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2">⚑</th>
                <th className="py-2 pr-3">Kurs</th>
                <th className="py-2 pr-3">Track</th>
                <th className="py-2 pr-2">Step</th>
                <th className="py-2 pr-3">Hard Fail Reasons</th>
                <th className="py-2 pr-2 text-right">Trap %</th>
                <th className="py-2 pr-2 text-right">Expl %</th>
                <th className="py-2 pr-2 text-right">Exam</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row: any) => (
                <tr key={row.package_id} className="border-b border-border/50 align-top hover:bg-muted/30">
                  <td className="py-2 pr-2"><StatusDot state="red" /></td>
                  <td className="py-2 pr-3 font-medium truncate max-w-[260px]">{row.course_title || row.curriculum_title}</td>
                  <td className="py-2 pr-3"><TrackBadge track={row.package_track} size="xs" /></td>
                  <td className="py-2 pr-2 text-muted-foreground">{row.integrity_step_status ?? "—"}</td>
                  <td className="py-2 pr-3 max-w-[350px] whitespace-pre-wrap text-destructive text-[10px]">
                    {Array.isArray(row.hard_fail_reasons)
                      ? row.hard_fail_reasons.join(", ")
                      : row.hard_fail_reasons ? JSON.stringify(row.hard_fail_reasons) : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{row.trap_coverage_pct ?? 0}%</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{row.explanation_coverage_pct ?? 0}%</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{row.approved_exam_questions ?? 0}</td>
                  <td className="py-2 text-muted-foreground">{row.package_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">Keine Integrity Failures gefunden.</p>
        )}
      </CardContent>
    </Card>
  );
}
