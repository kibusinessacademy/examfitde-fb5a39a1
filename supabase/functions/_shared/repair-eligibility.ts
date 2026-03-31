/**
 * Repair Eligibility Guard — Shared SSOT
 *
 * Prevents wrong-remediation loops by checking if a repair action
 * is actually valid for the current package blocker before dispatch.
 *
 * Uses the DB function fn_is_repair_action_eligible as the single
 * source of truth.
 */

// deno-lint-ignore no-explicit-any
type SB = any;

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
}

/**
 * Check if a repair action is eligible for a given package.
 * Calls the central DB function to avoid logic duplication.
 */
export async function isRepairActionEligible(
  sb: SB,
  packageId: string,
  repairAction: string,
): Promise<EligibilityResult> {
  try {
    const { data, error } = await sb.rpc("fn_is_repair_action_eligible", {
      p_package_id: packageId,
      p_repair_action: repairAction,
    });

    if (error) {
      console.warn(`[repair-eligibility] RPC error: ${error.message}`);
      // Fail-open for RPC errors to avoid blocking legitimate repairs
      return { eligible: true, reason: `rpc_error_fail_open: ${error.message}` };
    }

    const result = data as { eligible: boolean; reason: string } | null;
    return {
      eligible: result?.eligible ?? true,
      reason: result?.reason ?? "unknown",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[repair-eligibility] exception: ${msg}`);
    return { eligible: true, reason: `exception_fail_open: ${msg}` };
  }
}

/**
 * Capture gate snapshot for pre/post repair comparison.
 */
export async function captureGateSnapshot(
  sb: SB,
  packageId: string,
): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await sb.rpc("fn_capture_gate_snapshot", {
      p_package_id: packageId,
    });
    if (error) {
      console.warn(`[repair-eligibility] snapshot error: ${error.message}`);
      return {};
    }
    return (data as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/**
 * Compare pre/post repair snapshots to detect if gate state changed.
 */
export async function hasGateStateChanged(
  sb: SB,
  preSnapshot: Record<string, unknown>,
  postSnapshot: Record<string, unknown>,
): Promise<{ changed: boolean; deltas: Array<{ field: string; before: unknown; after: unknown }> }> {
  try {
    const { data, error } = await sb.rpc("fn_has_gate_state_changed", {
      p_pre_snapshot: preSnapshot,
      p_post_snapshot: postSnapshot,
    });
    if (error) {
      console.warn(`[repair-eligibility] delta-check error: ${error.message}`);
      return { changed: false, deltas: [] };
    }
    const result = data as { changed: boolean; deltas: Array<{ field: string; before: unknown; after: unknown }> } | null;
    return result ?? { changed: false, deltas: [] };
  } catch {
    return { changed: false, deltas: [] };
  }
}
