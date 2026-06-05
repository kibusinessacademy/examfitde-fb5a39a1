/**
 * resolveDashboardNextStep — SSOT regression tests.
 *
 * The Customer Reality Gate asserts that /dashboard NEVER renders without
 * a primary CTA. These tests pin every branch of the deterministic
 * resolver. Adding a new branch? Add a test. Changing a `kind`? Update
 * Reality-Gate + analytics dashboards at the same time.
 */
import { describe, it, expect } from "vitest";
import {
  resolveDashboardNextStep,
  type ResolverEnrollment,
  type ResolverInput,
} from "../resolveDashboardNextStep";

const enr = (over: Partial<ResolverEnrollment> = {}): ResolverEnrollment => ({
  course_id: "c-1",
  title: "FIAE Prüfungsvorbereitung",
  total_lessons: 10,
  completed_lessons: 0,
  ...over,
});

const baseInput = (over: Partial<ResolverInput> = {}): ResolverInput => ({
  enrollments: [],
  activeCurriculumId: null,
  ...over,
});

describe("resolveDashboardNextStep — totality", () => {
  it("never returns null / empty label / empty to for the empty cold-start case", () => {
    const step = resolveDashboardNextStep(baseInput());
    expect(step).toBeTruthy();
    expect(step.label.length).toBeGreaterThan(0);
    expect(step.to.startsWith("/")).toBe(true);
    expect(step.rationale.length).toBeGreaterThan(0);
  });

  it("always returns a valid kind even when only partial data exists", () => {
    const cases: ResolverInput[] = [
      baseInput(),
      baseInput({ activeCurriculumId: "cur-1" }),
      baseInput({ enrollments: [enr({ completed_lessons: 3 })] }),
      baseInput({
        enrollments: [enr({ completed_lessons: 10, total_lessons: 10 })],
        activeCurriculumId: "cur-1",
      }),
      baseInput({ licenseMissing: true }),
    ];
    for (const c of cases) {
      const step = resolveDashboardNextStep(c);
      expect(step.kind).toMatch(
        /^(open_minicheck|resume_course|continue_curriculum|simulate_exam|weakest_competency|onboarding_minicheck|choose_beruf)$/,
      );
    }
  });
});

describe("resolveDashboardNextStep — hierarchy", () => {
  it("1. open MiniCheck wins over everything else", () => {
    const step = resolveDashboardNextStep(
      baseInput({
        enrollments: [enr({ completed_lessons: 3 })],
        activeCurriculumId: "cur-1",
        openMiniCheck: { curriculumId: "cur-1", sessionId: "s-7" },
      }),
    );
    expect(step.kind).toBe("open_minicheck");
    expect(step.to).toBe("/minicheck/s-7");
  });

  it("2. course in progress → resume_course", () => {
    const step = resolveDashboardNextStep(
      baseInput({
        enrollments: [enr({ completed_lessons: 4, total_lessons: 10 })],
      }),
    );
    expect(step.kind).toBe("resume_course");
    expect(step.to).toBe("/course/c-1");
    expect(step.rationale).toMatch(/FIAE/);
  });

  it("2a. enrollment with total_lessons=0 (no telemetry yet) still resumes", () => {
    const step = resolveDashboardNextStep(
      baseInput({ enrollments: [enr({ total_lessons: 0, completed_lessons: 0 })] }),
    );
    expect(step.kind).toBe("resume_course");
  });

  it("3. course finished + activeCurriculum → continue_curriculum", () => {
    const step = resolveDashboardNextStep(
      baseInput({
        enrollments: [enr({ completed_lessons: 10, total_lessons: 10 })],
        activeCurriculumId: "cur-1",
      }),
    );
    expect(step.kind).toBe("continue_curriculum");
    expect(step.to).toBe("/courses");
  });

  it("4. course finished + no curriculum → simulate_exam (not a dead-end)", () => {
    const step = resolveDashboardNextStep(
      baseInput({
        enrollments: [enr({ completed_lessons: 10, total_lessons: 10 })],
        activeCurriculumId: null,
      }),
    );
    expect(step.kind).toBe("simulate_exam");
    expect(step.to).toBe("/exam-simulation");
  });

  it("5. weakest competency signal (no enrollment, no curriculum) → mastery", () => {
    const step = resolveDashboardNextStep(
      baseInput({
        weakestCompetency: { competencyId: "comp-9", label: "Rechnungswesen" },
      }),
    );
    expect(step.kind).toBe("weakest_competency");
    expect(step.to).toBe("/mastery/comp-9");
    expect(step.label).toMatch(/Rechnungswesen/);
  });

  it("6. activeCurriculum without enrollment → onboarding_minicheck", () => {
    const step = resolveDashboardNextStep(
      baseInput({ activeCurriculumId: "cur-1" }),
    );
    expect(step.kind).toBe("onboarding_minicheck");
    expect(step.to).toBe("/minicheck?curriculum=cur-1");
  });

  it("7. cold-empty → choose_beruf (never an empty dashboard)", () => {
    const step = resolveDashboardNextStep(baseInput());
    expect(step.kind).toBe("choose_beruf");
    expect(step.to).toBe("/berufe");
  });

  it("7a. licenseMissing AND no enrollment AND no curriculum → choose_beruf", () => {
    const step = resolveDashboardNextStep(baseInput({ licenseMissing: true }));
    expect(step.kind).toBe("choose_beruf");
  });

  it("7b. licenseMissing must NOT hijack a learner who is already in a course", () => {
    // Edge case: stale licenseMissing signal arriving after a paid course
    // was already granted. The in-progress course must still win.
    const step = resolveDashboardNextStep(
      baseInput({
        enrollments: [enr({ completed_lessons: 2 })],
        licenseMissing: true,
      }),
    );
    expect(step.kind).toBe("resume_course");
  });
});

describe("resolveDashboardNextStep — Reality-Gate contract", () => {
  it("every kind has a stable, route-prefixed `to`", () => {
    const samples: ResolverInput[] = [
      baseInput(),
      baseInput({ activeCurriculumId: "cur-1" }),
      baseInput({ enrollments: [enr({ completed_lessons: 1 })] }),
      baseInput({
        enrollments: [enr({ completed_lessons: 10, total_lessons: 10 })],
      }),
      baseInput({
        openMiniCheck: { curriculumId: "cur-1" },
      }),
      baseInput({
        weakestCompetency: { competencyId: "comp-1" },
      }),
    ];
    for (const s of samples) {
      const step = resolveDashboardNextStep(s);
      expect(step.to).toMatch(/^\/(berufe|course|courses|minicheck|exam-simulation|mastery)(\/|\?|$)/);
    }
  });

  it("primary enrollment selection prefers in-progress over finished", () => {
    const step = resolveDashboardNextStep(
      baseInput({
        enrollments: [
          enr({ course_id: "c-old", completed_lessons: 10, total_lessons: 10 }),
          enr({ course_id: "c-new", completed_lessons: 1, total_lessons: 5 }),
        ],
      }),
    );
    expect(step.kind).toBe("resume_course");
    expect(step.to).toBe("/course/c-new");
  });
});
