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
  queue_score: number;
  freshness_bucket: "today" | "recent" | "older";
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
