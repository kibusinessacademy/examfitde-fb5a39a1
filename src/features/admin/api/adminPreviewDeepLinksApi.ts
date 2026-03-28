import { supabase } from "@/integrations/supabase/client";

export type AdminPreviewDeepLinks = {
  curriculum_id: string;
  course_id: string | null;
  module_id: string | null;
  lesson_id: string | null;
  minicheck_lesson_id: string | null;
  blueprint_id: string | null;
  course_url: string | null;
  lesson_url: string | null;
  minicheck_url: string | null;
  exam_url: string;
  adaptive_exam_url: string;
  oral_exam_url: string;
  tutor_url: string;
  dashboard_url: string;
};

export async function getAdminPreviewDeepLinks(curriculumId: string) {
  const { data, error } = await supabase.rpc(
    "get_admin_course_preview_deep_links" as any,
    { p_curriculum_id: curriculumId }
  );

  if (error) {
    throw new Error(error.message || "Deep Links konnten nicht geladen werden.");
  }

  return data as AdminPreviewDeepLinks;
}
