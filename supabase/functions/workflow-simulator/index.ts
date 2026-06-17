// =========================================================================
// workflow-simulator — Reality-Driven E2E Synthetic Runner (Phase 1)
// =========================================================================
// Invocation:
//   POST { scenario_key, mode?: 'smoke'|'live', run_id?: uuid, triggered_by?: 'cron'|'admin' }
// Returns: { run_id, status, total, passed, failed, skipped, duration_ms }
//
// SAFETY: Phase 1 = read-side health probes only. "live" mode is reserved
// for future destructive runs; today live == smoke (same probes, marked).
// =========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

type StepResult = {
  name: string;
  status: "pass" | "fail" | "skip";
  latency_ms: number;
  details?: Record<string, unknown>;
  error?: string;
};

async function probe(
  name: string,
  fn: () => Promise<Record<string, unknown> | void>,
): Promise<StepResult> {
  const t0 = Date.now();
  try {
    const details = (await fn()) ?? {};
    return { name, status: "pass", latency_ms: Date.now() - t0, details };
  } catch (e) {
    return {
      name,
      status: "fail",
      latency_ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function skip(name: string, reason: string): StepResult {
  return { name, status: "skip", latency_ms: 0, details: { reason } };
}

// --------------------------- SCENARIOS -----------------------------------

async function runLearnerJourney(mode: string): Promise<StepResult[]> {
  const steps: StepResult[] = [];

  steps.push(await probe("profiles_table_reachable", async () => {
    const { count, error } = await admin
      .from("profiles").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { profile_count: count };
  }));

  steps.push(await probe("course_grants_index_healthy", async () => {
    const { count, error } = await admin
      .from("learner_course_grants").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { active_grants: count };
  }));

  steps.push(await probe("lessons_pool_nonempty", async () => {
    const { count, error } = await admin
      .from("lessons").select("*", { count: "exact", head: true });
    if (error) throw error;
    if ((count ?? 0) < 1) throw new Error("lessons table empty");
    return { lesson_count: count };
  }));

  steps.push(await probe("minicheck_pool_available", async () => {
    const { count, error } = await admin
      .from("minicheck_questions").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { minicheck_count: count };
  }));

  steps.push(await probe("exam_pool_available", async () => {
    const { count, error } = await admin
      .from("exam_questions").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { exam_question_count: count };
  }));

  steps.push(await probe("readiness_engine_recent", async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error } = await admin
      .from("readiness_scores").select("*", { count: "exact", head: true })
      .gte("updated_at", since);
    if (error) throw error;
    return { recent_24h: count };
  }));

  if (mode === "live") {
    steps.push(skip("synthetic_signup", "live writes deferred to phase 2"));
  }
  return steps;
}

async function runB2BOrgJourney(_mode: string): Promise<StepResult[]> {
  const steps: StepResult[] = [];

  steps.push(await probe("org_licenses_active", async () => {
    const { count, error } = await admin
      .from("org_licenses").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { license_count: count };
  }));

  steps.push(await probe("org_seats_assigned", async () => {
    const { count, error } = await admin
      .from("org_license_seats").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { seat_count: count };
  }));

  steps.push(await probe("org_invites_pending", async () => {
    const { count, error } = await admin
      .from("org_license_invites").select("*", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) throw error;
    return { pending_invites: count };
  }));

  steps.push(await probe("owner_digest_recent", async () => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { count, error } = await admin
      .from("org_owner_digests").select("*", { count: "exact", head: true })
      .gte("created_at", since);
    if (error) throw error;
    return { digests_7d: count };
  }));

  steps.push(await probe("renewal_links_recent", async () => {
    const { count, error } = await admin
      .from("org_renewal_links").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { renewal_links: count };
  }));

  steps.push(await probe("stripe_event_log_alive", async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error } = await admin
      .from("stripe_event_log").select("*", { count: "exact", head: true })
      .gte("created_at", since);
    if (error) throw error;
    return { stripe_events_24h: count };
  }));

  return steps;
}

async function runContentFactory(_mode: string): Promise<StepResult[]> {
  const steps: StepResult[] = [];

  steps.push(await probe("intake_queue_processing", async () => {
    const { count, error } = await admin
      .from("curriculum_intake_jobs").select("*", { count: "exact", head: true })
      .in("status", ["queued", "running"]);
    if (error) throw error;
    return { in_flight: count };
  }));

  steps.push(await probe("council_dag_edges_present", async () => {
    const { count, error } = await admin
      .from("council_dag_edges").select("*", { count: "exact", head: true });
    if (error) throw error;
    if ((count ?? 0) < 1) throw new Error("council_dag_edges empty — DAG missing");
    return { edges: count };
  }));

  steps.push(await probe("quality_gate_recent_decisions", async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error } = await admin
      .from("quality_gate_decision_history").select("*", { count: "exact", head: true })
      .gte("created_at", since);
    if (error) throw error;
    return { gate_decisions_24h: count };
  }));

  steps.push(await probe("packages_in_pipeline", async () => {
    const { count, error } = await admin
      .from("course_packages").select("*", { count: "exact", head: true })
      .neq("status", "approved");
    if (error) throw error;
    return { wip_packages: count };
  }));

  steps.push(await probe("quarantine_state_visible", async () => {
    const { count, error } = await admin
      .from("package_quarantine_ledger").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { quarantine_rows: count };
  }));

  steps.push(await probe("job_queue_health", async () => {
    const { count, error } = await admin
      .from("job_queue").select("*", { count: "exact", head: true })
      .in("status", ["queued", "running"]);
    if (error) throw error;
    return { jobs_in_flight: count };
  }));

  return steps;
}

async function runSeoDistribution(_mode: string): Promise<StepResult[]> {
  const steps: StepResult[] = [];

  steps.push(await probe("seo_pages_published", async () => {
    const { count, error } = await admin
      .from("seo_content_pages").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { pages: count };
  }));

  steps.push(await probe("indexnow_queue_alive", async () => {
    const { count, error } = await admin
      .from("seo_refresh_queue").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { queue_size: count };
  }));

  steps.push(await probe("submission_logs_recent", async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error } = await admin
      .from("seo_submission_logs").select("*", { count: "exact", head: true })
      .gte("created_at", since);
    if (error) throw error;
    return { submissions_24h: count };
  }));

  steps.push(await probe("distribution_runs_recent", async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error } = await admin
      .from("distribution_runs").select("*", { count: "exact", head: true })
      .gte("created_at", since);
    if (error) throw error;
    return { runs_24h: count };
  }));

  steps.push(await probe("bridge_activations_present", async () => {
    const { count, error } = await admin
      .from("seo_bridge_activations").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { bridges: count };
  }));

  steps.push(await probe("crawl_policy_present", async () => {
    const { count, error } = await admin
      .from("route_crawl_policy").select("*", { count: "exact", head: true });
    if (error) throw error;
    return { policies: count };
  }));

  return steps;
}

const REGISTRY: Record<string, (mode: string) => Promise<StepResult[]>> = {
  learner_journey: runLearnerJourney,
  b2b_org_journey: runB2BOrgJourney,
  content_factory: runContentFactory,
  seo_distribution: runSeoDistribution,
};

// --------------------------- HTTP HANDLER --------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const scenario_key: string = body.scenario_key;
    const mode: string = body.mode === "live" ? "live" : "smoke";
    const triggered_by: string = body.triggered_by === "cron" ? "cron" : "admin";
    let run_id: string | undefined = body.run_id;

    const scenarioFn = REGISTRY[scenario_key];
    if (!scenarioFn) {
      return new Response(
        JSON.stringify({ error: `unknown scenario: ${scenario_key}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Create run row if caller didn't pre-create one (e.g. cron)
    if (!run_id) {
      const { data, error } = await admin
        .from("workflow_simulator_runs")
        .insert({ scenario_key, mode, triggered_by, status: "running" })
        .select("id").single();
      if (error) throw error;
      run_id = data.id as string;
    }

    const t0 = Date.now();
    const steps = await scenarioFn(mode);
    const duration_ms = Date.now() - t0;

    // Persist steps
    if (steps.length) {
      const rows = steps.map((s, i) => ({
        run_id,
        step_index: i,
        name: s.name,
        status: s.status,
        latency_ms: s.latency_ms,
        details: s.details ?? {},
        error: s.error ?? null,
        finished_at: new Date().toISOString(),
      }));
      const { error: stepErr } = await admin
        .from("workflow_simulator_steps").insert(rows);
      if (stepErr) throw stepErr;
    }

    const passed = steps.filter((s) => s.status === "pass").length;
    const failed = steps.filter((s) => s.status === "fail").length;
    const skipped = steps.filter((s) => s.status === "skip").length;
    const status = failed > 0
      ? (passed > 0 ? "partial" : "failed")
      : "passed";

    const summary = {
      scenario_key,
      mode,
      first_failure: steps.find((s) => s.status === "fail")?.name ?? null,
    };

    await admin.from("workflow_simulator_runs").update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms,
      total_steps: steps.length,
      passed, failed, skipped,
      summary,
    }).eq("id", run_id);

    return new Response(
      JSON.stringify({
        run_id, status, total: steps.length, passed, failed, skipped, duration_ms,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
