// supabase/functions/_shared/steps.ts
// SSOT Step-State Management: all "done" and "failed" transitions go through here
import { assertStepPostConditions } from "./post-conditions.ts";

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
 * Classifies errors as "permanent" (HOLLOW_* verdicts) or "transient".
 */
export async function markStepFailed(sb: SB, args: {
  packageId: string;
  stepKey: string;
  err: any;
  stepMeta?: Record<string, any>;
}) {
  const verdict = args.err?.__meta?.verdict ?? null;

  const meta = {
    ...(args.stepMeta ?? {}),
    ...(args.err?.__meta ?? {}),
    last_error: String(args.err?.message ?? args.err),
    last_error_class: verdict ? "permanent" : "transient",
  };

  const { error } = await sb
    .from("package_steps")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      meta,
    })
    .eq("package_id", args.packageId)
    .eq("step_key", args.stepKey);

  if (error) throw error;
}
