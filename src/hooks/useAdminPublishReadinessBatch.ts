import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PublishReadinessSignals = {
  INTEGRITY_OK?: boolean;
  COUNCIL_OK?: boolean;
  OPEN_STEPS_REMAIN?: boolean;
  STEP_DONE_WITHOUT_META_OK?: boolean;
  BRONZE_REVIEW_REQUIRED?: boolean;
};

export type PublishReadinessRow = {
  signals: PublishReadinessSignals;
  final_status: "publishable" | "rebuilding" | "review_required" | "blocked" | string;
  open_step_count?: number;
  drift_step_count?: number;
  details?: Record<string, unknown>;
};

/**
 * Batch-fetch admin_check_publish_readiness signals for many packages
 * in a single RPC roundtrip (avoids N+1).
 *
 * Returns a map { [package_id]: PublishReadinessRow }.
 */
export function useAdminPublishReadinessBatch(packageIds: string[]) {
  // Stable cache key — sorted ids
  const key = [...new Set(packageIds)].sort();

  return useQuery({
    queryKey: ["admin-publish-readiness-batch", key],
    enabled: key.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, PublishReadinessRow>> => {
      const { data, error } = await supabase.rpc(
        "admin_publish_readiness_batch" as never,
        { p_package_ids: key } as never,
      );
      if (error) throw error;
      const payload = (data ?? {}) as { ok?: boolean; results?: Record<string, PublishReadinessRow> };
      if (!payload?.ok) return {};
      return payload.results ?? {};
    },
  });
}
