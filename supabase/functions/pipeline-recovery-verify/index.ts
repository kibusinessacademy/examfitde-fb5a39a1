// pipeline-recovery-verify — PIPELINE.RECOVERY.OS.2
// Captures post-snapshot, classifies each action's outcome deterministically,
// writes verification_status/detail per action and updates the run.
// NEVER mutates publish/integrity/council fields.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyOutcome, aggregateRunOutcome, RECOVERY_RUN_POLICY, type OutcomeVerdict } from "../_shared/pipelineRecovery/runOutcome.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function probePackage(admin: any, pkgId: string) {
  const { data: pkg } = await admin.from("course_packages")
    .select("id,status,build_progress,integrity_passed,council_approved,is_published,updated_at")
    .eq("id", pkgId).maybeSingle();
  const { data: jobs } = await admin.from("job_queue")
    .select("job_type,status,attempts,updated_at")
    .eq("package_id", pkgId)
    .order("updated_at", { ascending: false })
    .limit(50);
  const { count: qCount } = await admin.from("package_quarantine_ledger")
    .select("id", { count: "exact", head: true })
    .eq("package_id", pkgId).eq("status", "active");
  return {
    pkg: pkg ? {
      package_id: pkg.id, status: pkg.status, build_progress: pkg.build_progress ?? 0,
      integrity_passed: pkg.integrity_passed, council_approved: pkg.council_approved,
      is_published: pkg.is_published, updated_at: pkg.updated_at,
    } : null,
    jobs: jobs ?? [],
    quarantined: (qCount ?? 0) > 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    const headerCron = req.headers.get("x-cron-secret") ?? "";

    let actorId: string | null = null;
    let isInternal = cronSecret.length > 0 && headerCron === cronSecret;

    if (!isInternal) {
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
      const { data: userRes } = await userClient.auth.getUser();
      actorId = userRes?.user?.id ?? null;
      if (!actorId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    if (actorId) {
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: actorId, _role: "admin" });
      if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({} as any));
    const runId: string | undefined = body?.run_id;
    if (!runId) {
      return new Response(JSON.stringify({ error: "missing_run_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: run, error: runErr } = await admin.from("pipeline_recovery_runs")
      .select("*").eq("run_id", runId).maybeSingle();
    if (runErr || !run) {
      return new Response(JSON.stringify({ error: "run_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: actions } = await admin.from("pipeline_recovery_actions")
      .select("action_id,action_type,target_package_id,executed_at,verification_status,pre_state")
      .eq("run_id", runId);
    if (!actions?.length) {
      return new Response(JSON.stringify({ error: "no_actions" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const now = new Date().toISOString();
    const postSnapshot: Record<string, any> = {};
    const verdicts: OutcomeVerdict[] = [];
    const perAction: any[] = [];
    const startMs = new Date(run.created_at).getTime();
    const timedOut = (Date.now() - startMs) > RECOVERY_RUN_POLICY.VERIFICATION_TIMEOUT_MS;

    for (const a of actions) {
      let probe;
      if (a.target_package_id) {
        if (!postSnapshot[a.target_package_id]) postSnapshot[a.target_package_id] = await probePackage(admin, a.target_package_id);
        probe = postSnapshot[a.target_package_id];
      } else {
        probe = { pkg: null, jobs: [], quarantined: false };
      }
      const pre = (a.pre_state as any) ?? { pkg: null, jobs: [] };
      let verdict: OutcomeVerdict;
      if (timedOut && (!a.executed_at)) {
        verdict = { status: "verification_timeout", reason: "run_timed_out", signals: {} };
      } else {
        verdict = classifyOutcome(a.action_type as any, {
          pkg_before: pre.pkg ?? null,
          pkg_after: probe.pkg,
          jobs_before: pre.jobs ?? [],
          jobs_after: probe.jobs,
          quarantined_after: probe.quarantined,
        }, a.executed_at ?? run.created_at, now);
      }
      verdicts.push(verdict);
      perAction.push({ action_id: a.action_id, verdict });

      await admin.from("pipeline_recovery_actions").update({
        verification_status: verdict.status,
        verification_detail: { reason: verdict.reason, signals: verdict.signals, observed_at: now },
        post_state: probe,
      }).eq("action_id", a.action_id);
    }

    const summary = aggregateRunOutcome(verdicts);
    const runStatus = summary.health === "verifying"
      ? "verifying"
      : summary.health === "verified" ? "verified"
      : summary.health === "verified_regressed" ? "verified_regressed"
      : "verified_partial";

    await admin.from("pipeline_recovery_runs").update({
      status: runStatus,
      verified_at: summary.health === "verifying" ? null : now,
      post_snapshot: postSnapshot,
      outcome: { ...(run.outcome ?? {}), summary, per_action: perAction },
    }).eq("run_id", runId);

    await admin.from("auto_heal_log").insert({
      action_type: "pipeline_recovery_run_verified",
      target_id: null,
      target_type: "pipeline_recovery_run",
      input_params: { run_id: runId },
      result_status: runStatus,
      result_detail: { summary, per_action: perAction, actor_uid: actorId, internal: isInternal },
      metadata: { source: "pipeline_recovery_os_2" },
    });

    return new Response(JSON.stringify({ ok: true, run_id: runId, status: runStatus, summary, per_action: perAction }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pipeline-recovery-verify error", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
