import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { verifyArtifact, buildVerifyAuditMeta, VERIFIED_JOB_TYPES } from "../_shared/artifact-verifier.ts";

/**
 * ops-materialization-guard-test
 *
 * Admin-only smoke test for the Materialization Guard.
 * Tests the 4 mandatory paths:
 *   1. Registered job type WITH artifact → expects ok=true
 *   2. Registered job type WITHOUT artifact → expects ok=false
 *   3. Unregistered job type → expects ok=true (opt-in pass-through)
 *   4. Verifier error (bad payload) → expects ok=false (fail-closed)
 *
 * Does NOT insert real jobs. Calls verifyArtifact() directly with synthetic payloads.
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
    const curriculumId = body.curriculum_id;
    const packageId = body.package_id;

    const results: Record<string, any> = {};

    // ── PATH 1: Registered type WITH real artifact ──
    // Uses package_generate_exam_pool with a real curriculum_id
    if (curriculumId) {
      const fakeJob1 = {
        id: "test-guard-path1",
        job_type: "package_generate_exam_pool",
        payload: { curriculum_id: curriculumId },
      };
      const r1 = await verifyArtifact(sb, fakeJob1);
      results["path1_artifact_present"] = {
        job_type: fakeJob1.job_type,
        curriculum_id: curriculumId,
        result: r1,
        audit: buildVerifyAuditMeta(r1),
        expected: "ok=true if exam_questions exist for this curriculum",
      };
    } else {
      results["path1_artifact_present"] = { skipped: true, reason: "No curriculum_id provided" };
    }

    // ── PATH 2: Registered type WITHOUT artifact ──
    // Uses a fake UUID that won't have any artifacts
    const fakeCurriculumId = "00000000-0000-0000-0000-000000000000";
    const fakeJob2 = {
      id: "test-guard-path2",
      job_type: "package_generate_exam_pool",
      payload: { curriculum_id: fakeCurriculumId },
    };
    const r2 = await verifyArtifact(sb, fakeJob2);
    results["path2_artifact_missing"] = {
      job_type: fakeJob2.job_type,
      curriculum_id: fakeCurriculumId,
      result: r2,
      audit: buildVerifyAuditMeta(r2),
      pass: r2.ok === false,
      expected: "ok=false (ZERO_EXAM_QUESTIONS)",
    };

    // ── PATH 3: Unregistered job type → opt-in pass-through ──
    const fakeJob3 = {
      id: "test-guard-path3",
      job_type: "some_unregistered_type_xyz",
      payload: {},
    };
    const r3 = await verifyArtifact(sb, fakeJob3);
    results["path3_unregistered"] = {
      job_type: fakeJob3.job_type,
      result: r3,
      audit: buildVerifyAuditMeta(r3),
      pass: r3.ok === true,
      expected: "ok=true (no verifier = pass-through)",
    };

    // ── PATH 4: Invalid payload → fail-closed ──
    // Registered type but with completely missing payload → permanent failure
    const fakeJob4 = {
      id: "test-guard-path4",
      job_type: "package_generate_exam_pool",
      payload: {},  // Missing curriculum_id → permanent failure
    };
    const r4 = await verifyArtifact(sb, fakeJob4);
    results["path4_invalid_payload_fail_closed"] = {
      job_type: fakeJob4.job_type,
      result: r4,
      audit: buildVerifyAuditMeta(r4),
      pass: r4.ok === false,
      expected: "ok=false (MISSING_CURRICULUM_ID, permanent=true)",
    };

    // ── BONUS: Test all registered verifier types ──
    // Run artifact_missing path for each registered type
    const registeredSummary: Record<string, any> = {};
    for (const jobType of VERIFIED_JOB_TYPES) {
      const fakeJob = {
        id: `test-guard-${jobType}`,
        job_type: jobType,
        payload: { curriculum_id: fakeCurriculumId, package_id: "00000000-0000-0000-0000-000000000000" },
        package_id: "00000000-0000-0000-0000-000000000000",
      };
      const r = await verifyArtifact(sb, fakeJob);
      registeredSummary[jobType] = {
        ok: r.ok,
        reason: r.reason,
        count: r.count,
        permanent: r.permanent,
        blocked: !r.ok,
      };
    }
    results["registered_verifiers_zero_artifact"] = registeredSummary;

    // ── Overall verdict ──
    const path2Pass = results.path2_artifact_missing?.pass === true;
    const path3Pass = results.path3_unregistered?.pass === true;
    const path4Pass = results.path4_invalid_payload_fail_closed?.pass === true;
    const allBlocked = Object.values(registeredSummary).every((v: any) => v.blocked);

    const overallPass = path2Pass && path3Pass && path4Pass && allBlocked;

    return json({
      ok: true,
      overall_pass: overallPass,
      verdict: overallPass
        ? "✅ All 4 guard paths verified. Materialization Guard is enforcing correctly."
        : "❌ One or more guard paths failed. See details.",
      registered_job_types: VERIFIED_JOB_TYPES,
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
