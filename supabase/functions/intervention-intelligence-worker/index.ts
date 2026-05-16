// Bridge 4: Intervention Intelligence Worker
// Processes: compute_next_best_action, trigger_learning_intervention,
//            trigger_retention_intervention, generate_manager_alert,
//            schedule_exam_simulation
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const HANDLED_TYPES = new Set([
  "compute_next_best_action",
  "trigger_learning_intervention",
  "trigger_retention_intervention",
  "generate_manager_alert",
  "schedule_exam_simulation",
]);

async function handleJob(supabase: any, job: any): Promise<{ ok: boolean; note?: string }> {
  const t = job.job_type as string;
  const p = (job.payload ?? {}) as Record<string, any>;
  const user_id = p.user_id;
  const curriculum_id = p.curriculum_id;

  if (t === "compute_next_best_action") {
    if (!user_id || !curriculum_id) return { ok: false, note: "missing user_id/curriculum_id" };
    const { error } = await supabase.rpc("fn_compute_next_best_action", {
      p_user_id: user_id,
      p_curriculum_id: curriculum_id,
    });
    if (error) return { ok: false, note: error.message };
    return { ok: true };
  }

  // For trigger_* / generate_manager_alert / schedule_exam_simulation:
  // mark intervention state as dispatched + write audit row.
  if (user_id && curriculum_id) {
    const { data: stateRow } = await supabase
      .from("learner_intervention_state")
      .select("id, nba_action, nba_priority")
      .eq("user_id", user_id)
      .eq("curriculum_id", curriculum_id)
      .maybeSingle();

    await supabase.from("learner_intervention_dispatch_log").insert({
      user_id,
      curriculum_id,
      intervention_type: t,
      trigger_reason: p.trigger ?? stateRow?.nba_action ?? null,
      payload: p,
      outcome: "dispatched",
      job_id: job.id,
    });

    if (stateRow?.id) {
      await supabase
        .from("learner_intervention_state")
        .update({ dispatched_at: new Date().toISOString(), dispatched_job_id: job.id })
        .eq("id", stateRow.id);
    }

    // Retention nudge → enqueue email
    if (t === "trigger_retention_intervention") {
      await supabase.from("email_delivery_queue").insert({
        user_id,
        template_key: "retention_nudge_v1",
        subject: "Wir vermissen dich – schaffe deine Prüfung mit ExamFit",
        payload: { curriculum_id, reason: stateRow?.nba_action ?? "retention_nudge" },
        idempotency_key: `retention_nudge|${user_id}|${curriculum_id}|${new Date().toISOString().slice(0, 10)}`,
        status: "pending",
      }).then(() => {}, () => {});
    }
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Claim jobs
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_pending_jobs_v5", {
    p_worker_id: `intervention-worker-${crypto.randomUUID()}`,
    p_limit: 25,
    p_pool: "default",
  } as any);

  if (claimErr) {
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jobs = (claimed ?? []).filter((j: any) => HANDLED_TYPES.has(j.job_type));
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const r = await handleJob(supabase, job);
      if (r.ok) {
        await supabase.rpc("complete_job", { p_job_id: job.id, p_result: { ok: true } } as any);
        processed++;
      } else {
        await supabase.rpc("fail_job", {
          p_job_id: job.id,
          p_error: r.note ?? "unknown",
        } as any);
        failed++;
      }
    } catch (e: any) {
      await supabase.rpc("fail_job", { p_job_id: job.id, p_error: String(e?.message ?? e) } as any);
      failed++;
    }
  }

  return new Response(
    JSON.stringify({ claimed: claimed?.length ?? 0, processed, failed, handled: jobs.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
