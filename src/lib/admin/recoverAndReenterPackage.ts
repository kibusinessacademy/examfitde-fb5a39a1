/**
 * @deprecated Use `runPackageHealAction({ mode: 'hard' })` from
 * `@/lib/admin/heal/healService` instead. This wrapper around the legacy
 * `recover_and_reenter_package` RPC is kept only for non-UI consumers and
 * will be removed once they migrate.
 */
import { supabase } from "@/integrations/supabase/client";

export interface RecoverResult {
  ok: boolean;
  package_id: string;
  reset_steps: number;
  eligible_for_reentry: boolean;
  reentered: boolean;
  final_status: string;
  reason: string;
  gate_delta_verified?: boolean;
  error?: string;
}

/** @deprecated see file header */
export async function recoverAndReenterPackage(
  packageId: string,
  reason: string,
  triggerSource: string = "admin_ops",
  actorUserId?: string | null,
  gateDeltaVerified: boolean = false,
): Promise<RecoverResult> {
  const { data, error } = await (supabase as any).rpc("recover_and_reenter_package", {
    p_package_id: packageId,
    p_reason: reason,
    p_trigger_source: triggerSource,
    p_actor_user_id: actorUserId ?? null,
    p_gate_delta_verified: gateDeltaVerified,
  });

  if (error) throw error;
  return data as RecoverResult;
}
