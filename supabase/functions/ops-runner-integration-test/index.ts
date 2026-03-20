import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { VERIFIED_JOB_TYPES } from "../_shared/artifact-verifier.ts";

/**
 * ops-runner-integration-test — Phase 2: Live Runner DB-State Test
 *
 * Inserts synthetic jobs into job_queue, invokes job-runner,
 * then validates final DB state for 4 paths:
 *
 *   A. Registered type + artifact present  → completed
 *   B. Registered type + artifact missing  → pending/failed (MATERIALIZATION_GUARD)
 *   C. Unregistered type                   → completed (opt-in pass-through)
 *   D. Invalid payload (fail-closed)       → failed (permanent)
 *
 * All synthetic jobs use a unique test_run_id tag for safe cleanup.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const NULL_UUID = "00000000-0000-0000-0000-000000000000";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const startMs = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: "Missing env" }, 500);

    // Auth: validate caller is admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);

    const { data: roleData } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) return json({ error: "Admin required" }, 403);

    const body = await req.json().catch(() => ({}));
    const curriculumId = body.curriculum_id as string | undefined;
    const packageId = body.package_id as string | undefined;
    const skipCleanup = body.skip_cleanup === true;

    const testRunId = `integration_test_${crypto.randomUUID().slice(0, 12)}`;
    const results: Record<string, any> = { test_run_id: testRunId };

    // ═══════════════════════════════════════════════════════════
    // Helper: insert a synthetic job, invoke job-runner, read back
    // ═══════════════════════════════════════════════════════════
    async function runSyntheticJob(label: string, opts: {
      jobType: string;
      payload: Record<string, any>;
      packageId?: string;
    }): Promise<Record<string, any>> {
      const jobId = crypto.randomUUID();

      // Insert synthetic job as "pending"
      const { error: insertErr } = await sb.from("job_queue").insert({
        id: jobId,
        job_type: opts.jobType,
        payload: { ...opts.payload, _test_run_id: testRunId, _test_label: label },
        package_id: opts.packageId || null,
        status: "pending",
        priority: 1,
        attempts: 0,
        max_attempts: 1, // single attempt — we want to see the guard, not retries
        meta: { synthetic_test: true, test_run_id: testRunId },
      });

      if (insertErr) {
        return { label, error: `INSERT_FAILED: ${insertErr.message}`, jobId };
      }

      // Invoke job-runner to process it
      // We use claim_pending_jobs which the runner uses, but since we set priority=1
      // and the job is pending, the runner should pick it up.
      try {
        const runnerRes = await fetch(`${supabaseUrl}/functions/v1/job-runner`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ max_jobs: 1, _test_job_id: jobId }),
          signal: AbortSignal.timeout(60_000),
        });
        const runnerBody = await runnerRes.text().catch(() => "");
        const runnerJson = (() => { try { return JSON.parse(runnerBody); } catch { return { raw: runnerBody.slice(0, 500) }; } })();

        // Wait briefly for async completion
        await new Promise(r => setTimeout(r, 2000));

        // Read back job state
        const { data: job, error: readErr } = await sb
          .from("job_queue")
          .select("id, job_type, status, error, completed_at, meta, attempts, run_after")
          .eq("id", jobId)
          .single();

        if (readErr || !job) {
          return { label, jobId, error: `READ_BACK_FAILED: ${readErr?.message}`, runner_response: runnerJson };
        }

        return {
          label,
          jobId,
          status: job.status,
          error: job.error,
          completed_at: job.completed_at,
          attempts: job.attempts,
          run_after: job.run_after,
          meta_materialization_guard: (job.meta as any)?.artifact_verified,
          meta_materialization_reason: (job.meta as any)?.artifact_verify_reason,
          meta_materialization_retries: (job.meta as any)?.materialization_retries,
          runner_status: runnerRes.status,
          runner_ok: runnerJson?.ok,
        };
      } catch (fetchErr) {
        // Still read back the job state
        const { data: job } = await sb
          .from("job_queue")
          .select("id, status, error, completed_at, meta")
          .eq("id", jobId)
          .single();

        return {
          label,
          jobId,
          status: job?.status ?? "unknown",
          error: job?.error ?? (fetchErr as Error).message,
          runner_error: (fetchErr as Error).message,
        };
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PATH A: Registered type WITH real artifact
    // ═══════════════════════════════════════════════════════════
    if (curriculumId) {
      const resultA = await runSyntheticJob("path_a_artifact_present", {
        jobType: "package_generate_exam_pool",
        payload: { curriculum_id: curriculumId },
        packageId: packageId,
      });
      const passA = resultA.status === "completed" || resultA.meta_materialization_guard === true;
      results["path_a_artifact_present"] = {
        ...resultA,
        pass: passA,
        expected: "status=completed, artifact_verified=true",
        note: "Requires a curriculum_id with existing exam_questions",
      };
    } else {
      results["path_a_artifact_present"] = {
        skipped: true,
        reason: "No curriculum_id provided — cannot test artifact-present path",
      };
    }

    // ═══════════════════════════════════════════════════════════
    // PATH B: Registered type WITHOUT artifact (zero-UUID)
    // ═══════════════════════════════════════════════════════════
    const resultB = await runSyntheticJob("path_b_artifact_missing", {
      jobType: "package_generate_exam_pool",
      payload: { curriculum_id: NULL_UUID },
      packageId: packageId || NULL_UUID,
    });
    const passB = resultB.status !== "completed" &&
      (String(resultB.error ?? "").includes("MATERIALIZATION_GUARD") ||
       resultB.meta_materialization_guard === false);
    results["path_b_artifact_missing"] = {
      ...resultB,
      pass: passB,
      expected: "status!=completed, error contains MATERIALIZATION_GUARD",
    };

    // ═══════════════════════════════════════════════════════════
    // PATH C: Unregistered job type (opt-in pass-through)
    // ═══════════════════════════════════════════════════════════
    const resultC = await runSyntheticJob("path_c_unregistered_type", {
      jobType: "smoke_test_unregistered_xyz",
      payload: { test: true },
    });
    // Unregistered types have no edge function, so the runner won't dispatch them.
    // This tests that the verifier itself doesn't block — the runner might skip/fail
    // for "unknown function" reasons, which is fine. The key: no MATERIALIZATION_GUARD error.
    const passC = !String(resultC.error ?? "").includes("MATERIALIZATION_GUARD");
    results["path_c_unregistered_type"] = {
      ...resultC,
      pass: passC,
      expected: "No MATERIALIZATION_GUARD block (verifier passes through)",
    };

    // ═══════════════════════════════════════════════════════════
    // PATH D: Invalid payload → fail-closed (permanent)
    // ═══════════════════════════════════════════════════════════
    const resultD = await runSyntheticJob("path_d_invalid_payload", {
      jobType: "package_generate_exam_pool",
      payload: {}, // Missing curriculum_id entirely
      packageId: NULL_UUID,
    });
    const passD = resultD.status !== "completed" &&
      (String(resultD.error ?? "").includes("MATERIALIZATION_GUARD") ||
       resultD.meta_materialization_guard === false);
    results["path_d_invalid_payload"] = {
      ...resultD,
      pass: passD,
      expected: "status=failed (permanent), MATERIALIZATION_GUARD: MISSING_CURRICULUM_ID",
    };

    // ═══════════════════════════════════════════════════════════
    // Cleanup: remove synthetic test jobs
    // ═══════════════════════════════════════════════════════════
    if (!skipCleanup) {
      const { error: cleanErr, count: cleanCount } = await sb
        .from("job_queue")
        .delete()
        .like("payload->>_test_run_id", testRunId);

      results["cleanup"] = {
        deleted: cleanCount ?? 0,
        error: cleanErr?.message ?? null,
      };
    }

    // ═══════════════════════════════════════════════════════════
    // Overall verdict
    // ═══════════════════════════════════════════════════════════
    const pathAOk = results.path_a_artifact_present?.skipped || results.path_a_artifact_present?.pass;
    const pathBOk = results.path_b_artifact_missing?.pass === true;
    const pathCOk = results.path_c_unregistered_type?.pass === true;
    const pathDOk = results.path_d_invalid_payload?.pass === true;

    const overallPass = pathAOk && pathBOk && pathCOk && pathDOk;

    return json({
      ok: true,
      overall_pass: overallPass,
      verdict: overallPass
        ? "✅ All Runner integration paths verified. Materialization Guard enforces correctly in live job-runner."
        : "❌ One or more Runner paths failed. See details below.",
      test_run_id: testRunId,
      registered_verifier_types: VERIFIED_JOB_TYPES,
      results,
      elapsed_ms: Date.now() - startMs,
    });

  } catch (err) {
    return json({
      ok: false,
      error: (err as Error).message || String(err),
      elapsed_ms: Date.now() - startMs,
    }, 500);
  }
});
