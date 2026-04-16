// supabase/functions/_shared/steps.ts
// SSOT Step-State Management: all "done" and "failed" transitions go through here
import { assertStepPostConditions } from "./post-conditions.ts";
import { requeueStepWithBackoff, isHollowVerdict } from "./requeue-policy.ts";
import { runPreflightAssertions } from "./preflight-registry.ts";

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

  // ✅ Preflight: step-specific contract assertions (before post-conditions)
  await runPreflightAssertions(sb, {
    packageId: args.packageId,
    stepKey: args.stepKey,
    meta: args.meta,
  });

  // ✅ Guard: NEVER mark done unless post-conditions pass
  await assertStepPostConditions(sb, {
    packageId: args.packageId,
    stepKey: args.stepKey,
    expectedLessons: args.expectedLessons,
    track: args.track,
  });

  // ── P1-D: On heal-to-done, historize last_error into meta.previous_errors[] ──
  // Fetch current step to capture existing last_error before clearing
  let previousErrors: string[] = [];
  try {
    const { data: currentStep } = await sb
      .from("package_steps")
      .select("last_error, meta")
      .eq("package_id", args.packageId)
      .eq("step_key", args.stepKey)
      .maybeSingle();
    if (currentStep?.last_error) {
      const existingHistory = Array.isArray((currentStep.meta as any)?.previous_errors)
        ? (currentStep.meta as any).previous_errors
        : [];
      previousErrors = [
        ...existingHistory,
        `[${new Date().toISOString()}] ${String(currentStep.last_error).slice(0, 300)}`,
      ].slice(-10); // Keep last 10 errors max
    }
  } catch (_e) { /* best-effort — don't block step completion */ }

  const cleanedMeta = {
    ...(args.meta ?? {}),
    // Historize errors, clear transient fields
    ...(previousErrors.length > 0 ? { previous_errors: previousErrors } : {}),
    // Post-condition passed → set flag for DB trigger guard
    postcondition_verified: true,
    // Ghost-Guard compliance: meta.ok MUST be true for done transitions
    ok: true,
    // Explicitly remove stale failure signals
    last_error_class: undefined,
    failed_at: undefined,
    transient_attempts: undefined,
    transient_first_at: undefined,
    last_transient_error: undefined,
    last_transient_at: undefined,
    transient_exhausted: undefined,
    escalated: undefined,
    escalated_at: undefined,
    blocked_reason: undefined,
    reason: undefined,
    sequence_guard: undefined,
  };

  // Remove undefined keys (Supabase jsonb doesn't like them)
  for (const k of Object.keys(cleanedMeta)) {
    if ((cleanedMeta as any)[k] === undefined) delete (cleanedMeta as any)[k];
  }

  // ── Ensure started_at is set (Ghost-Guard compliance) ──
  const { data: preCheck } = await sb
    .from("package_steps")
    .select("started_at")
    .eq("package_id", args.packageId)
    .eq("step_key", args.stepKey)
    .maybeSingle();

  const updatePayload: Record<string, any> = {
    status: "done",
    finished_at,
    last_error: null,
    meta: cleanedMeta,
  };

  // If started_at is missing, backfill it to satisfy ghost-guard
  if (!preCheck?.started_at) {
    updatePayload.started_at = finished_at;
  }

  const { error } = await sb
    .from("package_steps")
    .update(updatePayload)
    .eq("package_id", args.packageId)
    .eq("step_key", args.stepKey);

  if (error) throw new Error(`markStepDone UPDATE failed for ${args.stepKey}: ${error.message}`);

  // ── Read-after-write verification ──
  const { data: verify, error: verifyErr } = await sb
    .from("package_steps")
    .select("status, finished_at")
    .eq("package_id", args.packageId)
    .eq("step_key", args.stepKey)
    .maybeSingle();

  if (verifyErr) {
    throw new Error(`markStepDone verify read failed for ${args.stepKey}: ${verifyErr.message}`);
  }

  if (!verify || verify.status !== "done") {
    throw new Error(
      `markStepDone verify MISMATCH for ${args.stepKey}: expected status=done, got=${verify?.status ?? "null"}. ` +
      `Transaction may have been rolled back by a trigger.`
    );
  }
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

  // ── failure_stage classification for forensic audit ──
  const failureStage: "preflight" | "postcondition" | "runtime" =
    errMeta.preflight ? "preflight"
    : errMeta.postcondition ? "postcondition"
    : "runtime";

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
    failure_stage: failureStage,
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
      last_error: String(args.err?.message ?? args.err).slice(0, 500),
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
