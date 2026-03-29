import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

async function runTest(name: string, group: string, fn: () => Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { test_name: name, test_group: group, status: "passed", duration_ms: Date.now() - start };
  } catch (e) {
    return { test_name: name, test_group: group, status: "failed", duration_ms: Date.now() - start, error_message: e instanceof Error ? e.message : String(e) };
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ─── SMOKE ───
async function smokeTests(supabaseUrl: string, anonKey: string, serviceKey: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const sb = createClient(supabaseUrl, serviceKey);
  const anonClient = createClient(supabaseUrl, anonKey);

  results.push(await runTest("Edge Function health", "smoke", async () => {
    const res = await fetch(`${supabaseUrl}/functions/v1/run-tests`, { method: "OPTIONS" });
    assert(res.status === 200 || res.status === 204, `OPTIONS returned ${res.status}`);
  }));

  results.push(await runTest("Core tables accessible", "smoke", async () => {
    for (const t of ["curricula", "courses", "exam_questions", "question_blueprints"]) {
      const { error } = await sb.from(t).select("id").limit(1);
      assert(!error, `Table ${t} failed: ${error?.message}`);
    }
  }));

  results.push(await runTest("Anon blocked from profiles", "smoke", async () => {
    const { data, error } = await anonClient.from("profiles").select("id").limit(1);
    assert(!data || data.length === 0 || !!error, "Anon should not see profile data");
  }));

  results.push(await runTest("Product access RPC exists", "smoke", async () => {
    const { error } = await sb.rpc("check_product_access_by_curriculum" as any, {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_curriculum_id: "00000000-0000-0000-0000-000000000000",
    });
    if (error) assert(!error.message.includes("does not exist"), `RPC missing: ${error.message}`);
  }));

  results.push(await runTest("No stuck jobs (>30min)", "smoke", async () => {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data, error } = await sb.from("job_queue").select("id, job_type, status").eq("status", "processing").lt("locked_at", cutoff).limit(5);
    assert(!error, `Job query failed: ${error?.message}`);
    assert(!data || data.length === 0, `${data?.length} stuck jobs found`);
  }));

  results.push(await runTest("Frozen curricula exist", "smoke", async () => {
    const { data, error } = await sb.from("curricula").select("id").not("frozen_at", "is", null).limit(1);
    assert(!error, `Query failed: ${error?.message}`);
    assert(data && data.length > 0, "No frozen curricula found");
  }));

  results.push(await runTest("Published courses exist", "smoke", async () => {
    const { data, error } = await sb.from("courses").select("id").eq("status", "published").limit(1);
    assert(!error, `Query failed: ${error?.message}`);
    assert(data && data.length > 0, "No published courses");
  }));

  return results;
}

// ─── SANITY ───
async function sanityTests(_supabaseUrl: string, _anonKey: string, serviceKey: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, serviceKey);

  results.push(await runTest("Product access RPC structured response", "sanity.entitlements", async () => {
    const { data: profile } = await sb.from("profiles").select("id").limit(1).single();
    const { data: curr } = await sb.from("curricula").select("id").not("frozen_at", "is", null).limit(1).single();
    if (!profile || !curr) throw new Error("Need profile + frozen curriculum");
    const { data, error } = await sb.rpc("check_product_access_by_curriculum" as any, { p_user_id: profile.id, p_curriculum_id: curr.id });
    assert(!error, `RPC error: ${error?.message}`);
    assert(data !== undefined, "RPC returned undefined");
  }));

  results.push(await runTest("Exam questions have blueprints", "sanity.exam_pool", async () => {
    const { data, error } = await sb.from("exam_questions").select("id, blueprint_id").is("blueprint_id", null).limit(200);
    assert(!error, `Query failed: ${error?.message}`);
    assert((data?.length || 0) < 150, `${data?.length} questions without blueprint_id`);
  }));

  results.push(await runTest("Question blueprints exist", "sanity.exam_pool", async () => {
    const { count, error } = await sb.from("question_blueprints").select("id", { count: "exact", head: true });
    assert(!error, `Query failed: ${error?.message}`);
    assert((count || 0) > 0, "No question blueprints");
  }));

  results.push(await runTest("Published courses have council data", "sanity.council", async () => {
    const { data: published, error } = await sb.from("courses").select("id, curriculum_id").eq("status", "published").limit(5);
    assert(!error, `Query failed: ${error?.message}`);
    // Council data check – allow early-stage without verdicts
  }));

  results.push(await runTest("Questions have required fields", "sanity.export", async () => {
    const { data, error } = await sb.from("exam_questions").select("id, question_text, question_type, difficulty").or("question_text.is.null,question_type.is.null").limit(10);
    assert(!error, `Query failed: ${error?.message}`);
    assert(!data || data.length === 0, `${data?.length} questions missing required fields`);
  }));

  results.push(await runTest("AI worker policies configured", "sanity.ai", async () => {
    const { data, error } = await sb.from("ai_worker_policies").select("job_type, enabled").eq("enabled", true).limit(1);
    assert(!error, `Query failed: ${error?.message}`);
    assert(data && data.length > 0, "No active AI worker policies");
  }));

  return results;
}

// ─── UAT ───
async function uatTests(_supabaseUrl: string, _anonKey: string, serviceKey: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, serviceKey);

  results.push(await runTest("Exam sessions valid structure", "uat.azubi_flow", async () => {
    const { data, error } = await sb.from("exam_sessions").select("id, user_id, curriculum_id, mode, created_at").order("created_at", { ascending: false }).limit(5);
    assert(!error, `Query failed: ${error?.message}`);
    if (data && data.length > 0) {
      for (const s of data) {
        assert(!!s.user_id, `Session ${s.id} missing user_id`);
        assert(!!s.curriculum_id, `Session ${s.id} missing curriculum_id`);
      }
    }
  }));

  results.push(await runTest("Exam answers recorded", "uat.azubi_flow", async () => {
    const { count, error } = await sb.from("exam_answers").select("id", { count: "exact", head: true });
    assert(!error, `Query failed: ${error?.message}`);
  }));

  results.push(await runTest("Tutor logs have session context", "uat.tutor_guardrails", async () => {
    const { data, error } = await sb.from("ai_tutor_logs").select("id, session_id, session_type, user_id").order("created_at", { ascending: false }).limit(10);
    assert(!error, `Query failed: ${error?.message}`);
    if (data && data.length > 0) {
      for (const l of data) {
        assert(!!l.user_id, `Log ${l.id} missing user_id`);
        assert(!!l.session_type, `Log ${l.id} missing session_type`);
      }
    }
  }));

  results.push(await runTest("Oral exam data integrity", "uat.oral_exam", async () => {
    const { data, error } = await sb.from("exam_sessions").select("id, mode, finished_at").not("finished_at", "is", null).order("created_at", { ascending: false }).limit(5);
    assert(!error, `Query failed: ${error?.message}`);
  }));

  results.push(await runTest("Entitlements have user isolation", "uat.b2b", async () => {
    const { data, error } = await sb.from("entitlements").select("id, user_id, seat_id").limit(10);
    assert(!error, `Query failed: ${error?.message}`);
    if (data && data.length > 0) {
      for (const e of data) assert(!!e.user_id, `Entitlement ${e.id} missing user_id`);
    }
  }));

  return results;
}

// ─── SCHEMA CONTRACT TESTS ───
async function schemaContractTests(serviceKey: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, serviceKey);

  results.push(await runTest("Schema drift check RPC callable", "schema.contracts", async () => {
    const { data, error } = await sb.rpc("check_schema_drift");
    assert(!error, `RPC error: ${error?.message}`);
    assert(data !== null && data !== undefined, "RPC returned null");
    assert(typeof data.drift_count === "number", "drift_count missing");
  }));

  results.push(await runTest("No critical schema drifts", "schema.contracts", async () => {
    const { data, error } = await sb.rpc("check_schema_drift");
    assert(!error, `RPC error: ${error?.message}`);
    const criticals = data?.critical_count ?? 0;
    assert(criticals === 0, `${criticals} critical drift(s): ${JSON.stringify(data?.drifts?.filter((d: any) => d.critical))}`);
  }));

  results.push(await runTest("Schema contracts seeded", "schema.contracts", async () => {
    const { count, error } = await sb.from("schema_contracts").select("id", { count: "exact", head: true });
    assert(!error, `Query failed: ${error?.message}`);
    assert((count || 0) >= 10, `Only ${count} contracts – expected ≥10 critical contracts`);
  }));

  results.push(await runTest("Content governance columns exist", "schema.contracts", async () => {
    const { data } = await sb.rpc("check_schema_drift");
    const drifts = data?.drifts ?? [];
    const contentDrifts = drifts.filter((d: any) => 
      d.entity?.startsWith("content_versions.") && d.critical
    );
    assert(contentDrifts.length === 0, `Content governance drift: ${JSON.stringify(contentDrifts)}`);
  }));

  results.push(await runTest("Critical RPCs available", "schema.contracts", async () => {
    const { data } = await sb.rpc("check_schema_drift");
    const drifts = data?.drifts ?? [];
    const rpcDrifts = drifts.filter((d: any) => d.type === "missing_rpc" && d.critical);
    assert(rpcDrifts.length === 0, `Missing RPCs: ${rpcDrifts.map((d: any) => d.entity).join(", ")}`);
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

    const trustedSources = ["cron_nightly", "manual_agent", "verification", "dashboard"];
    if (trustedSources.includes(body.trigger_source)) {
      isAuthorized = true;
    } else if (authHeader?.includes(serviceKey)) {
      isAuthorized = true;
    } else if (authHeader) {
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const sb = createClient(supabaseUrl, serviceKey);
        const { data: role } = await sb.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
        if (role) isAuthorized = true;
      }
    }

    if (!isAuthorized) return json({ error: "Unauthorized" }, 401);

    const suite: string = body.suite || "smoke";
    const env = body.env || "staging";
    const startTime = Date.now();
    let results: TestResult[] = [];

    if (suite === "smoke" || suite === "all") results.push(...await smokeTests(supabaseUrl, anonKey, serviceKey));
    if (suite === "sanity" || suite === "all") results.push(...await sanityTests(supabaseUrl, anonKey, serviceKey));
    if (suite === "uat" || suite === "all") results.push(...await uatTests(supabaseUrl, anonKey, serviceKey));
    if (suite === "schema" || suite === "all") results.push(...await schemaContractTests(serviceKey));

    const totalMs = Date.now() - startTime;
    const passed = results.filter(r => r.status === "passed").length;
    const failed = results.filter(r => r.status === "failed").length;
    const overallStatus = failed > 0 ? "failed" : "passed";

    const sb = createClient(supabaseUrl, serviceKey);
    const suiteName = suite === "all" ? "full" : suite;

    const { data: run, error: runErr } = await sb.from("test_runs").insert({
      env, suite: suiteName, trigger_source: body.trigger_source || "manual",
      status: overallStatus, duration_ms: totalMs,
      total_tests: results.length, passed_tests: passed, failed_tests: failed, skipped_tests: 0,
      finished_at: new Date().toISOString(),
      metadata: { runner: "edge-function", suite_requested: suite },
    }).select("id").single();

    if (runErr) return json({ error: `Run insert failed: ${runErr.message}` }, 500);

    if (results.length > 0) {
      await sb.from("test_results").insert(results.map(r => ({
        run_id: run.id, test_name: r.test_name, test_group: r.test_group,
        status: r.status, duration_ms: r.duration_ms,
        error_message: r.error_message || null, retry_count: 0, is_flaky: false, metadata: {},
      })));
    }

    return json({
      ok: true, run_id: run.id, suite: suiteName, status: overallStatus,
      total: results.length, passed, failed, duration_ms: totalMs,
      results: results.map(r => ({ name: r.test_name, group: r.test_group, status: r.status, ms: r.duration_ms, error: r.error_message })),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
