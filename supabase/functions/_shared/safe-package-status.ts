/**
 * Safe package status transition helper.
 * Uses the DB function `safe_transition_package_status` to atomically
 * archive conflicting packages before updating, preventing
 * uniq_visible_package_per_curriculum constraint violations.
 */
import type { SupabaseClient } from "./stuck-scan-helpers.ts";

export async function safeTransitionPackageStatus(
  sb: SupabaseClient,
  packageId: string,
  newStatus: string,
  extra: Record<string, string | null> = {},
) {
  const { error } = await sb.rpc("safe_transition_package_status", {
    p_package_id: packageId,
    p_new_status: newStatus,
    p_extra: extra,
  });
  if (error) {
    console.error(`[safe-transition] Failed for ${packageId} → ${newStatus}:`, error.message);
    throw error;
  }
}
