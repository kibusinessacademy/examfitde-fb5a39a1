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
  const errMeta = args.err?.__meta ?? {};

  // ── Progress Fingerprint comparison ──
  const prevFpReal = Number(args.stepMeta?.fp_real ?? 0);
  const currFpReal = Number(errMeta.fp_real ?? 0);
  const prevFpPh = Number(args.stepMeta?.fp_placeholders ?? Infinity);
  const currFpPh = Number(errMeta.fp_placeholders ?? Infinity);
  const madeProgress = isHollow && (currFpReal > prevFpReal || currFpPh < prevFpPh);

  // ✅ Progress-aware attempt management:
  // If real content increased or placeholders decreased → reset attempts (keep building)
  // If no progress → increment attempts toward escalation
  const prevAttempts = Number(args.stepMeta?.attempts ?? 0);
  const nextAttempts = madeProgress ? 0 : prevAttempts + 1;

  const baseMeta = {
    ...(args.stepMeta ?? {}),
    attempts: nextAttempts,
    ...errMeta,
    last_error: String(args.err?.message ?? args.err),
    last_error_class: verdict ? "permanent" : "transient",
    failed_at: new Date().toISOString(),
    // Persist fingerprint for next comparison
    fp_real: errMeta.fp_real ?? args.stepMeta?.fp_real ?? null,
    fp_placeholders: errMeta.fp_placeholders ?? args.stepMeta?.fp_placeholders ?? null,
    fp_avg_len: errMeta.fp_avg_len ?? args.stepMeta?.fp_avg_len ?? null,
    progress_reset: madeProgress ? true : undefined,
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
        reason: madeProgress
          ? `progress-reset + auto-rebuild: ${String(verdict)}`
          : `auto-rebuild: ${String(verdict)}`,
      });
    } else {
      // ── Escalation: max attempts reached without progress → escalate, don't die ──
      const escalationBackoff = 6 * 3600; // 6h
      const nextRunAt = new Date(Date.now() + escalationBackoff * 1000).toISOString();
      await sb
        .from("package_steps")
        .update({
          status: "queued",
          started_at: null,
          finished_at: null,
          meta: {
            ...baseMeta,
            escalated: true,
            escalated_at: new Date().toISOString(),
            next_run_at: nextRunAt,
            backoff_seconds: escalationBackoff,
            last_progress_note: `ESCALATED: ${attempts} attempts without progress — 6h backoff`,
          },
        })
        .eq("package_id", args.packageId)
        .eq("step_key", args.stepKey);
    }
  }
}
