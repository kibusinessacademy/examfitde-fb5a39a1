// supabase/functions/_shared/steps.ts
// SSOT Step-State Management: all "done" and "failed" transitions go through here
import { assertStepPostConditions } from "./post-conditions.ts";
import { requeueStepWithBackoff, isHollowVerdict } from "./requeue-policy.ts";

type SB = any;

/**
 * Mark a package step as "done" — ONLY after post-condition guards pass.
 * This is the ONLY function allowed to set status='done' on package_steps.
 */
export async function markStepDone(sb: SB, args: {
  packageId: string;
  stepKey: string;
  meta?: Record<string, any>;
  finishedAt?: string;
  expectedLessons?: number | null;
  track?: string | null;
}) {
  const finished_at = args.finishedAt ?? new Date().toISOString();

  // ✅ Guard: NEVER mark done unless post-conditions pass
  await assertStepPostConditions(sb, {
    packageId: args.packageId,
    stepKey: args.stepKey,
    expectedLessons: args.expectedLessons,
    track: args.track,
  });

  const { error } = await sb
    .from("package_steps")
    .update({
      status: "done",
      finished_at,
      meta: { ...(args.meta ?? {}) },
    })
    .eq("package_id", args.packageId)
    .eq("step_key", args.stepKey);

  if (error) throw error;
}

/**
 * Mark a package step as "failed" with structured verdict metadata.
 * On HOLLOW_* verdicts: auto-requeue with exponential backoff (up to max_attempts).
 */
export async function markStepFailed(sb: SB, args: {
  packageId: string;
  stepKey: string;
  err: any;
  stepMeta?: Record<string, any>;
  autoRebuildHollow?: boolean; // default true
}) {
  const verdict = args.err?.__meta?.verdict ?? null;
  const isHollow = isHollowVerdict(verdict);

  const baseMeta = {
    ...(args.stepMeta ?? {}),
    ...(args.err?.__meta ?? {}),
    last_error: String(args.err?.message ?? args.err),
    last_error_class: verdict ? "permanent" : "transient",
    failed_at: new Date().toISOString(),
  };

  // Persist the failure first (audit trail)
  const { error } = await sb
    .from("package_steps")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      meta: baseMeta,
    })
    .eq("package_id", args.packageId)
    .eq("step_key", args.stepKey);

  if (error) throw error;

  // Auto-rebuild policy: HOLLOW_* only, with max_attempts cap
  const auto = args.autoRebuildHollow !== false;
  if (auto && isHollow) {
    const attempts = Number(baseMeta?.attempts ?? 0);
    const max = Number(baseMeta?.max_attempts ?? 6);
    if (attempts < max) {
      await requeueStepWithBackoff(sb, {
        packageId: args.packageId,
        stepKey: args.stepKey,
        stepMeta: baseMeta,
        reason: `auto-rebuild: ${String(verdict)}`,
      });
    }
  }
}
