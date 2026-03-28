import { supabase } from "@/integrations/supabase/client";

export type AdminCourseTestRunLatest = {
  package_id: string;
  curriculum_id: string;
  tested_by: string;
  test_status: "tested" | "issue_found" | "approved";
  notes: string | null;
  issue_codes: string[];
  created_at: string;
};

export type AdminCourseTestRunHistoryItem = {
  id: string;
  package_id: string;
  curriculum_id: string;
  tested_by: string;
  test_status: "tested" | "issue_found" | "approved";
  notes: string | null;
  issue_codes: string[];
  created_at: string;
};

export async function recordAdminCourseTestRun(params: {
  packageId: string;
  curriculumId: string;
  testStatus: "tested" | "issue_found" | "approved";
  notes?: string;
  issueCodes?: string[];
}) {
  const { data, error } = await supabase.rpc(
    "record_admin_course_test_run" as any,
    {
      p_package_id: params.packageId,
      p_curriculum_id: params.curriculumId,
      p_test_status: params.testStatus,
      p_notes: params.notes ?? null,
      p_issue_codes: params.issueCodes ?? [],
    }
  );

  if (error) {
    throw new Error(error.message || "QA-Testlauf konnte nicht gespeichert werden.");
  }

  return data as string;
}

export async function getAdminCourseTestRunLatest() {
  const { data, error } = await supabase.rpc(
    "get_admin_course_test_run_latest" as any
  );

  if (error) {
    throw new Error(error.message || "Letzte QA-Statusdaten konnten nicht geladen werden.");
  }

  return (data ?? []) as AdminCourseTestRunLatest[];
}

export async function getAdminCourseTestRunHistory(packageId: string) {
  const { data, error } = await supabase.rpc(
    "get_admin_course_test_run_history" as any,
    { p_package_id: packageId }
  );

  if (error) {
    throw new Error(error.message || "QA-Historie konnte nicht geladen werden.");
  }

  return (data ?? []) as AdminCourseTestRunHistoryItem[];
}
