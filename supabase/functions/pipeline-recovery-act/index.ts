// pipeline-recovery-act
// Executes ONE approved recovery action. Idempotent on action_id.
// Never mutates integrity_passed / council_approved / is_published / published_at.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_ACTION_TYPES = new Set([
  "enqueue_done_reaudit",
  "restart_planning",
  "mark_manual_review_required",
  "propose_provider_fallback", // recorded only — no provider hotswap
  "diagnose_only",
]);

const ALLOWED_REAUDIT_JOBS = new Set([
  "package_run_integrity_check",
  "package_quality_council",
  "package_scaffold_learning_course",
]);

interface ActPayload {
  action_id: string;
  action_type: string;
  cause: string;
  target_package_id: string | null;
  reason: string;
  steps_to_enqueue?: string[];
  metadata?: Record<string, unknown>;
  plan_id?: string | null;
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
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(supabaseUrl, anon, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: userRes } = await userClient.auth.getUser();
      actorId = userRes?.user?.id ?? null;
      if (!actorId) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: actorId, _role: "admin" });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    const body = (await req.json()) as ActPayload;
    if (!body?.action_id || !body?.action_type || !body?.reason) {
      return new Response(JSON.stringify({ error: "bad_request" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_ACTION_TYPES.has(body.action_type)) {
      return new Response(JSON.stringify({ error: "forbidden_action" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency — short-circuit if already executed
    const { data: existing } = await admin
      .from("pipeline_recovery_actions")
      .select("id,status,result")
      .eq("action_id", body.action_id)
      .maybeSingle();
    if (existing?.status === "completed") {
      return new Response(JSON.stringify({ ok: true, idempotent: true, result: existing.result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result: Record<string, unknown> = { kind: body.action_type };

    if (body.action_type === "enqueue_done_reaudit" && body.target_package_id) {
      const steps = (body.steps_to_enqueue ?? []).filter((s) => {
        const job = `package_${s}`;
        return ALLOWED_REAUDIT_JOBS.has(job);
      });
      const inserted: string[] = [];
      for (const step of steps) {
        const jobType = `package_${step}`;
        // Skip if a fresh job already exists
        const { data: open } = await admin.from("job_queue")
          .select("id").eq("package_id", body.target_package_id).eq("job_type", jobType)
          .in("status", ["pending", "processing"]).limit(1);
        if (open && open.length > 0) continue;
        const { error } = await admin.from("job_queue").insert({
          job_type: jobType,
          package_id: body.target_package_id,
          status: "pending",
          payload: { package_id: body.target_package_id, source: "pipeline_recovery_os_1" },
        });
        if (!error) inserted.push(jobType);
      }
      result.enqueued = inserted;
    } else if (body.action_type === "restart_planning" && body.target_package_id) {
      const { data: open } = await admin.from("job_queue")
        .select("id").eq("package_id", body.target_package_id).eq("job_type", "package_scaffold_learning_course")
        .in("status", ["pending", "processing"]).limit(1);
      if (!open || open.length === 0) {
        await admin.from("job_queue").insert({
          job_type: "package_scaffold_learning_course",
          package_id: body.target_package_id,
          status: "pending",
          payload: { package_id: body.target_package_id, source: "pipeline_recovery_os_1" },
        });
        result.restarted = true;
      } else {
        result.restarted = false;
        result.note = "open_job_exists";
      }
    } else if (body.action_type === "mark_manual_review_required" && body.target_package_id) {
      // Recorded as quarantine entry — no direct status mutation here.
      const { error: qErr } = await admin.from("package_quarantine_ledger").insert({
        package_id: body.target_package_id,
        reason_code: "LF_REPAIR_LOOP",
        reason_detail: body.reason,
        status: "under_review",
        metadata: { source: "pipeline_recovery_os_1", action_id: body.action_id },
      });
      if (qErr) {
        result.quarantined = false;
        result.error = qErr.message;
      } else {
        result.quarantined = true;
      }
    } else if (body.action_type === "propose_provider_fallback") {

      result.proposal_recorded = true;
    } else if (body.action_type === "diagnose_only") {
      result.diagnosis_recorded = true;
    }

    // Record action
    await admin.from("pipeline_recovery_actions").upsert({
      action_id: body.action_id,
      plan_id: body.plan_id ?? null,
      action_type: body.action_type,
      cause: body.cause,
      target_package_id: body.target_package_id,
      status: "completed",
      reason: body.reason,
      actor_uid: actorId,
      executed_at: new Date().toISOString(),
      result,
    }, { onConflict: "action_id" });

    // Audit (auto_heal_log schema: action_type / target_id / target_type / input_params / result_status / result_detail / metadata)
    await admin.from("auto_heal_log").insert({
      action_type: `pipeline_recovery_${body.action_type}`,
      target_id: body.target_package_id,
      target_type: "course_package",
      input_params: { cause: body.cause, action_id: body.action_id, plan_id: body.plan_id ?? null, metadata: body.metadata ?? {} },
      result_status: "completed",
      result_detail: { reason: body.reason, result, actor_uid: actorId },
      metadata: { source: "pipeline_recovery_os_1" },
    });

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pipeline-recovery-act error", e);
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
