import { supabase } from "@/integrations/supabase/client";

export type AdminPublishedCoursePreview = {
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
};

export async function getAdminPublishedCoursePreview() {
  const { data, error } = await supabase.rpc(
    "get_admin_published_course_preview" as any
  );

  if (error) {
    throw new Error(
      error.message || "Published Kurse konnten nicht geladen werden."
    );
  }

  return (data ?? []) as AdminPublishedCoursePreview[];
}
