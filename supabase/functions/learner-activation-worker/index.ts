// Learner Activation Worker — Bridge 1: Delivered → Activated
// Claims activation_* jobs and dispatches lightweight handlers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const HANDLED = new Set([
  "activation_welcome_sequence_enqueue",
  "activation_goal_capture_prompt",
  "activation_exam_date_capture_prompt",
  "activation_study_plan_generate",
  "activation_streak_initialize",
  "activation_first_minicheck_seed",
]);

async function handle(job: any): Promise<{ ok: boolean; detail?: string }> {
  const { job_type, payload } = job;
  const userId = payload?.user_id;
  const curriculumId = payload?.curriculum_id;
  if (!userId) return { ok: false, detail: "missing user_id" };

  switch (job_type) {
    case "activation_goal_capture_prompt":
      await supabase.from("learner_profiles").upsert(
        { user_id: userId, goal_capture_pending: true },
        { onConflict: "user_id" },
      );
      return { ok: true };

    case "activation_exam_date_capture_prompt":
      await supabase.from("learner_profiles").upsert(
        { user_id: userId, exam_date_capture_pending: true },
        { onConflict: "user_id" },
      );
      return { ok: true };

    case "activation_streak_initialize":
      await supabase.from("learner_profiles").upsert(
        { user_id: userId, streak_current: 0, last_activity_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      return { ok: true };

    case "activation_welcome_sequence_enqueue": {
      // Best-effort enqueue into email_delivery_queue (Loop B picks it up).
      // Resolve recipient email via profiles.
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .maybeSingle();
      if (profile?.email) {
        await supabase.from("email_delivery_queue").insert({
          recipient_email: profile.email,
          sequence_type: "learner_activation_welcome",
          step_number: 1,
          status: "pending",
          audience: "learner",
          scheduled_for: new Date().toISOString(),
          idempotency_key: `learner_activation_welcome|${userId}|${curriculumId}|1`,
          personalization: { curriculum_id: curriculumId },
        });
      }
      return { ok: true, detail: profile?.email ? "queued" : "no_email" };
    }

    case "activation_study_plan_generate":
    case "activation_first_minicheck_seed":
      // v1 signal-only placeholder — concrete generators land in Welle B2 (Mastery→Readiness).
      return { ok: true, detail: "placeholder_v1" };

    default:
      return { ok: false, detail: "unknown_job_type" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Claim up to 25 pending activation jobs
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
