import { supabase } from "@/integrations/supabase/client";

export type AdminAutoHealQueueItem = {
  id: string;
  package_id: string;
  curriculum_id: string;
  source_test_run_id: string | null;
  source: string;
  reason_codes: string[];
  heal_action:
    | "repair_exam_pool"
    | "repair_learning_content"
    | "repair_tutor_index"
    | "rerun_integrity"
    | "rerun_quality_council"
    | "manual_review";
  status: "pending" | "processing" | "done" | "failed" | "cancelled";
  notes: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};

export async function getAdminAutoHealQueue(status?: string) {
  const { data, error } = await supabase.rpc(
    "get_admin_auto_heal_queue" as any,
    { p_status: status ?? null }
  );

  if (error) {
    throw new Error(error.message || "Auto-Heal-Queue konnte nicht geladen werden.");
  }

  return (data ?? []) as AdminAutoHealQueueItem[];
}

export async function updateAdminAutoHealStatus(params: {
  queueId: string;
  status: "pending" | "processing" | "done" | "failed" | "cancelled";
  notes?: string;
}) {
  const { error } = await supabase.rpc(
    "update_admin_auto_heal_status" as any,
    {
      p_queue_id: params.queueId,
      p_status: params.status,
      p_notes: params.notes ?? null,
    }
  );

  if (error) {
    throw new Error(error.message || "Auto-Heal-Status konnte nicht aktualisiert werden.");
  }
}
