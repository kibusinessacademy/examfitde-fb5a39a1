import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LessonStatus = "not_started" | "in_progress" | "not_mastered" | "partial" | "mastered";

export interface LessonProgress {
  lesson_id: string;
  lesson_title: string;
  module_id: string;
  module_title: string;
  module_order: number;
  lesson_order: number;
  competency_code: string | null;
  competency_title: string | null;
  status: LessonStatus;
  score_percent: number | null;
  needs_review: boolean;
  attempts: number | null;
  last_attempt_at: string | null;
  has_minicheck: boolean;
}

export interface CourseProgressSummary {
  total_lessons: number;
  mastered: number;
  partial: number;
  not_mastered: number;
  in_progress: number;
  not_started: number;
  needs_review: number;
  with_minicheck: number;
  avg_score: number | null;
}

export interface CourseProgress {
  course_id: string;
  user_id: string;
  summary: CourseProgressSummary;
  progress_percent: number;
  last_activity: {
    lesson_id: string;
    lesson_title: string;
    module_title: string;
    last_attempt_at: string;
    status: LessonStatus;
  } | null;
  next_lesson: {
    lesson_id: string;
    lesson_title: string;
    module_title: string;
  } | null;
  lessons: LessonProgress[];
}

export function useCourseProgress(courseId: string | undefined) {
  return useQuery({
    queryKey: ["course-progress", courseId],
    queryFn: async (): Promise<CourseProgress | null> => {
      if (!courseId) return null;

      const { data, error } = await supabase.rpc("get_course_progress", {
        p_course_id: courseId,
      });

      if (error) throw error;
      return data as unknown as CourseProgress;
    },
    enabled: !!courseId,
    staleTime: 30_000,
  });
}

export function useStartLesson() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (lessonId: string) => {
      const { data, error } = await supabase.rpc("start_lesson", {
        p_lesson_id: lessonId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course-progress"] });
    },
  });
}

export function useUpdateLessonOutcome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      lessonId,
      scorePercent,
    }: {
      lessonId: string;
      scorePercent: number;
    }) => {
      const { data, error } = await supabase.rpc("update_lesson_outcome", {
        p_lesson_id: lessonId,
        p_score_percent: scorePercent,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course-progress"] });
    },
  });
}

export function useLessonsNeedingReview(courseId?: string) {
  return useQuery({
    queryKey: ["lessons-needing-review", courseId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_lessons_needing_review", {
        p_course_id: courseId ?? undefined as any,
      });
      if (error) throw error;
      return data as Array<{
        lesson_id: string;
        lesson_title: string;
        module_title: string;
        competency_title: string | null;
        score_percent: number;
        attempts: number;
        last_attempt_at: string;
      }>;
    },
    staleTime: 60_000,
  });
}

// Helper to get status color
export function getStatusColor(status: LessonStatus): string {
  switch (status) {
    case "mastered":
      return "text-green-500";
    case "partial":
      return "text-yellow-500";
    case "not_mastered":
      return "text-red-500";
    case "in_progress":
      return "text-blue-500";
    default:
      return "text-muted-foreground";
  }
}

export function getStatusBgColor(status: LessonStatus): string {
  switch (status) {
    case "mastered":
      return "bg-green-500/10 border-green-500/30";
    case "partial":
      return "bg-yellow-500/10 border-yellow-500/30";
    case "not_mastered":
      return "bg-red-500/10 border-red-500/30";
    case "in_progress":
      return "bg-blue-500/10 border-blue-500/30";
    default:
      return "bg-muted/50 border-border";
  }
}

export function getStatusLabel(status: LessonStatus): string {
  switch (status) {
    case "mastered":
      return "Gemeistert";
    case "partial":
      return "Teilweise";
    case "not_mastered":
      return "Nicht bestanden";
    case "in_progress":
      return "Begonnen";
    default:
      return "Nicht begonnen";
  }
}

export function getStatusIcon(status: LessonStatus): string {
  switch (status) {
    case "mastered":
      return "✓";
    case "partial":
      return "◐";
    case "not_mastered":
      return "✗";
    case "in_progress":
      return "▶";
    default:
      return "○";
  }
}
