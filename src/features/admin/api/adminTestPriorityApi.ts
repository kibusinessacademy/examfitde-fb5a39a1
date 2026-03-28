import { supabase } from "@/integrations/supabase/client";

export type AdminCourseTestPriority = {
  package_id: string;
  curriculum_id: string;
  title: string;
  status: string;
  integrity_passed: boolean;
  council_approved: boolean;
  approved_questions: number;
  lessons_count: number;
  tutor_index_count: number;
  updated_at: string;
  published_at: string | null;
  test_priority: "critical" | "warning" | "healthy";
  reason_codes: string[];
};

export async function getAdminCourseTestPriority() {
  const { data, error } = await supabase.rpc(
    "get_admin_course_test_priority" as any
  );

  if (error) {
    throw new Error(error.message || "Test-Priorisierung konnte nicht geladen werden.");
  }

  return (data ?? []) as AdminCourseTestPriority[];
}
