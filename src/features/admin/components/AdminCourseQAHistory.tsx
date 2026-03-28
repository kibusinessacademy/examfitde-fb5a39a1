import { useQuery } from "@tanstack/react-query";
import { getAdminCourseTestRunHistory } from "@/features/admin/api/adminCourseTestRunsApi";
import { CourseTestStatusBadge } from "@/features/admin/components/CourseTestStatusBadge";

export function AdminCourseQAHistory({ packageId }: { packageId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-course-test-run-history", packageId],
    queryFn: () => getAdminCourseTestRunHistory(packageId),
    staleTime: 30_000,
  });

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground">QA-Historie</div>

      {isLoading && <div className="text-xs text-muted-foreground">Lade…</div>}

      <div className="space-y-1.5">
        {data.slice(0, 5).map((item) => (
          <div key={item.id} className="rounded-lg border p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <CourseTestStatusBadge status={item.test_status} />
              <div className="text-[10px] text-muted-foreground">
                {new Date(item.created_at).toLocaleString("de-DE")}
              </div>
            </div>

            {item.notes && <div className="text-xs">{item.notes}</div>}

            {item.issue_codes?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.issue_codes.map((code) => (
                  <span
                    key={code}
                    className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {code}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {data.length === 0 && !isLoading && (
          <div className="text-xs text-muted-foreground">Noch keine QA-Läufe.</div>
        )}
      </div>
    </div>
  );
}
