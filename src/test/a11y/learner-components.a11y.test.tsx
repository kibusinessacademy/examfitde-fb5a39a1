import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe, toHaveNoViolations } from "jest-axe";
import { ContinueLearningCard } from "@/components/course/ContinueLearningCard";
import { ModuleLessonList } from "@/components/course/ModuleLessonList";
import LessonHeader from "@/components/lesson/LessonHeader";

expect.extend(toHaveNoViolations);

const wrap = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

const fakeProgress = {
  course_id: "c1",
  total_lessons: 10,
  completed_lessons: 4,
  in_progress_lessons: 1,
  progress_percent: 40,
  summary: {
    not_started: 5,
    in_progress: 1,
    completed: 4,
    needs_review: 1,
  },
  next_lesson: {
    lesson_id: "l1",
    lesson_title: "Nächste Lektion",
    module_id: "m1",
    module_title: "Modul 1",
  },
  last_activity: { lesson_id: "l0", lesson_title: "Vorherige Lektion", completed_at: null },
} as any;

const fakeModules = [
  { id: "m1", title: "Modul 1", description: "Beschreibung", sort_order: 1 },
];
const fakeLessons = [
  { id: "l1", title: "Lesson 1", step: "einstieg", duration_minutes: 10, module_id: "m1", sort_order: 1 },
  { id: "l2", title: "Lesson 2", step: "verstehen", duration_minutes: 12, module_id: "m1", sort_order: 2 },
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
      wrap(
        <ModuleLessonList
          modules={fakeModules as any}
          lessons={fakeLessons as any}
          isEnrolled={true}
        />
      )
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("LessonHeader has no a11y violations", async () => {
    const { container } = render(
      wrap(
        <LessonHeader
          courseId="c1"
          courseTitle="Test Kurs"
          moduleTitle="Modul 1"
          progress={40}
          currentIndex={2}
          totalLessons={5}
        />
      )
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
