import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { verifyGenerateLearningContentComplete, verifyFinalizeLearningContentComplete } from "../_shared/rootstep-verifier.ts";
import { markStepDone } from "../_shared/steps.ts";

/**
 * verifier-reconciler — Standalone Step Verifier (v1)
 *
 * Runs independently of pipeline-runner leases and WIP limits.
 * Checks building packages for steps that are materially complete
 * but have not been finalized due to verifier starvation.
 *
 * Designed to run as a cron job every 2-3 minutes.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

const ROOTSTEP_VERIFIERS = [
  { stepKey: "generate_learning_content", jobType: "package_generate_learning_content", verify: verifyGenerateLearningContentComplete },
  { stepKey: "finalize_learning_content", jobType: "package_finalize_learning_content", verify: verifyFinalizeLearningContentComplete },
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const startMs = Date.now();
  const results: Array<{ packageId: string; stepKey: string; action: string }> = [];

  try {
    // Find ALL building/council_review packages — no lease required
    const { data: packages, error: pkgErr } = await sb
      .from("course_packages")
      .select("id")
      .in("status", ["building", "council_review"])
      .limit(100);

    if (pkgErr || !packages || packages.length === 0) {
      return json({ ok: true, idle: true, packages: 0, runtime_ms: Date.now() - startMs });
    }

    for (const pkg of packages) {
      const packageId = pkg.id;
      const shortId = packageId.slice(0, 8);

      // Load steps for this package
      const { data: steps } = await sb
        .from("package_steps")
        .select("step_key, status, meta")
        .eq("package_id", packageId);

      if (!steps) continue;

      for (const v of ROOTSTEP_VERIFIERS) {
        const step = steps.find(s => s.step_key === v.stepKey);
        if (!step) continue;
        // Only check non-terminal steps
        if (!["queued", "running", "enqueued"].includes(step.status)) continue;

        try {
          const result = await v.verify(sb, packageId);
          if (!result.ready) continue;

          // Write verifier result into step meta
          const currentMeta = (step.meta ?? {}) as Record<string, unknown>;
          const updatedMeta = {
            ...currentMeta,
            verifier_ready: true,
            verifier_reason: result.reason,
            verifier_snapshot: result.snapshot,
            verifier_checked_at: new Date().toISOString(),
            verifier_source: "standalone_reconciler",
          };

          await sb.from("package_steps").update({ meta: updatedMeta })
            .eq("package_id", packageId).eq("step_key", v.stepKey);

          // Check for active jobs — only finalize if zero active
          const { data: activeCnt } = await sb.rpc("count_active_jobs", {
            p_package_id: packageId,
            p_job_type: v.jobType,
          });

          if ((activeCnt ?? 1) !== 0) {
            results.push({ packageId, stepKey: v.stepKey, action: `verifier_ready, ${activeCnt} active jobs remaining` });
            continue;
          }

          // Finalize the step
          try {
            await markStepDone(sb, {
              packageId,
              stepKey: v.stepKey,
              meta: {
                ...updatedMeta,
                finalized_by: "verifier-reconciler",
                finalization_reason: result.reason,
                finalization_snapshot: result.snapshot,
                finalization_source: "standalone_reconciler",
              },
            });

            // Cancel remaining pending/failed jobs for this step
            await sb.rpc("cancel_jobs_for_package", {
              p_package_id: packageId,
              p_job_type: v.jobType,
              p_statuses: ["pending", "failed"],
              p_reason: "verifier_reconciler_finalized",
            });

            console.log(`[verifier-reconciler] ✅ Finalized ${shortId}/${v.stepKey}: ${result.reason}`);
            results.push({ packageId, stepKey: v.stepKey, action: `finalized: ${result.reason}` });

            // Log to auto_heal_log
            await sb.from("auto_heal_log").insert({
              action_type: `reconciler_finalize_${v.stepKey}`,
              trigger_source: "verifier-reconciler",
              target_type: "course_package",
              target_id: packageId,
              result_status: "applied",
              result_detail: `Standalone verifier finalized ${v.stepKey}: ${result.reason}`,
              metadata: result.snapshot,
            });
          } catch (finalizeErr) {
            const msg = (finalizeErr as Error).message;
            console.warn(`[verifier-reconciler] ⛔ markStepDone blocked ${shortId}/${v.stepKey}: ${msg}`);
            results.push({ packageId, stepKey: v.stepKey, action: `blocked: ${msg.slice(0, 100)}` });
          }
        } catch (vErr) {
          console.warn(`[verifier-reconciler] Error verifying ${shortId}/${v.stepKey}: ${(vErr as Error).message}`);
        }
      }

      // Budget guard: don't exceed 50s
      if (Date.now() - startMs > 45_000) {
        console.warn(`[verifier-reconciler] Budget limit reached, stopping early`);
        break;
      }
    }
  } catch (e) {
    console.error(`[verifier-reconciler] Fatal: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }

  const runtimeMs = Date.now() - startMs;
  console.log(`[verifier-reconciler] Done: ${results.length} actions in ${runtimeMs}ms`);
  return json({ ok: true, actions: results.length, results, runtime_ms: runtimeMs });
});
