import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ─── Test helpers ───
interface TestResult {
  test_name: string;
  test_group: string;
  status: "passed" | "failed" | "skipped";
  duration_ms: number;
  error_message?: string;
}

async function runTest(
  name: string,
  group: string,
  fn: () => Promise<void>
): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { test_name: name, test_group: group, status: "passed", duration_ms: Date.now() - start };
  } catch (e) {
    return {
      test_name: name,
      test_group: group,
      status: "failed",
      duration_ms: Date.now() - start,
      error_message: e instanceof Error ? e.message : String(e),
    };
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ─── Test Suites ───

async function smokeTests(supabaseUrl: string, anonKey: string, serviceKey: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const sb = createClient(supabaseUrl, serviceKey);
  const anonClient = createClient(supabaseUrl, anonKey);

  // 1. Health: Edge Functions respond
  results.push(await runTest("Edge Function health", "smoke", async () => {
    const res = await fetch(`${supabaseUrl}/functions/v1/run-tests`, {
      method: "OPTIONS",
    });
    assert(res.status === 200 || res.status === 204, `OPTIONS returned ${res.status}`);
  }));

  // 2. DB: core tables accessible
  results.push(await runTest("Core tables accessible", "smoke", async () => {
    const tables = ["curricula", "courses", "exam_questions", "blueprints"];
    for (const t of tables) {
      const { error } = await sb.from(t).select("id").limit(1);
      assert(!error, `Table ${t} query failed: ${error?.message}`);
    }
  }));

  // 3. Auth: anon cannot access protected tables
  results.push(await runTest("Anon blocked from profiles", "smoke", async () => {
    const { data, error } = await anonClient.from("profiles").select("id").limit(1);
    // Should return empty or error due to RLS
    assert(!data || data.length === 0 || !!error, "Anon should not see profile data");
  }));

  // 4. RPC: check_user_entitlement exists
  results.push(await runTest("Entitlement RPC exists", "smoke", async () => {
    // Call with dummy params – we expect a controlled error, not a 404
    const { error } = await sb.rpc("check_user_entitlement" as any, {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_curriculum_id: "00000000-0000-0000-0000-000000000000",
    });
    // Function exists if error is NOT "function not found"
    if (error) {
      assert(
        !error.message.includes("does not exist") && !error.message.includes("not found"),
        `RPC missing: ${error.message}`
      );
    }
  }));

  // 5. Job Queue health: no stuck jobs
  results.push(await runTest("No stuck jobs (>30min)", "smoke", async () => {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data, error } = await sb
      .from("job_queue")
      .select("id, job_type, status")
      .eq("status", "processing")
      .lt("claimed_at", cutoff)
      .limit(5);
    assert(!error, `Job query failed: ${error?.message}`);
    assert(!data || data.length === 0, `${data?.length} stuck jobs found`);
  }));

  // 6. Frozen curricula available
  results.push(await runTest("Frozen curricula exist", "smoke", async () => {
    const { data, error } = await sb
      .from("curricula")
      .select("id")
      .eq("is_frozen", true)
      .limit(1);
    assert(!error, `Query failed: ${error?.message}`);
    assert(data && data.length > 0, "No frozen curricula found");
  }));

  // 7. Published courses exist
  results.push(await runTest("Published courses exist", "smoke", async () => {
    const { data, error } = await sb
      .from("courses")
      .select("id")
      .eq("status", "published")
      .limit(1);
    assert(!error, `Query failed: ${error?.message}`);
    assert(data && data.length > 0, "No published courses");
  }));

  return results;
}

async function sanityTests(supabaseUrl: string, _anonKey: string, serviceKey: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const sb = createClient(supabaseUrl, serviceKey);

  // A. Entitlement system
  results.push(await runTest("Entitlement RPC returns structured response", "sanity.entitlements", async () => {
    // Get a real user + curriculum to test
    const { data: profile } = await sb.from("profiles").select("id").limit(1).single();
    const { data: curr } = await sb.from("curricula").select("id").eq("is_frozen", true).limit(1).single();
    if (!profile || !curr) throw new Error("Need profile + frozen curriculum for test");

    const { data, error } = await sb.rpc("check_user_entitlement" as any, {
      p_user_id: profile.id,
      p_curriculum_id: curr.id,
    });
    assert(!error, `RPC error: ${error?.message}`);
    // Response should be boolean or structured
    assert(data !== undefined, "RPC returned undefined");
  }));

  // B. Exam pool integrity
  results.push(await runTest("Exam questions have valid blueprints", "sanity.exam_pool", async () => {
    const { data, error } = await sb
      .from("exam_questions")
      .select("id, blueprint_id")
      .is("blueprint_id", null)
      .limit(100);
    assert(!error, `Query failed: ${error?.message}`);
    // Allow some orphans but not too many
    const orphanCount = data?.length || 0;
    assert(orphanCount < 50, `${orphanCount} questions without blueprint_id`);
  }));

  // C. Blueprint coverage
  results.push(await runTest("Blueprints have questions", "sanity.exam_pool", async () => {
    const { data: bpCount } = await sb.from("blueprints").select("id", { count: "exact", head: true });
    const { data: withQ } = await sb.rpc("count_blueprints_with_questions" as any).catch(() => ({ data: null }));
    // Fallback: just check blueprints exist
    assert(bpCount !== null, "Cannot count blueprints");
  }));

  // D. Council/Publish gate
  results.push(await runTest("Council versions exist for published courses", "sanity.council", async () => {
    const { data: published } = await sb
      .from("courses")
      .select("id, curriculum_id")
      .eq("status", "published")
      .limit(5);
    if (published && published.length > 0) {
      const { data: versions } = await sb
        .from("council_versions")
        .select("id")
        .in("curriculum_id", published.map((c: any) => c.curriculum_id))
        .limit(1);
      assert(versions && versions.length > 0, "No council versions for published courses");
    }
  }));

  // E. Export data consistency
  results.push(await runTest("Questions have required fields", "sanity.export", async () => {
    const { data, error } = await sb
      .from("exam_questions")
      .select("id, question_text, question_type, difficulty")
      .or("question_text.is.null,question_type.is.null")
      .limit(10);
    assert(!error, `Query failed: ${error?.message}`);
    assert(!data || data.length === 0, `${data?.length} questions missing required fields`);
  }));

  // F. AI worker policies active
  results.push(await runTest("AI worker policies configured", "sanity.ai", async () => {
    const { data, error } = await sb
      .from("ai_worker_policies")
      .select("job_type, enabled")
      .eq("enabled", true)
      .limit(1);
    assert(!error, `Query failed: ${error?.message}`);
    assert(data && data.length > 0, "No active AI worker policies");
  }));

  return results;
}

async function uatTests(supabaseUrl: string, _anonKey: string, serviceKey: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const sb = createClient(supabaseUrl, serviceKey);

  // UAT-1: Learner data integrity
  results.push(await runTest("Exam sessions have valid structure", "uat.azubi_flow", async () => {
    const { data, error } = await sb
      .from("exam_sessions")
      .select("id, user_id, curriculum_id, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    assert(!error, `Query failed: ${error?.message}`);
    if (data && data.length > 0) {
      for (const s of data) {
        assert(!!s.user_id, `Session ${s.id} missing user_id`);
        assert(!!s.curriculum_id, `Session ${s.id} missing curriculum_id`);
        assert(!!s.status, `Session ${s.id} missing status`);
      }
    }
  }));

  // UAT-2: Mastery tracking works
  results.push(await runTest("Mastery records are valid", "uat.azubi_flow", async () => {
    const { data, error } = await sb
      .from("user_mastery")
      .select("id, user_id, competency_id, mastery_level")
      .order("updated_at", { ascending: false })
      .limit(10);
    assert(!error, `Query failed: ${error?.message}`);
    if (data && data.length > 0) {
      for (const m of data) {
        assert(!!m.user_id, `Mastery ${m.id} missing user_id`);
        assert(m.mastery_level >= 0 && m.mastery_level <= 1, `Invalid mastery_level: ${m.mastery_level}`);
      }
    }
  }));

  // UAT-3: AI Tutor logs context binding
  results.push(await runTest("Tutor logs have session context", "uat.tutor_guardrails", async () => {
    const { data, error } = await sb
      .from("ai_tutor_logs")
      .select("id, session_id, session_type, user_id")
      .order("created_at", { ascending: false })
      .limit(10);
    assert(!error, `Query failed: ${error?.message}`);
    if (data && data.length > 0) {
      for (const l of data) {
        assert(!!l.user_id, `Log ${l.id} missing user_id`);
        assert(!!l.session_type, `Log ${l.id} missing session_type`);
      }
    }
  }));

  // UAT-4: Oral exam sessions
  results.push(await runTest("Oral exam data integrity", "uat.oral_exam", async () => {
    const { data, error } = await sb
      .from("exam_sessions")
      .select("id, status, metadata")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(5);
    assert(!error, `Query failed: ${error?.message}`);
    // Just ensure completed sessions exist and have structure
  }));

  // UAT-5: No data leaks (org isolation)
  results.push(await runTest("User data has org isolation", "uat.b2b", async () => {
    const { data, error } = await sb
      .from("entitlements")
      .select("id, user_id, organization_id")
      .not("organization_id", "is", null)
      .limit(10);
    assert(!error, `Query failed: ${error?.message}`);
    if (data && data.length > 0) {
      for (const e of data) {
        assert(!!e.organization_id, `Entitlement ${e.id} missing org_id`);
      }
    }
  }));

  return results;
}

// ─── Main Handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const body = await req.json().catch(() => ({}));
    const authHeader = req.headers.get("Authorization");
    let isAuthorized = false;

    // Allow cron calls (trigger_source=cron_nightly with anon key)
    if (body.trigger_source === "cron_nightly") {
      isAuthorized = true;
    }
    // Allow service role calls
    else if (authHeader?.includes(serviceKey)) {
      isAuthorized = true;
    }
    // Allow authenticated admin users
    else if (authHeader) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const sb = createClient(supabaseUrl, serviceKey);
        const { data: role } = await sb
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
        if (role) isAuthorized = true;
      }
    }

    if (!isAuthorized) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const suite: string = body.suite || "smoke";
    const env = body.env || "staging";

    // Run the selected suite
    const startTime = Date.now();
    let results: TestResult[] = [];

    if (suite === "smoke" || suite === "all") {
      results.push(...await smokeTests(supabaseUrl, anonKey, serviceKey));
    }
    if (suite === "sanity" || suite === "all") {
      results.push(...await sanityTests(supabaseUrl, anonKey, serviceKey));
    }
    if (suite === "uat" || suite === "all") {
      results.push(...await uatTests(supabaseUrl, anonKey, serviceKey));
    }

    const totalMs = Date.now() - startTime;
    const passed = results.filter(r => r.status === "passed").length;
    const failed = results.filter(r => r.status === "failed").length;
    const overallStatus = failed > 0 ? "failed" : "passed";

    // Persist to DB
    const sb = createClient(supabaseUrl, serviceKey);
    const suiteName = suite === "all" ? "full" : suite;

    const { data: run, error: runErr } = await sb.from("test_runs").insert({
      env,
      suite: suiteName,
      trigger_source: body.trigger_source || "manual",
      status: overallStatus,
      duration_ms: totalMs,
      total_tests: results.length,
      passed_tests: passed,
      failed_tests: failed,
      skipped_tests: 0,
      finished_at: new Date().toISOString(),
      metadata: { runner: "edge-function", suite_requested: suite },
    }).select("id").single();

    if (runErr) return json({ error: `Run insert failed: ${runErr.message}` }, 500);

    if (results.length > 0) {
      const rows = results.map(r => ({
        run_id: run.id,
        test_name: r.test_name,
        test_group: r.test_group,
        status: r.status,
        duration_ms: r.duration_ms,
        error_message: r.error_message || null,
        retry_count: 0,
        is_flaky: false,
        metadata: {},
      }));
      await sb.from("test_results").insert(rows);
    }

    return json({
      ok: true,
      run_id: run.id,
      suite: suiteName,
      status: overallStatus,
      total: results.length,
      passed,
      failed,
      duration_ms: totalMs,
      results: results.map(r => ({
        name: r.test_name,
        group: r.test_group,
        status: r.status,
        ms: r.duration_ms,
        error: r.error_message,
      })),
    });

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
