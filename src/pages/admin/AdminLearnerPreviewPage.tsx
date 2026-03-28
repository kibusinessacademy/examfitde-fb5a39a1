import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  GraduationCap,
  Search,
  BookOpen,
  FileQuestion,
  Brain,
  Sparkles,
  LayoutDashboard,
} from "lucide-react";
import { getAdminCourseTestPriority } from "@/features/admin/api/adminTestPriorityApi";
import { getAdminCourseTestRunLatest } from "@/features/admin/api/adminCourseTestRunsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminPreviewQuickLinksCard } from "@/features/admin/components/AdminPreviewQuickLinksCard";
import { AdminAutoTestQueue } from "@/features/admin/components/AdminAutoTestQueue";
import { TestPriorityBadge } from "@/features/admin/components/TestPriorityBadge";
import { TestPriorityReasons } from "@/features/admin/components/TestPriorityReasons";
import { CourseTestStatusBadge } from "@/features/admin/components/CourseTestStatusBadge";
import { AdminCourseQAActions } from "@/features/admin/components/AdminCourseQAActions";
import { AdminCourseQAHistory } from "@/features/admin/components/AdminCourseQAHistory";
import { AdminAutoHealQueue } from "@/features/admin/components/AdminAutoHealQueue";

type PreviewMode = "standard" | "premium" | "adaptive";

function buildPreviewUrl(path: string, mode: PreviewMode) {
  const params = new URLSearchParams({
    admin_preview: "1",
    preview_mode: mode,
  });
  return `${path}?${params.toString()}`;
}

function TestPrioritySummary({ items }: { items: { test_priority: string }[] }) {
  const critical = items.filter((i) => i.test_priority === "critical").length;
  const warning = items.filter((i) => i.test_priority === "warning").length;
  const healthy = items.filter((i) => i.test_priority === "healthy").length;

  return (
    <div className="grid gap-3 grid-cols-3">
      <div className="rounded-2xl border bg-card p-4">
        <div className="text-xs text-muted-foreground">🔴 Kritisch</div>
        <div className="text-2xl font-semibold">{critical}</div>
      </div>
      <div className="rounded-2xl border bg-card p-4">
        <div className="text-xs text-muted-foreground">🟡 Aufmerksam</div>
        <div className="text-2xl font-semibold">{warning}</div>
      </div>
      <div className="rounded-2xl border bg-card p-4">
        <div className="text-xs text-muted-foreground">🟢 Stabil</div>
        <div className="text-2xl font-semibold">{healthy}</div>
      </div>
    </div>
  );
}

export default function AdminLearnerPreviewPage() {
  const [q, setQ] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("standard");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "critical" | "warning" | "healthy">("all");
  const [integrityOnly, setIntegrityOnly] = useState(false);
  const [councilOnly, setCouncilOnly] = useState(false);
  const [tutorOnly, setTutorOnly] = useState(false);
  const [minQuestions, setMinQuestions] = useState(0);
  const [minLessons, setMinLessons] = useState(0);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin-course-test-priority"],
    queryFn: getAdminCourseTestPriority,
    staleTime: 60_000,
  });

  const { data: latestRuns = [] } = useQuery({
    queryKey: ["admin-course-test-run-latest"],
    queryFn: getAdminCourseTestRunLatest,
    staleTime: 30_000,
  });

  const latestRunMap = useMemo(() => {
    const map = new Map<string, (typeof latestRuns)[number]>();
    for (const row of latestRuns) map.set(row.package_id, row);
    return map;
  }, [latestRuns]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.filter((row) => {
      if (term && !row.title.toLowerCase().includes(term)) return false;
      if (priorityFilter !== "all" && row.test_priority !== priorityFilter) return false;
      if (integrityOnly && !row.integrity_passed) return false;
      if (councilOnly && !row.council_approved) return false;
      if (tutorOnly && (row.tutor_index_count ?? 0) <= 0) return false;
      if ((row.approved_questions ?? 0) < minQuestions) return false;
      if ((row.lessons_count ?? 0) < minLessons) return false;
      return true;
    });
  }, [data, q, priorityFilter, integrityOnly, councilOnly, tutorOnly, minQuestions, minLessons]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Learner Preview</h1>
        <p className="text-muted-foreground mt-1">
          Teste alle published Kurse vollständig aus Learner-Sicht.
        </p>
      </div>

      {/* Summary */}
      {!isLoading && data.length > 0 && <TestPrioritySummary items={data} />}

      {/* Auto-Test Queue */}
      <AdminAutoTestQueue previewMode={previewMode} limit={10} />

      {/* Auto-Heal Queue */}
      <AdminAutoHealQueue />

      {/* Search + Filters */}
      <div className="rounded-2xl border bg-card p-4 space-y-4">
        <div className="flex items-center gap-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Kurs suchen..."
            className="border-0 p-0 focus-visible:ring-0"
          />
        </div>

        {/* Preview Mode */}
        <div className="flex flex-wrap gap-2">
          <Button variant={previewMode === "standard" ? "default" : "outline"} size="sm" onClick={() => setPreviewMode("standard")}>
            Standard
          </Button>
          <Button variant={previewMode === "premium" ? "default" : "outline"} size="sm" onClick={() => setPreviewMode("premium")}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />Premium
          </Button>
          <Button variant={previewMode === "adaptive" ? "default" : "outline"} size="sm" onClick={() => setPreviewMode("adaptive")}>
            Adaptive
          </Button>
        </div>

        {/* Priority Filter */}
        <div className="flex flex-wrap gap-2">
          {(["all", "critical", "warning", "healthy"] as const).map((p) => (
            <Button key={p} variant={priorityFilter === p ? "default" : "outline"} size="sm" onClick={() => setPriorityFilter(p)}>
              {p === "all" ? "Alle" : p === "critical" ? "🔴 Kritisch" : p === "warning" ? "🟡 Aufmerksam" : "🟢 Stabil"}
            </Button>
          ))}
        </div>

        {/* Quality Filters */}
        <div className="flex flex-wrap gap-2">
          <Button variant={integrityOnly ? "default" : "outline"} size="sm" onClick={() => setIntegrityOnly((v) => !v)}>
            Integrity ✓
          </Button>
          <Button variant={councilOnly ? "default" : "outline"} size="sm" onClick={() => setCouncilOnly((v) => !v)}>
            Council ✓
          </Button>
          <Button variant={tutorOnly ? "default" : "outline"} size="sm" onClick={() => setTutorOnly((v) => !v)}>
            Tutor vorhanden
          </Button>
        </div>

        {/* Numeric Filters */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground mb-1.5">Min. Fragen</div>
            <Input type="number" value={minQuestions} onChange={(e) => setMinQuestions(Number(e.target.value || 0))} className="h-8" />
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground mb-1.5">Min. Lessons</div>
            <Input type="number" value={minLessons} onChange={(e) => setMinLessons(Number(e.target.value || 0))} className="h-8" />
          </div>
        </div>
      </div>

      {isLoading && <div className="rounded-2xl border p-6 text-muted-foreground">Lade published Kurse…</div>}
      {error && <div className="rounded-2xl border border-destructive/30 p-6 text-destructive">Fehler beim Laden.</div>}

      <div className="text-sm text-muted-foreground">{filtered.length} Kurse sichtbar</div>

      {/* Course Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((course) => {
          const isExpanded = expandedCard === course.package_id;
          const latestRun = latestRunMap.get(course.package_id);

          return (
            <div key={course.package_id} className="rounded-2xl border bg-card p-5 space-y-4">
              {/* Header with priority + QA status */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-semibold truncate">{course.title}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{course.package_id}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <TestPriorityBadge priority={course.test_priority} />
                  <CourseTestStatusBadge status={latestRun?.test_status ?? null} />
                </div>
              </div>

              {/* Reason codes */}
              <TestPriorityReasons reasons={course.reason_codes} />

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-xl border p-3">
                  <div className="text-muted-foreground flex items-center gap-1 text-xs">
                    <BookOpen className="h-3.5 w-3.5" /> Lessons
                  </div>
                  <div className={`font-medium ${course.lessons_count === 0 ? "text-destructive" : ""}`}>{course.lessons_count}</div>
                </div>
                <div className="rounded-xl border p-3">
                  <div className="text-muted-foreground flex items-center gap-1 text-xs">
                    <FileQuestion className="h-3.5 w-3.5" /> Fragen
                  </div>
                  <div className={`font-medium ${course.approved_questions < 40 ? "text-destructive" : ""}`}>{course.approved_questions}</div>
                </div>
                <div className="rounded-xl border p-3">
                  <div className="text-muted-foreground flex items-center gap-1 text-xs">
                    <Brain className="h-3.5 w-3.5" /> Tutor
                  </div>
                  <div className={`font-medium ${course.tutor_index_count === 0 ? "text-amber-500" : ""}`}>{course.tutor_index_count}</div>
                </div>
              </div>

              {/* Quality Badges */}
              <div className="flex flex-wrap gap-1.5 text-xs">
                <span className={`rounded-full border px-2 py-0.5 ${course.integrity_passed ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
                  Integrity {course.integrity_passed ? "✅" : "❌"}
                </span>
                <span className={`rounded-full border px-2 py-0.5 ${course.council_approved ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
                  Council {course.council_approved ? "✅" : "❌"}
                </span>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={() => window.open(buildPreviewUrl(`/learner/course/${course.curriculum_id}`, previewMode), "_blank")}>
                  <GraduationCap className="mr-1.5 h-3.5 w-3.5" />Kurs
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.open(buildPreviewUrl(`/learner/exam/${course.curriculum_id}`, previewMode), "_blank")}>
                  Prüfung
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.open(buildPreviewUrl(`/learner/oral-exam/${course.curriculum_id}`, previewMode), "_blank")}>
                  Oral
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.open(buildPreviewUrl(`/learner/tutor/${course.curriculum_id}`, previewMode), "_blank")}>
                  <Brain className="mr-1.5 h-3.5 w-3.5" />Tutor
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.open(buildPreviewUrl(`/learner/dashboard/${course.curriculum_id}`, previewMode), "_blank")}>
                  <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" />Dashboard
                </Button>
                <Button size="sm" onClick={() => window.open(buildPreviewUrl(`/learner/exam/adaptive/${course.curriculum_id}`, "adaptive"), "_blank")}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />Adaptive
                </Button>
              </div>

              {/* QA Actions */}
              <AdminCourseQAActions packageId={course.package_id} curriculumId={course.curriculum_id} />

              {/* Expandable Quick Links + QA History */}
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setExpandedCard(isExpanded ? null : course.package_id)}>
                {isExpanded ? "Details ausblenden" : "Quick Links & QA-Historie"}
              </Button>
              {isExpanded && (
                <>
                  <AdminPreviewQuickLinksCard curriculumId={course.curriculum_id} previewMode={previewMode} />
                  <AdminCourseQAHistory packageId={course.package_id} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
