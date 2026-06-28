// pipeline-recovery-diagnose (OS.3)
// Read-only. Diagnoses why planning jobs are stuck.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  diagnosePlanningJob,
  isRestartSafe,
  type PlanningJobRow,
  type WorkerHeartbeatRow,
  type JobTypePolicyRow,
  type JobTypeQuarantineRow,
} from "../_shared/pipelineRecovery/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const PLANNING_JOB = "package_scaffold_learning_course";
const STUCK_MIN = 60;

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
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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

    const cutoff = new Date(Date.now() - STUCK_MIN * 60_000).toISOString();
    const now = new Date().toISOString();

    const { data: jobsRaw } = await admin
      .from("job_queue")
      .select("id, package_id, job_type, status, worker_pool, started_at, last_heartbeat_at, updated_at, created_at")
      .eq("job_type", PLANNING_JOB)
      .in("status", ["pending", "processing"])
      .lte("updated_at", cutoff)
      .limit(200);

    const jobs = (jobsRaw ?? []) as PlanningJobRow[];

    const { data: workersRaw } = await admin
      .from("ops_worker_heartbeats")
      .select("worker_id, job_types, worker_pool, last_heartbeat_at")
      .gte("last_heartbeat_at", new Date(Date.now() - 30 * 60_000).toISOString());
    const workers = (workersRaw ?? []) as WorkerHeartbeatRow[];

    const { data: policyRaw } = await admin
      .from("job_type_policies")
      .select("job_type, worker_pool")
      .eq("job_type", PLANNING_JOB)
      .maybeSingle();
    const policy = (policyRaw ?? null) as JobTypePolicyRow | null;

    const { data: qRaw } = await admin
      .from("job_type_quarantine")
      .select("job_type, status")
      .eq("job_type", PLANNING_JOB)
      .maybeSingle();
    const quarantine = (qRaw ?? null) as JobTypeQuarantineRow | null;

    const diagnoses = jobs.map((j) => diagnosePlanningJob({ now, job: j, workers, policy, quarantine }));

    const summary: Record<string, number> = {};
    for (const d of diagnoses) summary[d.cause] = (summary[d.cause] ?? 0) + 1;

    const safeForRestart = diagnoses.filter((d) => isRestartSafe(d.cause)).length;
    const requiresManualReview = diagnoses.length - safeForRestart;

    await admin.from("auto_heal_log").insert({
      action_type: "pipeline_recovery_planning_diagnose",
      target_type: "system",
      result_status: "info",
      metadata: {
        source: "pipeline_recovery_os_3",
        total: diagnoses.length,
        summary,
        safe_for_restart: safeForRestart,
        requires_manual_review: requiresManualReview,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      now,
      total: diagnoses.length,
      summary,
      safe_for_restart: safeForRestart,
      requires_manual_review: requiresManualReview,
      diagnoses,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("pipeline-recovery-diagnose error", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
