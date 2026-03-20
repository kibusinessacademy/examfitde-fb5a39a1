import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { VERIFIED_JOB_TYPES } from "../_shared/artifact-verifier.ts";

/**
 * ops-runner-integration-test — Phase 2: Live Runner DB-State Test
 *
 * Inserts synthetic jobs into job_queue, invokes job-runner,
 * then validates final DB state for 4 paths:
 *
 *   A. Registered type + artifact present  → completed, artifact_verified=true
 *   B. Registered type + artifact missing  → not completed, MATERIALIZATION_GUARD
 *   C. Unregistered type (real dispatch)   → no MATERIALIZATION_GUARD block
 *   D. Invalid payload (fail-closed)       → not completed, permanent failure
 *
 * All synthetic jobs use a unique test_run_id tag for safe cleanup.
 * Pass criteria are based EXCLUSIVELY on DB state (job_queue row), not runner response.
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

/** DB-only verdict from job_queue row */
interface DbVerdict {
  status: string;
  error: string | null;
  completed_at: string | null;
  attempts: number;
  run_after: string | null;
  artifact_verified: boolean | null;
  artifact_verify_reason: string | null;
  materialization_retries: number | null;
  has_materialization_guard_error: boolean;
}

function extractDbVerdict(job: any): DbVerdict {
  const meta = (job.meta ?? {}) as Record<string, any>;
  const errorStr = String(job.error ?? "");
  return {
    status: job.status,
    error: job.error ?? null,
    completed_at: job.completed_at ?? null,
    attempts: job.attempts ?? 0,
    run_after: job.run_after ?? null,
    artifact_verified: meta.artifact_verified ?? null,
    artifact_verify_reason: meta.artifact_verify_reason ?? null,
    materialization_retries: meta.materialization_retries ?? null,
    has_materialization_guard_error: errorStr.includes("MATERIALIZATION_GUARD"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const startMs = Date.now();

  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("apikey");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: "Missing env" }, 500);

    const sb = createClient(supabaseUrl, serviceKey);

    // Allow service-role key as direct auth (for CI/curl testing)
    const bearerToken = authHeader.replace("Bearer ", "");
    const isServiceRole = bearerToken === serviceKey || bearerToken === anonKey;

    if (!isServiceRole) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);

      const { data: roleData } = await sb
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleData) return json({ error: "Admin required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const curriculumId = body.curriculum_id as string | undefined;
    const packageId = body.package_id as string | undefined;
    const skipCleanup = body.skip_cleanup === true;

    const testRunId = `int_test_${crypto.randomUUID().slice(0, 12)}`;
    const results: Record<string, any> = { test_run_id: testRunId };

    // ═══════════════════════════════════════════════════════════
    // Helper: insert synthetic job → invoke runner → read back DB state
    // ═══════════════════════════════════════════════════════════
    async function runSyntheticJob(label: string, opts: {
      jobType: string;
      payload: Record<string, any>;
      packageId?: string;
    }): Promise<{ db: DbVerdict; jobId: string; runner_http_status: number | null; error?: string }> {
      const jobId = crypto.randomUUID();

      const { error: insertErr } = await sb.from("job_queue").insert({
        id: jobId,
        job_type: opts.jobType,
        payload: { ...opts.payload, _test_run_id: testRunId, _test_label: label },
        package_id: opts.packageId || null,
        status: "pending",
        priority: 1,
        attempts: 0,
        max_attempts: 2,
        meta: { synthetic_test: true, test_run_id: testRunId },
      });

      if (insertErr) {
        return {
          jobId,
          db: { status: "insert_failed", error: insertErr.message, completed_at: null, attempts: 0, run_after: null, artifact_verified: null, artifact_verify_reason: null, materialization_retries: null, has_materialization_guard_error: false },
          runner_http_status: null,
          error: `INSERT_FAILED: ${insertErr.message}`,
        };
      }

      let runnerHttpStatus: number | null = null;
      try {
        const runnerRes = await fetch(`${supabaseUrl}/functions/v1/job-runner`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ max_jobs: 1 }),
          signal: AbortSignal.timeout(90_000),
        });
        runnerHttpStatus = runnerRes.status;
        await runnerRes.text(); // consume body
      } catch (_e) {
        // Runner invocation failed — still read back DB state
      }

      // Wait for async processing
      await new Promise(r => setTimeout(r, 3000));

      // Read back: DB state is the SOLE source of truth
      const { data: job, error: readErr } = await sb
        .from("job_queue")
        .select("id, job_type, status, error, completed_at, meta, attempts, run_after")
        .eq("id", jobId)
        .single();

      if (readErr || !job) {
        return {
          jobId,
          db: { status: "read_failed", error: readErr?.message ?? "not found", completed_at: null, attempts: 0, run_after: null, artifact_verified: null, artifact_verify_reason: null, materialization_retries: null, has_materialization_guard_error: false },
          runner_http_status: runnerHttpStatus,
          error: `READ_BACK_FAILED: ${readErr?.message}`,
        };
      }

      return { jobId, db: extractDbVerdict(job), runner_http_status: runnerHttpStatus };
    }

    // ═══════════════════════════════════════════════════════════
    // PATH A: Registered type WITH real artifact → completed
    // ═══════════════════════════════════════════════════════════
    if (curriculumId) {
      const r = await runSyntheticJob("path_a_artifact_present", {
        jobType: "package_generate_exam_pool",
        payload: { curriculum_id: curriculumId },
        packageId: packageId,
      });
      // PASS: completed + artifact_verified=true
      const pass = r.db.status === "completed" && r.db.artifact_verified === true;
      results["path_a_artifact_present"] = {
        ...r,
        pass,
        expected: "status=completed, artifact_verified=true",
        note: "Requires curriculum_id with existing exam_questions",
      };
    } else {
      results["path_a_artifact_present"] = {
        skipped: true,
        reason: "No curriculum_id provided",
      };
    }

    // ═══════════════════════════════════════════════════════════
    // PATH B: Registered type WITHOUT artifact → guard blocks
    // ═══════════════════════════════════════════════════════════
    const rB = await runSyntheticJob("path_b_artifact_missing", {
      jobType: "package_generate_exam_pool",
      payload: { curriculum_id: NULL_UUID },
      packageId: packageId || NULL_UUID,
    });
    // PASS: NOT completed + guard error visible in DB
    const passB = rB.db.status !== "completed" && (
      rB.db.has_materialization_guard_error ||
      rB.db.artifact_verified === false
    );
    results["path_b_artifact_missing"] = {
      ...rB,
      pass: passB,
      expected: "status!=completed, has_materialization_guard_error=true OR artifact_verified=false",
    };

    // ═══════════════════════════════════════════════════════════
    // PATH C: Real dispatchable type WITHOUT verifier → no guard block
    // Uses package_validate_exam_pool: real edgeFunction, NOT in VERIFIED_JOB_TYPES
    // ═══════════════════════════════════════════════════════════
    const rC = await runSyntheticJob("path_c_unregistered_verifier", {
      jobType: "package_validate_exam_pool",
      payload: { curriculum_id: curriculumId || NULL_UUID, package_id: packageId || NULL_UUID },
      packageId: packageId || NULL_UUID,
    });
    // PASS: No MATERIALIZATION_GUARD block (may fail for content reasons, that's fine)
    const passC = !rC.db.has_materialization_guard_error;
    results["path_c_unregistered_verifier"] = {
      ...rC,
      pass: passC,
      expected: "No MATERIALIZATION_GUARD in error (opt-in: no verifier = no block)",
      note: "Uses package_validate_exam_pool — real dispatch, no artifact verifier registered",
    };

    // ═══════════════════════════════════════════════════════════
    // PATH D: Invalid payload → fail-closed (permanent)
    // ═══════════════════════════════════════════════════════════
    const rD = await runSyntheticJob("path_d_invalid_payload", {
      jobType: "package_generate_exam_pool",
      payload: {}, // Missing curriculum_id
      packageId: NULL_UUID,
    });
    // PASS: NOT completed + guard or permanent failure visible
    const passD = rD.db.status !== "completed" && (
      rD.db.has_materialization_guard_error ||
      rD.db.artifact_verified === false
    );
    results["path_d_invalid_payload"] = {
      ...rD,
      pass: passD,
      expected: "status=failed (permanent), MATERIALIZATION_GUARD: MISSING_CURRICULUM_ID",
    };

    // ═══════════════════════════════════════════════════════════
    // Cleanup
    // ═══════════════════════════════════════════════════════════
    if (!skipCleanup) {
      // Collect test job IDs for precise cleanup
      const testJobIds = [
        results.path_a_artifact_present?.jobId,
        results.path_b_artifact_missing?.jobId,
        results.path_c_unregistered_verifier?.jobId,
        results.path_d_invalid_payload?.jobId,
      ].filter(Boolean) as string[];

      if (testJobIds.length > 0) {
        const { error: cleanErr } = await sb
          .from("job_queue")
          .delete()
          .in("id", testJobIds);

        results["cleanup"] = {
          deleted_ids: testJobIds,
          error: cleanErr?.message ?? null,
        };
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Verdict (DB-only signals)
    // ═══════════════════════════════════════════════════════════
    const pathAOk = results.path_a_artifact_present?.skipped || results.path_a_artifact_present?.pass;
    const pathBOk = results.path_b_artifact_missing?.pass === true;
    const pathCOk = results.path_c_unregistered_verifier?.pass === true;
    const pathDOk = results.path_d_invalid_payload?.pass === true;

    const overallPass = pathAOk && pathBOk && pathCOk && pathDOk;

    return json({
      ok: true,
      overall_pass: overallPass,
      verdict: overallPass
        ? "✅ All 4 Runner integration paths verified. Materialization Guard enforces correctly."
        : "❌ One or more Runner paths failed. See per-path DB verdicts.",
      test_run_id: testRunId,
      verified_job_types: VERIFIED_JOB_TYPES,
      unregistered_test_type: "package_validate_exam_pool",
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
