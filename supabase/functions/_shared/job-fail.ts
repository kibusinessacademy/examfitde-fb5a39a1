import { classifyDbError } from "./pg-error.ts";
import { mergePackageStepMeta } from "./merge-step-meta.ts";

export interface FailCtx {
  supabase: any;
  jobId?: string | null;
  jobType?: string | null;
  packageId?: string | null;
  stepKey?: string | null;
}

/**
 * Standardized DB error handler for Jobs/Steps:
 * - check/not-null/rls/fk/unique => permanent fail (no retry)
 * - serialization/timeout => retryable (rethrow)
 */
export async function handleDbFailure(ctx: FailCtx, err: any) {
  // Tag as runtime failure for failure_stage classification
  if (!err.__meta) err.__meta = {};
  if (!err.__meta.preflight && !err.__meta.postcondition) {
    err.__meta.runtime = true;
  }
  const c = classifyDbError(err);

  const metaPatch = {
    last_error_code: c.code ?? null,
    last_error_kind: c.kind,
    last_error_hint: c.hintKey ?? null,
    last_error_message: c.message?.slice(0, 5000) ?? "db_error",
    last_error_class: c.class,
    at: new Date().toISOString(),
  };

  // 1) Mark job
  if (ctx.jobId) {
    if (c.class === "permanent") {
      // Phase 2 Härtung: Materialization-Guard-Failures werden cancelled (kein Retry-Loop)
      const errStr = String(c.message ?? err?.message ?? "");
      const isMatGuard = /MATERIALIZATION_GUARD|TOO_FEW_CHUNKS/.test(errStr);

      if (isMatGuard) {
        try {
          await ctx.supabase.rpc("fn_route_materialization_block", {
            p_job_id: ctx.jobId,
            p_last_error: errStr,
          });
        } catch (_e) {
          // Fallback auf normalen failed-Pfad
          await ctx.supabase
            .from("job_queue")
            .update({ status: "failed", last_error: metaPatch })
            .eq("id", ctx.jobId);
        }
      } else {
        await ctx.supabase
          .from("job_queue")
          .update({ status: "failed", last_error: metaPatch })
          .eq("id", ctx.jobId);

        // Hot-Loop-Check nach echtem Failure (best-effort, fail-open)
        if (ctx.packageId) {
          try {
            await ctx.supabase.rpc("fn_check_hot_loop_quarantine", {
              p_package_id: ctx.packageId,
              p_job_type: null, // wird über job-row gelookupt
            });
          } catch (_e) {
            // Silent: Quarantäne-Check darf den Failure-Pfad nie brechen
          }
        }
      }
    } else {
      await ctx.supabase
        .from("job_queue")
        .update({ last_error: metaPatch })
        .eq("id", ctx.jobId);
    }
  }

  // 2) Mark step (if applicable)
  if (ctx.packageId && ctx.stepKey) {
    if (c.class === "permanent") {
      await ctx.supabase
        .from("package_steps")
        .update({
          status: "failed",
          last_error: c.message?.slice(0, 5000) ?? "db_error",
        })
        .eq("package_id", ctx.packageId)
        .eq("step_key", ctx.stepKey);
    }
    // Always merge meta safely (never overwrite)
    await mergePackageStepMeta(ctx.supabase, ctx.packageId, ctx.stepKey, metaPatch);
  }

  if (c.class === "permanent") {
    return { ok: false, permanent: true, ...c };
  }

  // Retryable: rethrow to let runner/backoff handle it
  throw err;
}
