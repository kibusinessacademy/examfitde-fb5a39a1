// Learner Readiness Worker — Bridge 2: Mastery → Exam Readiness v2
// Claims learner_readiness_recompute / learner_intervention_dispatch / learner_next_best_step_generate jobs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const HANDLED = new Set([
  "learner_readiness_recompute",
  "learner_intervention_dispatch",
  "learner_next_best_step_generate",
]);

async function handle(job: any): Promise<{ ok: boolean; detail?: string }> {
  const { job_type, payload } = job;
  const userId = payload?.user_id as string | undefined;
  const curriculumId = payload?.curriculum_id as string | undefined;
  if (!userId || !curriculumId) return { ok: false, detail: "missing user_id or curriculum_id" };

  switch (job_type) {
    case "learner_readiness_recompute": {
      const { data, error } = await supabase.rpc("fn_exam_readiness_v2", {
        p_user_id: userId,
        p_curriculum_id: curriculumId,
      });
      if (error) return { ok: false, detail: error.message };
      const verdict = (data as any)?.verdict;
      // Auto-dispatch intervention if AT_RISK or CRITICAL (best-effort; SLA detector handles 24h)
      if (verdict === "AT_RISK" || verdict === "CRITICAL") {
        await supabase.from("job_queue").insert({
          job_type: "learner_intervention_dispatch",
          status: "pending",
          payload: { user_id: userId, curriculum_id: curriculumId, verdict, source: "auto_dispatch" },
          run_after: new Date().toISOString(),
          idempotency_key: `intervention|${userId}|${curriculumId}|${new Date().toISOString().slice(0, 10)}`,
          job_name: "learner_intervention_dispatch",
          correlation_id: `readiness_${userId}`,
        }).then(() => {});
      }
      // Auto-enqueue next-best-step for PARTIAL/AT_RISK/CRITICAL (skip READY)
      if (verdict && verdict !== "READY" && verdict !== "NOT_STARTED") {
        await supabase.from("job_queue").insert({
          job_type: "learner_next_best_step_generate",
          status: "pending",
          payload: { user_id: userId, curriculum_id: curriculumId, verdict },
          run_after: new Date().toISOString(),
          idempotency_key: `nbs|${userId}|${curriculumId}|${new Date().toISOString().slice(0, 13)}`,
          job_name: "learner_next_best_step_generate",
          correlation_id: `readiness_${userId}`,
        }).then(() => {});
      }
      return { ok: true, detail: `verdict=${verdict}` };
    }

    case "learner_intervention_dispatch": {
      const verdict = payload?.verdict ?? "AT_RISK";
      // Best-effort: enqueue rescue email via email_delivery_queue.
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .maybeSingle();
      if (profile?.email) {
        await supabase.from("email_delivery_queue").insert({
          recipient_email: profile.email,
          sequence_type: verdict === "CRITICAL" ? "learner_readiness_rescue_critical" : "learner_readiness_rescue_at_risk",
          step_number: 1,
          status: "pending",
          audience: "learner",
          scheduled_for: new Date().toISOString(),
          idempotency_key: `readiness_rescue|${userId}|${curriculumId}|${verdict}|${new Date().toISOString().slice(0, 10)}`,
          personalization: { curriculum_id: curriculumId, verdict },
        });
      }
      await supabase.from("auto_heal_log").insert({
        action_type: "learner_intervention_dispatched",
        target_type: "user",
        target_id: userId,
        result_status: "ok",
        metadata: { curriculum_id: curriculumId, verdict, has_email: !!profile?.email },
      });
      return { ok: true, detail: profile?.email ? "rescue_queued" : "no_email" };
    }

    case "learner_next_best_step_generate": {
      // v1 signal-only: log the intent so Tutor/UI can pick it up. Full generator lands in Bridge 5 (Outcome).
      await supabase.from("auto_heal_log").insert({
        action_type: "next_best_step_signal",
        target_type: "user",
        target_id: userId,
        result_status: "ok",
        metadata: { curriculum_id: curriculumId, verdict: payload?.verdict },
      });
      return { ok: true, detail: "signal_v1" };
    }

    default:
      return { ok: false, detail: "unknown_job_type" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { data: jobs, error } = await supabase
    .from("job_queue")
    .select("id, job_type, payload, attempts")
    .in("job_type", Array.from(HANDLED))
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];
  for (const job of jobs ?? []) {
    await supabase.from("job_queue").update({
      status: "processing", started_at: new Date().toISOString(), attempts: (job.attempts ?? 0) + 1,
    }).eq("id", job.id);
    try {
      const r = await handle(job);
      await supabase.from("job_queue").update({
        status: r.ok ? "completed" : "failed",
        completed_at: new Date().toISOString(),
        result: { detail: r.detail },
        error: r.ok ? null : (r.detail ?? "handler_error"),
      }).eq("id", job.id);
      results.push({ id: job.id, type: job.job_type, ok: r.ok, detail: r.detail });
    } catch (e: any) {
      await supabase.from("job_queue").update({
        status: "failed", completed_at: new Date().toISOString(), error: String(e?.message ?? e),
      }).eq("id", job.id);
      results.push({ id: job.id, type: job.job_type, ok: false, detail: String(e?.message ?? e) });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
