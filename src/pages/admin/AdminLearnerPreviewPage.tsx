import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, GraduationCap, BookOpen, Brain, FileQuestion } from "lucide-react";
import { getAdminPublishedCoursePreview } from "@/features/admin/api/adminPreviewApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AdminLearnerPreviewPage() {
  const [q, setQ] = useState("");

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin-published-course-preview"],
    queryFn: getAdminPublishedCoursePreview,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return data;
    return data.filter((row) =>
      row.title.toLowerCase().includes(term)
    );
  }, [data, q]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Learner Preview</h1>
        <p className="text-muted-foreground mt-1">
          Teste alle published Kurse vollständig aus Learner-Sicht.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border p-4">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Kurs suchen..."
          className="border-0 p-0 focus-visible:ring-0"
        />
      </div>

      {isLoading && (
        <div className="rounded-2xl border p-6 text-muted-foreground">
          Lade published Kurse…
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-destructive/30 p-6 text-destructive">
          Fehler beim Laden.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((course) => (
          <div
            key={course.package_id}
            className="rounded-2xl border bg-card p-5 space-y-4"
          >
            <div>
              <div className="text-lg font-semibold">{course.title}</div>
              <div className="text-xs text-muted-foreground font-mono truncate">
                {course.package_id}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-xl border p-3">
                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                  <BookOpen className="h-3.5 w-3.5" /> Lessons
                </div>
                <div className="font-medium">{course.lessons_count}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                  <FileQuestion className="h-3.5 w-3.5" /> Fragen
                </div>
                <div className="font-medium">{course.approved_questions}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Brain className="h-3.5 w-3.5" /> Tutor
                </div>
                <div className="font-medium">{course.tutor_index_count}</div>
              </div>
            </div>

            <div className="text-sm space-y-1">
              <div>Integrity: {course.integrity_passed ? "✅" : "❌"}</div>
              <div>Council: {course.council_approved ? "✅" : "❌"}</div>
              <div>Status: <span className="font-medium">{course.status}</span></div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(
                    `/learner/course/${course.curriculum_id}?admin_preview=1`,
                    "_blank"
                  )
                }
              >
                <GraduationCap className="mr-1.5 h-3.5 w-3.5" />
                Kurs
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(
                    `/learner/exam/${course.curriculum_id}?admin_preview=1`,
                    "_blank"
                  )
                }
              >
                Prüfung
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(
                    `/learner/oral-exam/${course.curriculum_id}?admin_preview=1`,
                    "_blank"
                  )
                }
              >
                Oral
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  window.open(
                    `/learner/tutor/${course.curriculum_id}?admin_preview=1`,
                    "_blank"
                  )
                }
              >
                Tutor
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
