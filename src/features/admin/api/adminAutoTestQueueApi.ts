import { supabase } from "@/integrations/supabase/client";

export type AdminAutoTestQueueItem = {
  package_id: string;
  curriculum_id: string;
  title: string;
  test_priority: "critical" | "warning" | "healthy";
  reason_codes: string[];
  integrity_passed: boolean;
  council_approved: boolean;
  approved_questions: number;
  lessons_count: number;
  tutor_index_count: number;
  updated_at: string;
  published_at: string | null;
  latest_qa_status: "tested" | "issue_found" | "approved" | null;
  latest_qa_notes: string | null;
  latest_qa_issue_codes: string[] | null;
  latest_qa_at: string | null;
  never_tested: boolean;
  qa_freshness_bucket: "never_tested" | "today" | "recent" | "stale";
  queue_score: number;
};

export async function getAdminAutoTestQueue(limit = 10) {
  const { data, error } = await supabase.rpc(
    "get_admin_auto_test_queue" as any,
    { p_limit: limit }
  );

  if (error) {
    throw new Error(error.message || "Auto-Test-Queue konnte nicht geladen werden.");
  }

  return (data ?? []) as AdminAutoTestQueueItem[];
}
