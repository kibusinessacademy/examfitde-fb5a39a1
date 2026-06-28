// pipeline-recovery-run — PIPELINE.RECOVERY.OS.2
// Orchestrates a BATCH of approved recovery actions.
// - Captures pre-snapshot per target package
// - Calls existing pipeline-recovery-act per action (in-process)
// - Records pipeline_recovery_runs + per-action pre_state
// - NEVER mutates publish/integrity/council fields. Verify happens separately.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { RECOVERY_RUN_POLICY } from "../_shared/pipelineRecovery/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RunPayload {
  plan_hash?: string;
  reason: string;
  actions: Array<{
    action_id: string;
    action_type: string;
    cause: string;
    target_package_id: string | null;
    reason?: string;
    steps_to_enqueue?: string[];
    metadata?: Record<string, unknown>;
  }>;
}

async function probePackage(admin: any, pkgId: string) {
  const { data: pkg } = await admin.from("course_packages")
    .select("id,status,build_progress,integrity_passed,council_approved,is_published,updated_at")
    .eq("id", pkgId).maybeSingle();
  const { data: jobs } = await admin.from("job_queue")
    .select("job_type,status,attempts,updated_at")
    .eq("package_id", pkgId)
    .order("updated_at", { ascending: false })
    .limit(50);
  return {
    pkg: pkg ? {
      package_id: pkg.id, status: pkg.status, build_progress: pkg.build_progress ?? 0,
      integrity_passed: pkg.integrity_passed, council_approved: pkg.council_approved,
      is_published: pkg.is_published, updated_at: pkg.updated_at,
    } : null,
    jobs: jobs ?? [],
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
    const isInternal = cronSecret.length > 0 && headerCron === cronSecret;

    let actorId: string | null = null;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    if (!isInternal) {
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
      const { data: userRes } = await userClient.auth.getUser();
      actorId = userRes?.user?.id ?? null;
      if (!actorId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: actorId, _role: "admin" });
      if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    const body = (await req.json()) as RunPayload;
    if (!body?.actions?.length || !body?.reason || body.reason.trim().length < 5) {
      return new Response(JSON.stringify({ error: "bad_request" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.actions.length > RECOVERY_RUN_POLICY.MAX_ACTIONS_PER_RUN) {
      return new Response(JSON.stringify({ error: "too_many_actions", max: RECOVERY_RUN_POLICY.MAX_ACTIONS_PER_RUN }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const runId = `recovery_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const preSnapshot: Record<string, any> = {};
    for (const a of body.actions) {
      if (a.target_package_id && !preSnapshot[a.target_package_id]) {
        preSnapshot[a.target_package_id] = await probePackage(admin, a.target_package_id);
      }
    }

    await admin.from("pipeline_recovery_runs").insert({
      run_id: runId,
      plan_hash: body.plan_hash ?? null,
      initiated_by: actorId,
      status: "executing",
      reason: body.reason,
      action_ids: body.actions.map((a) => a.action_id),
      pre_snapshot: preSnapshot,
    });

    // Execute each action via the existing act endpoint (HTTP self-invocation keeps SSOT)
    const actUrl = `${supabaseUrl}/functions/v1/pipeline-recovery-act`;
    const results: any[] = [];
    for (const a of body.actions) {
      const r = await fetch(actUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: anon },
        body: JSON.stringify({ ...a, reason: a.reason ?? body.reason }),
      });
      const j = await r.json().catch(() => ({ ok: false, error: "non_json" }));
      results.push({ action_id: a.action_id, ok: r.ok, response: j });
      // Tag executed action row with run_id + pre_state
      await admin.from("pipeline_recovery_actions").update({
        run_id: runId,
        pre_state: a.target_package_id ? preSnapshot[a.target_package_id] : null,
      }).eq("action_id", a.action_id);
    }

    await admin.from("pipeline_recovery_runs").update({
      status: "executed",
      executed_at: new Date().toISOString(),
      outcome: { execution_results: results },
    }).eq("run_id", runId);

    await admin.from("auto_heal_log").insert({
      action_type: "pipeline_recovery_run_executed",
      target_id: null,
      target_type: "pipeline_recovery_run",
      input_params: { run_id: runId, action_count: body.actions.length, plan_hash: body.plan_hash ?? null },
      result_status: "completed",
      result_detail: { reason: body.reason, results, actor_uid: actorId },
      metadata: { source: "pipeline_recovery_os_2" },
    });

    return new Response(JSON.stringify({ ok: true, run_id: runId, executed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pipeline-recovery-run error", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
