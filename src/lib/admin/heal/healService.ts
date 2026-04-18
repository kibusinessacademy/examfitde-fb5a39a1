/**
 * SSOT Heal Service v2
 * ────────────────────
 * Zentraler Entry-Point für alle manuellen Heal-Aktionen.
 *
 * Härtungen ggü. v1:
 *   - Promise<HealResult> Typ-Signatur korrekt
 *   - Reason-Schema erzwungen (assertValidHealReason)
 *   - enqueuePlan über harte Action-Registry (HealEnqueueAction → AdminOpsAction)
 *   - Soft-Heal Auto-Upgrade auf Hard wenn Snapshot stuck/loop signalisiert
 *
 * Recommendation lebt in healRecommendations.ts (datenbasiert, nicht reason-only).
 */
import { supabase } from "@/integrations/supabase/client";
import { runAdminOpsAction } from "@/integrations/supabase/admin-ops-actions";
import {
  resolveHealOpsAction,
  type HealEnqueueAction,
} from "./healActionRegistry";
import { assertValidHealReason } from "./healReason";
import {
  shouldForceHardHeal,
  type HealSnapshot,
  type HealMode,
} from "./healRecommendations";

export type { HealMode, HealSnapshot } from "./healRecommendations";
export { recommendHeal } from "./healRecommendations";
export type { HealEnqueueAction } from "./healActionRegistry";
export { buildHealReason } from "./healReason";

export interface HealEnqueueStep {
  action: HealEnqueueAction;
  payload?: Record<string, unknown>;
}

export interface RunHealParams {
  packageId: string;
  mode: HealMode;
  /** Required for hard heal; required for soft heal (no implicit fallback). */
  resetFromStep: string;
  /** SSOT reason — must match buildHealReason() schema. */
  reason: string;
  /** Optional cancel toggle for hard heal (default true). */
  cancelActiveJobs?: boolean;
  /** Optional follow-up actions resolved through HealActionRegistry. */
  enqueuePlan?: HealEnqueueStep[];
  /** Optional snapshot — used for Soft→Hard auto-upgrade guard. */
  snapshot?: HealSnapshot;
  /** Free-text operator note (audit-only, not part of primary reason). */
  operatorNote?: string;
}

export interface HealResult {
  ok: boolean;
  mode: HealMode;
  packageId: string;
  reset?: unknown;
  enqueued: Array<{ action: HealEnqueueAction; ok: boolean; error?: string }>;
  upgradedToHard: boolean;
}

export async function runPackageHealAction(
  params: RunHealParams,
): Promise<HealResult> {
  const {
    packageId,
    resetFromStep,
    reason,
    cancelActiveJobs = true,
    enqueuePlan,
    snapshot,
    operatorNote,
  } = params;

  // ── 1. Reason-Schema enforcement ──
  assertValidHealReason(reason);
  if (!resetFromStep) {
    throw new Error("runPackageHealAction: resetFromStep is required");
  }

  // ── 2. Soft → Hard auto-upgrade guard ──
  let mode = params.mode;
  let upgradedToHard = false;
  if (mode === "soft" && snapshot && shouldForceHardHeal(snapshot)) {
    mode = "hard";
    upgradedToHard = true;
  }

  // ── 3. Execute reset ──
  let resetResult: unknown = null;
  if (mode === "soft") {
    resetResult = await runAdminOpsAction("reset_to_step", {
      package_id: packageId,
      step_key: resetFromStep,
    });
  } else {
    const { data, error } = await (supabase as any).rpc("admin_manual_heal_package", {
      p_package_id: packageId,
      p_reset_from_step: resetFromStep,
      p_cancel_active_jobs: cancelActiveJobs,
      p_reason: operatorNote ? `${reason} | note=${operatorNote}` : reason,
    });
    if (error) throw new Error(error.message || "admin_manual_heal_package failed");
    resetResult = data;
  }

  // ── 4. Resolve & execute enqueuePlan via Action Registry ──
  const enqueued: HealResult["enqueued"] = [];
  if (enqueuePlan?.length) {
    for (const step of enqueuePlan) {
      try {
        const opsAction = resolveHealOpsAction(step.action);
        await runAdminOpsAction(opsAction, {
          package_id: packageId,
          ...(step.payload ?? {}),
        });
        enqueued.push({ action: step.action, ok: true });
      } catch (err: any) {
        enqueued.push({ action: step.action, ok: false, error: err?.message ?? String(err) });
      }
    }
  }

  return { ok: true, mode, packageId, reset: resetResult, enqueued, upgradedToHard };
}
