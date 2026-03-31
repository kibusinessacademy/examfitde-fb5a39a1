/**
 * Repair Eligibility Guard — Shared SSOT
 *
 * Prevents wrong-remediation loops by checking if a repair action
 * is actually valid for the current package blocker before dispatch.
 *
 * Uses the DB function fn_is_repair_action_eligible as the single
 * source of truth.
 *
 * P0 HARDENED:
 * - fail-closed for automation paths (watchdog, stuck-scan, runner)
 * - fail-open only for manual/admin triggers
 * - triggerSource differentiates behavior
 */

// deno-lint-ignore no-explicit-any
type SB = any;

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
}

export interface GateDeltaResult {
  changed: boolean;
  deltas: Array<{ field: string; before: unknown; after: unknown }>;
  check_failed?: boolean;
  check_failed_reason?: string;
}

/** Trigger sources that should fail-closed on RPC errors */
const FAIL_CLOSED_SOURCES = new Set([
  "pipeline-watchdog", "stuck-scan", "stuck-scan-delta-guard",
  "job-runner", "auto-heal", "production-guardian", "heal-dispatch",
  "nightly-audit", "auto_heal",
]);

/**
 * Check if a repair action is eligible for a given package.
 * Calls the central DB function to avoid logic duplication.
 *
 * @param triggerSource - Who is requesting the check. Automation sources
 *   fail-closed on RPC errors; manual/admin sources fail-open.
 */
export async function isRepairActionEligible(
  sb: SB,
  packageId: string,
  repairAction: string,
  triggerSource: string = "unknown",
): Promise<EligibilityResult> {
  const failClosed = FAIL_CLOSED_SOURCES.has(triggerSource) || triggerSource === "unknown";

  try {
    const { data, error } = await sb.rpc("fn_is_repair_action_eligible", {
      p_package_id: packageId,
      p_repair_action: repairAction,
    });

    if (error) {
      console.warn(`[repair-eligibility] RPC error (${failClosed ? "fail-closed" : "fail-open"}): ${error.message}`);
      if (failClosed) {
        return { eligible: false, reason: `rpc_error_fail_closed: ${error.message}` };
      }
      return { eligible: true, reason: `rpc_error_fail_open: ${error.message}` };
    }

    const result = data as { eligible: boolean; reason: string } | null;
    return {
      eligible: result?.eligible ?? !failClosed,
      reason: result?.reason ?? "unknown",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[repair-eligibility] exception (${failClosed ? "fail-closed" : "fail-open"}): ${msg}`);
    if (failClosed) {
      return { eligible: false, reason: `exception_fail_closed: ${msg}` };
    }
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
