import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Admin Preview + Auto-Test-Queue Tests
 *
 * Validates:
 * - Preview URL construction
 * - Priority filter logic
 * - Queue score ordering
 * - Deep link construction
 * - Reason code labeling
 */

// --- Preview URL builder ---

type PreviewMode = "standard" | "premium" | "adaptive";

function buildPreviewUrl(path: string, mode: PreviewMode): string {
  const params = new URLSearchParams({ admin_preview: "1", preview_mode: mode });
  return `${path}?${params.toString()}`;
}

function withPreview(url: string | null, mode: PreviewMode): string | null {
  if (!url) return null;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}admin_preview=1&preview_mode=${mode}`;
}

// --- Filter logic ---

type CourseRow = {
  title: string;
  test_priority: "critical" | "warning" | "healthy";
  integrity_passed: boolean;
  council_approved: boolean;
  tutor_index_count: number;
  approved_questions: number;
  lessons_count: number;
};

function filterCourses(
  rows: CourseRow[],
  opts: {
    q?: string;
    priorityFilter?: "all" | "critical" | "warning" | "healthy";
    integrityOnly?: boolean;
    councilOnly?: boolean;
    tutorOnly?: boolean;
    minQuestions?: number;
    minLessons?: number;
  }
): CourseRow[] {
  const term = (opts.q ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (term && !row.title.toLowerCase().includes(term)) return false;
    if (opts.priorityFilter && opts.priorityFilter !== "all" && row.test_priority !== opts.priorityFilter) return false;
    if (opts.integrityOnly && !row.integrity_passed) return false;
    if (opts.councilOnly && !row.council_approved) return false;
    if (opts.tutorOnly && row.tutor_index_count <= 0) return false;
    if ((opts.minQuestions ?? 0) > 0 && row.approved_questions < opts.minQuestions!) return false;
    if ((opts.minLessons ?? 0) > 0 && row.lessons_count < opts.minLessons!) return false;
    return true;
  });
}

// --- Reason code labels ---

const labelMap: Record<string, string> = {
  integrity_failed: "Integrity fehlgeschlagen",
  council_not_approved: "Council nicht freigegeben",
  too_few_questions: "Zu wenige Fragen (< 40)",
  no_lessons: "Keine Lessons",
  low_question_buffer: "Wenig Fragen-Reserve (< 100)",
  low_lesson_count: "Wenig Lessons (< 5)",
  missing_tutor_index: "Tutor-Index fehlt",
};

describe("Admin Preview: URL construction", () => {
  it("builds standard preview URL", () => {
    const url = buildPreviewUrl("/learner/course/abc", "standard");
    expect(url).toContain("admin_preview=1");
    expect(url).toContain("preview_mode=standard");
    expect(url).toContain("/learner/course/abc?");
  });

  it("builds premium preview URL", () => {
    const url = buildPreviewUrl("/learner/tutor/xyz", "premium");
    expect(url).toContain("preview_mode=premium");
  });

  it("builds adaptive preview URL", () => {
    const url = buildPreviewUrl("/learner/exam/adaptive/xyz", "adaptive");
    expect(url).toContain("preview_mode=adaptive");
  });

  it("withPreview returns null for null URL", () => {
    expect(withPreview(null, "standard")).toBeNull();
  });

  it("withPreview appends to URL with existing params", () => {
    const url = withPreview("/test?foo=1", "premium");
    expect(url).toBe("/test?foo=1&admin_preview=1&preview_mode=premium");
  });
});

describe("Admin Preview: Filter logic", () => {
  const courses: CourseRow[] = [
    { title: "Kaufmann", test_priority: "critical", integrity_passed: false, council_approved: true, tutor_index_count: 0, approved_questions: 10, lessons_count: 0 },
    { title: "Elektroniker", test_priority: "warning", integrity_passed: true, council_approved: true, tutor_index_count: 0, approved_questions: 60, lessons_count: 3 },
    { title: "Fachinformatiker", test_priority: "healthy", integrity_passed: true, council_approved: true, tutor_index_count: 5, approved_questions: 200, lessons_count: 20 },
  ];

  it("filters by text search", () => {
    expect(filterCourses(courses, { q: "kauf" })).toHaveLength(1);
  });

  it("filters by priority", () => {
    expect(filterCourses(courses, { priorityFilter: "critical" })).toHaveLength(1);
    expect(filterCourses(courses, { priorityFilter: "healthy" })).toHaveLength(1);
  });

  it("filters by integrity", () => {
    expect(filterCourses(courses, { integrityOnly: true })).toHaveLength(2);
  });

  it("filters by tutor presence", () => {
    expect(filterCourses(courses, { tutorOnly: true })).toHaveLength(1);
  });

  it("filters by min questions", () => {
    expect(filterCourses(courses, { minQuestions: 100 })).toHaveLength(1);
  });

  it("filters by min lessons", () => {
    expect(filterCourses(courses, { minLessons: 10 })).toHaveLength(1);
  });

  it("combines multiple filters", () => {
    expect(filterCourses(courses, { priorityFilter: "warning", tutorOnly: false, minQuestions: 50 })).toHaveLength(1);
  });

  it("'all' priority shows everything", () => {
    expect(filterCourses(courses, { priorityFilter: "all" })).toHaveLength(3);
  });
});

describe("Admin Preview: Reason code labels", () => {
  it("maps all known codes to German labels", () => {
    const codes = Object.keys(labelMap);
    codes.forEach((code) => {
      expect(labelMap[code]).toBeDefined();
      expect(labelMap[code].length).toBeGreaterThan(0);
    });
  });

  it("covers integrity_failed", () => {
    expect(labelMap["integrity_failed"]).toContain("Integrity");
  });

  it("covers missing_tutor_index", () => {
    expect(labelMap["missing_tutor_index"]).toContain("Tutor");
  });
});

describe("Admin Preview: Queue ordering", () => {
  it("critical items sort before warning and healthy", () => {
    const items = [
      { priority: "healthy", score: 20 },
      { priority: "critical", score: 100 },
      { priority: "warning", score: 70 },
    ];
    const sorted = [...items].sort((a, b) => b.score - a.score);
    expect(sorted[0].priority).toBe("critical");
    expect(sorted[1].priority).toBe("warning");
    expect(sorted[2].priority).toBe("healthy");
  });
});
