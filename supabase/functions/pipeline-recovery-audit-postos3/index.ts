// pipeline-recovery-audit-postos3 (OS.3)
// Read-only KPI aggregator for Lane Dispatcher Repair effectiveness.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const PLANNING_JOB = "package_scaffold_learning_course";
const LF_JOB = "package_repair_exam_pool_lf_coverage";

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

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    if (!isInternal) {
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const userClient = createClient(supabaseUrl, anon, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: userRes } = await userClient.auth.getUser();
      const actorId = userRes?.user?.id ?? null;
      if (!actorId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: actorId, _role: "admin" });
      if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }

    const since6h = new Date(Date.now() - 6 * 3600_000).toISOString();
    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
    const stuckCutoff = new Date(Date.now() - 60 * 60_000).toISOString();

    // LF attempts last 6h
    const { count: lfAttempts6h } = await admin
      .from("job_queue").select("id", { count: "exact", head: true })
      .eq("job_type", LF_JOB).gte("created_at", since6h);

    // LF skipped due to quarantine last 6h
    const { count: lfSkipped6h } = await admin
      .from("auto_heal_log").select("id", { count: "exact", head: true })
      .eq("action_type", "skipped_due_to_quarantine").gte("created_at", since6h);

    // Planning stuck >60m
    const { data: planningStuckRaw } = await admin
      .from("job_queue").select("id, status")
      .eq("job_type", PLANNING_JOB).in("status", ["pending", "processing"])
      .lte("updated_at", stuckCutoff).limit(500);
    const planningStuckCount = planningStuckRaw?.length ?? 0;

    // Recovery actions in last 24h
    const { data: recentActions } = await admin
      .from("pipeline_recovery_actions").select("action_type, cause, executed_at")
      .gte("executed_at", since24h);

    const actionsByType: Record<string, number> = {};
    for (const a of recentActions ?? []) {
      actionsByType[a.action_type] = (actionsByType[a.action_type] ?? 0) + 1;
    }

    // Done packages blocked by no-progress
    const { count: doneBlocked } = await admin
      .from("package_quarantine_ledger").select("id", { count: "exact", head: true })
      .eq("reason_code", "QUALITY_NO_PROGRESS").eq("status", "under_review");

    // done_ready_to_publish — strict SSOT query
    const { data: doneReadyRaw } = await admin
      .from("course_packages").select("id")
      .eq("status", "done").eq("integrity_passed", true).eq("council_approved", true)
      .eq("is_published", false).limit(500);
    const doneReadyToPublish = doneReadyRaw?.length ?? 0;

    const snapshot = {
      generated_at: new Date().toISOString(),
      lf_attempts_6h: lfAttempts6h ?? 0,
      lf_skipped_due_to_quarantine_6h: lfSkipped6h ?? 0,
      planning_stuck_count: planningStuckCount,
      planning_restarts_emitted_24h: actionsByType["restart_planning"] ?? 0,
      planning_manual_review_emitted_24h: actionsByType["mark_manual_review_required"] ?? 0,
      done_reaudit_blocked_by_no_progress: doneBlocked ?? 0,
      done_ready_to_publish: doneReadyToPublish,
      actions_by_type_24h: actionsByType,
    };

    await admin.from("auto_heal_log").insert({
      action_type: "pipeline_recovery_postos3_audit",
      target_type: "system",
      result_status: "info",
      metadata: { source: "pipeline_recovery_os_3", ...snapshot },
    });

    return new Response(JSON.stringify({ ok: true, snapshot }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pipeline-recovery-audit-postos3 error", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
