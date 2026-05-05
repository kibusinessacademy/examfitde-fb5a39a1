import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe, toHaveNoViolations } from "jest-axe";
import { ContinueLearningCard } from "@/components/course/ContinueLearningCard";
import { ModuleLessonList } from "@/components/course/ModuleLessonList";
import { LessonHeader } from "@/components/lesson/LessonHeader";

expect.extend(toHaveNoViolations);

const wrap = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

const fakeProgress = {
  course_id: "c1",
  total_lessons: 10,
  completed_lessons: 4,
  in_progress_lessons: 1,
  progress_percent: 40,
  next_lesson: { lesson_id: "l1", lesson_title: "Nächste Lektion", module_id: "m1" },
  last_activity: { lesson_id: "l0", lesson_title: "Vorherige Lektion", completed_at: null },
} as any;

const fakeModules = [
  {
    id: "m1",
    title: "Modul 1",
    description: "Beschreibung",
    sort_order: 1,
    lessons: [
      { id: "l1", title: "Lesson 1", sort_order: 1, status: "not_started" as const, locked: false },
      { id: "l2", title: "Lesson 2", sort_order: 2, status: "completed" as const, locked: false },
    ],
  },
];

describe("A11y regression: Learner components", () => {
  it("ContinueLearningCard has no a11y violations", async () => {
    const { container } = render(
      wrap(<ContinueLearningCard courseId="c1" courseTitle="Test Kurs" progress={fakeProgress} />)
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("ModuleLessonList has no a11y violations", async () => {
    const { container } = render(
      wrap(<ModuleLessonList courseId="c1" modules={fakeModules as any} />)
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("LessonHeader has no a11y violations", async () => {
    const { container } = render(
      wrap(
        <LessonHeader
          courseId="c1"
          courseTitle="Test Kurs"
          lessonTitle="Lektion A"
          currentIndex={1}
          totalLessons={5}
          prevLessonId={null}
          nextLessonId="l2"
        />
      )
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
