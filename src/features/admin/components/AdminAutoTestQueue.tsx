import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getAdminAutoTestQueue } from "@/features/admin/api/adminAutoTestQueueApi";
import { TestPriorityBadge } from "@/features/admin/components/TestPriorityBadge";
import { TestPriorityReasons } from "@/features/admin/components/TestPriorityReasons";
import { CourseTestStatusBadge } from "@/features/admin/components/CourseTestStatusBadge";
import { cn } from "@/lib/utils";

type PreviewMode = "standard" | "premium" | "adaptive";

function withPreview(url: string, mode: PreviewMode) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}admin_preview=1&preview_mode=${mode}`;
}

const freshnessLabel: Record<string, string> = {
  never_tested: "nie getestet",
  today: "heute",
  recent: "kürzlich",
  stale: "veraltet",
};

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
    return (
      <Card variant="flat" className="rounded-2xl p-4 text-text-secondary">
        Lade Auto-Test-Queue…
      </Card>
    );
  }

  if (error) {
    return (
      <Card
        variant="flat"
        className="rounded-2xl border-destructive-border bg-destructive-bg-subtle p-4 text-destructive"
      >
        Fehler beim Laden der Auto-Test-Queue.
      </Card>
    );
  }

  return (
    <Card variant="default" className="rounded-2xl p-5 space-y-4">
      <div>
        <div className="text-lg font-semibold text-text-primary">Heutige Test-Priorität</div>
        <div className="text-sm text-text-secondary">
          Diese Kurse solltest du zuerst aus Learner-Sicht testen.
        </div>
      </div>

      <div className="space-y-3">
        {data.map((item, idx) => (
          <Card key={item.package_id} variant="raised" className="rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-text-tertiary">#{idx + 1}</div>
                <div className="font-medium truncate text-text-primary">{item.title}</div>
                <div className="text-xs text-text-tertiary">
                  Score: {item.queue_score} · {new Date(item.updated_at).toLocaleDateString("de-DE")}
                </div>
                {item.latest_qa_at && (
                  <div className="text-[10px] text-text-quaternary mt-0.5">
                    Letzter QA-Run: {new Date(item.latest_qa_at).toLocaleString("de-DE")}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <TestPriorityBadge priority={item.test_priority} />
                <CourseTestStatusBadge status={item.latest_qa_status} />
                <Badge variant="muted" size="sm">
                  {freshnessLabel[item.qa_freshness_bucket] ?? item.qa_freshness_bucket}
                </Badge>
              </div>
            </div>

            <TestPriorityReasons reasons={item.reason_codes} />

            {item.latest_qa_issue_codes && item.latest_qa_issue_codes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {item.latest_qa_issue_codes.map((code) => (
                  <Badge key={code} variant="danger" size="sm">
                    QA: {code}
                  </Badge>
                ))}
              </div>
            )}

            {item.latest_qa_notes && (
              <div className="rounded-lg border border-border-subtle bg-surface-sunken p-2 text-xs text-text-secondary">
                {item.latest_qa_notes}
              </div>
            )}

            {item.never_tested && (
              <div className="rounded-lg border border-warning-border bg-warning-bg-subtle px-3 py-1.5 text-xs text-warning">
                Noch nie getestet — hoher manueller QA-Wert.
              </div>
            )}

            <div className="grid grid-cols-3 gap-1.5 text-xs">
              <div
                className={cn(
                  "rounded-lg border border-border-subtle p-2 text-text-secondary",
                  item.approved_questions < 40 && "border-destructive-border bg-destructive-bg-subtle text-destructive",
                )}
              >
                Fragen: {item.approved_questions}
              </div>
              <div
                className={cn(
                  "rounded-lg border border-border-subtle p-2 text-text-secondary",
                  item.lessons_count === 0 && "border-destructive-border bg-destructive-bg-subtle text-destructive",
                )}
              >
                Lessons: {item.lessons_count}
              </div>
              <div
                className={cn(
                  "rounded-lg border border-border-subtle p-2 text-text-secondary",
                  item.tutor_index_count === 0 && "border-warning-border bg-warning-bg-subtle text-warning",
                )}
              >
                Tutor: {item.tutor_index_count}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Button size="sm" variant="outline" onClick={() => open(`/courses`)}>
                Kurs
              </Button>
              <Button size="sm" variant="outline" onClick={() => open(`/exam-trainer?curriculum=${item.curriculum_id}`)}>
                Prüfung
              </Button>
              <Button size="sm" variant="outline" onClick={() => open(`/app/oral?curriculum=${item.curriculum_id}`)}>
                Tutor
              </Button>
              <Button size="sm" onClick={() => open(`/exam-trainer?curriculum=${item.curriculum_id}`)}>
                Adaptive
              </Button>
            </div>
          </Card>
        ))}

        {data.length === 0 && (
          <Card variant="sunken" className="rounded-xl p-4 text-sm text-text-secondary">
            Keine Kurse in der Auto-Test-Queue.
          </Card>
        )}
      </div>
    </Card>
  );
}
