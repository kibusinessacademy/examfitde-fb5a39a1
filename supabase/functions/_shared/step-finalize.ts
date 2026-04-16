/**
 * step-finalize.ts — Lightweight wrappers for SSOT step finalization
 * 
 * RULE: Every package-* edge function MUST call one of these on every exit path.
 * Direct writes to package_steps.status are FORBIDDEN outside _shared/steps.ts.
 *
 * Usage:
 *   import { finalizeStepDone, finalizeStepFailed } from "../_shared/step-finalize.ts";
 *
 *   // On success:
 *   await finalizeStepDone(sb, packageId, "step_key", { ... meta });
 *
 *   // On failure:
 *   await finalizeStepFailed(sb, packageId, "step_key", err);
 */

import { markStepDone, markStepFailed } from "./steps.ts";

type SB = any;

/**
 * Finalize a step as DONE via SSOT path.
 * Safe to call — wraps markStepDone with error handling so the HTTP response
 * is still returned even if finalization fails (logged but not fatal to response).
 */
export async function finalizeStepDone(sb: SB, packageId: string, stepKey: string, meta?: Record<string, any>): Promise<void> {
  try {
    await markStepDone(sb, { packageId, stepKey, meta });
    console.log(`[step-finalize] ✅ ${stepKey} marked done for ${packageId.slice(0, 8)}`);
  } catch (e) {
    // Log but don't throw — the function already did its work, and the runner
    // will see the job result. markStepDone failures are usually post-condition failures
    // which should NOT be swallowed silently.
    console.error(`[step-finalize] ❌ markStepDone failed for ${stepKey} (${packageId.slice(0, 8)}): ${(e as Error).message}`);
    // Re-throw post-condition failures so the function returns error to runner
    throw e;
  }
}

/**
 * Finalize a step as FAILED via SSOT path.
 * Best-effort — if markStepFailed itself fails, we log but don't crash.
 */
export async function finalizeStepFailed(sb: SB, packageId: string, stepKey: string, err: any, stepMeta?: Record<string, any>): Promise<void> {
  try {
    await markStepFailed(sb, { packageId, stepKey, err, stepMeta, autoRebuildHollow: true });
    console.log(`[step-finalize] ❌ ${stepKey} marked failed for ${packageId.slice(0, 8)}: ${String(err?.message ?? err).slice(0, 100)}`);
  } catch (e2) {
    console.error(`[step-finalize] markStepFailed also failed for ${stepKey} (${packageId.slice(0, 8)}): ${(e2 as Error).message}`);
  }
}
