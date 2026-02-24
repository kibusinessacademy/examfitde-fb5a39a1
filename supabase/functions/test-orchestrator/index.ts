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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth + admin check
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);

    // Admin check
    const { data: roleData } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) return json({ error: "Admin required" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // ── ACTION: report_run ──
    // Called by CI/Playwright to submit test results
    if (action === "report_run") {
      const { env, suite, suite_file, git_sha, trigger_source, status, duration_ms,
              total_tests, passed_tests, failed_tests, skipped_tests, results, metadata } = body;

      if (!env || !suite || !status) {
        return json({ error: "env, suite, status required" }, 400);
      }

      // Insert run
      const { data: run, error: runErr } = await sb.from("test_runs").insert({
        env, suite, suite_file, git_sha,
        trigger_source: trigger_source || "manual",
        status,
        duration_ms,
        total_tests: total_tests || results?.length || 0,
        passed_tests: passed_tests || 0,
        failed_tests: failed_tests || 0,
        skipped_tests: skipped_tests || 0,
        finished_at: new Date().toISOString(),
        metadata: metadata || {},
      }).select("id").single();

      if (runErr) return json({ error: runErr.message }, 500);

      // Insert individual results
      if (Array.isArray(results) && results.length > 0) {
        const rows = results.map((r: any) => ({
          run_id: run.id,
          test_name: r.test_name || r.name,
          test_group: r.test_group || r.group || null,
          status: r.status,
          duration_ms: r.duration_ms || null,
          error_message: r.error_message || null,
          error_snippet: r.error_snippet || null,
          artifact_url: r.artifact_url || null,
          retry_count: r.retry_count || 0,
          is_flaky: r.is_flaky || false,
          metadata: r.metadata || {},
        }));
        const { error: resErr } = await sb.from("test_results").insert(rows);
        if (resErr) return json({ error: resErr.message }, 500);
      }

      return json({ ok: true, run_id: run.id });
    }

    // ── ACTION: get_dashboard ──
    if (action === "get_dashboard") {
      const [runsRes, flakyRes, recentFailsRes] = await Promise.all([
        sb.from("test_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(50),
        sb.from("v_flaky_tests")
          .select("*")
          .limit(20),
        sb.from("test_results")
          .select("*, test_runs(suite, env, started_at)")
          .eq("status", "failed")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      // Compute summary per suite
      const runs = runsRes.data || [];
      const suites = ["smoke", "sanity", "uat"];
      const summary = suites.map((s) => {
        const suiteRuns = runs.filter((r: any) => r.suite === s);
        const last = suiteRuns[0];
        const passRate = suiteRuns.length > 0
          ? Math.round(suiteRuns.filter((r: any) => r.status === "passed").length / suiteRuns.length * 100)
          : null;
        return {
          suite: s,
          total_runs: suiteRuns.length,
          last_status: last?.status || null,
          last_run: last?.started_at || null,
          pass_rate: passRate,
        };
      });

      return json({
        ok: true,
        summary,
        recent_runs: runs.slice(0, 20),
        flaky_tests: flakyRes.data || [],
        recent_failures: recentFailsRes.data || [],
      });
    }

    // ── ACTION: trigger_smoke ──
    // Placeholder: would trigger external CI
    if (action === "trigger_smoke" || action === "trigger_sanity" || action === "trigger_uat") {
      // In production, this would call GitHub Actions API or a runner webhook
      return json({
        ok: true,
        message: `Trigger for ${action.replace("trigger_", "")} queued. Configure CI webhook in metadata.`,
        note: "Set GITHUB_ACTIONS_TOKEN secret and repo in metadata to enable auto-trigger.",
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
