import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getAdminAutoTestQueue } from "@/features/admin/api/adminAutoTestQueueApi";
import { TestPriorityBadge } from "@/features/admin/components/TestPriorityBadge";
import { TestPriorityReasons } from "@/features/admin/components/TestPriorityReasons";

type PreviewMode = "standard" | "premium" | "adaptive";

function withPreview(url: string, mode: PreviewMode) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}admin_preview=1&preview_mode=${mode}`;
}

export function AdminAutoTestQueue({
  previewMode,
  limit = 10,
}: {
  previewMode: PreviewMode;
  limit?: number;
}) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin-auto-test-queue", limit],
    queryFn: () => getAdminAutoTestQueue(limit),
    staleTime: 60_000,
  });

  const open = (path: string) => {
    window.open(withPreview(path, previewMode), "_blank");
  };

  if (isLoading) {
    return <div className="rounded-2xl border p-4 text-muted-foreground">Lade Auto-Test-Queue…</div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-destructive/30 p-4 text-destructive">Fehler beim Laden der Auto-Test-Queue.</div>;
  }

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <div>
        <div className="text-lg font-semibold">Heutige Test-Priorität</div>
        <div className="text-sm text-muted-foreground">
          Diese Kurse solltest du zuerst aus Learner-Sicht testen.
        </div>
      </div>

      <div className="space-y-3">
        {data.map((item, idx) => (
          <div key={item.package_id} className="rounded-xl border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">#{idx + 1}</div>
                <div className="font-medium truncate">{item.title}</div>
                <div className="text-xs text-muted-foreground">
                  Score: {item.queue_score} · {new Date(item.updated_at).toLocaleDateString("de-DE")}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <TestPriorityBadge priority={item.test_priority} />
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {item.freshness_bucket === "today" ? "heute" : item.freshness_bucket === "recent" ? "kürzlich" : "älter"}
                </span>
              </div>
            </div>

            <TestPriorityReasons reasons={item.reason_codes} />

            <div className="grid grid-cols-3 gap-1.5 text-xs">
              <div className={`rounded-lg border p-2 ${item.approved_questions < 40 ? "border-destructive/30 text-destructive" : ""}`}>
                Fragen: {item.approved_questions}
              </div>
              <div className={`rounded-lg border p-2 ${item.lessons_count === 0 ? "border-destructive/30 text-destructive" : ""}`}>
                Lessons: {item.lessons_count}
              </div>
              <div className={`rounded-lg border p-2 ${item.tutor_index_count === 0 ? "border-amber-500/30 text-amber-700 dark:text-amber-300" : ""}`}>
                Tutor: {item.tutor_index_count}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Button size="sm" variant="outline" onClick={() => open(`/learner/course/${item.curriculum_id}`)}>
                Kurs
              </Button>
              <Button size="sm" variant="outline" onClick={() => open(`/learner/exam/${item.curriculum_id}`)}>
                Prüfung
              </Button>
              <Button size="sm" variant="outline" onClick={() => open(`/learner/tutor/${item.curriculum_id}`)}>
                Tutor
              </Button>
              <Button size="sm" onClick={() => open(`/learner/exam/adaptive/${item.curriculum_id}`)}>
                Adaptive
              </Button>
            </div>
          </div>
        ))}

        {data.length === 0 && (
          <div className="rounded-xl border p-4 text-sm text-muted-foreground">
            Keine Kurse in der Auto-Test-Queue.
          </div>
        )}
      </div>
    </div>
  );
}
