import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const cors = getCorsHeaders(origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  // Admin-only
  const { user, error } = await validateAuth(req, true);
  if (error) return unauthorizedResponse(error, origin || undefined);
  if (!user) return unauthorizedResponse("Not authenticated", origin || undefined);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // ── retry_failed_jobs ──────────────────────────────────────
    if (action === "retry_failed_jobs") {
      const { data, error: err } = await sb
        .from("job_queue")
        .update({
          status: "pending",
          run_after: new Date().toISOString(),
          error: null,
        })
        .eq("status", "failed")
        .select("id");

      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] retry_failed_jobs: ${data?.length ?? 0} jobs reset by ${user.id}`);
      return json({ success: true, count: data?.length ?? 0 });
    }

    // ── recover_stuck_processing ───────────────────────────────
    if (action === "recover_stuck_processing") {
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data, error: err } = await sb
        .from("job_queue")
        .update({
          status: "pending",
          run_after: new Date().toISOString(),
          error: "auto-recovered from stuck processing",
        })
        .eq("status", "processing")
        .lt("started_at", tenMinAgo)
        .select("id");

      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] recover_stuck: ${data?.length ?? 0} jobs recovered by ${user.id}`);
      return json({ success: true, count: data?.length ?? 0 });
    }

    // ── queue_health (read-only stats) ─────────────────────────
    if (action === "queue_health") {
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();

      const [pendingR, processingR, failedR, stuckR, completedR, cancelledR] = await Promise.all([
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing").lt("started_at", tenMinAgo),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "completed"),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
      ]);

      return json({
        pending: pendingR.count ?? 0,
        processing: processingR.count ?? 0,
        failed: failedR.count ?? 0,
        stuck: stuckR.count ?? 0,
        completed: completedR.count ?? 0,
        cancelled: cancelledR.count ?? 0,
      });
    }

    // ── freeze_package ───────────────────────────────────────
    if (action === "freeze_package") {
      const packageId = body.package_id as string;
      if (!packageId) return json({ error: "package_id required" }, 400);
      const { error: err } = await sb
        .from("course_packages")
        .update({ status: "frozen" })
        .eq("id", packageId);
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] freeze_package: ${packageId} frozen by ${user.id}`);
      return json({ success: true });
    }

    // ── unfreeze_package ─────────────────────────────────────
    if (action === "unfreeze_package") {
      const packageId = body.package_id as string;
      if (!packageId) return json({ error: "package_id required" }, 400);
      const { error: err } = await sb
        .from("course_packages")
        .update({ status: "building" })
        .eq("id", packageId);
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] unfreeze_package: ${packageId} unfrozen by ${user.id}`);
      return json({ success: true });
    }

    // ── enqueue_job (privileged job creation) ─────────────────
    if (action === "enqueue_job") {
      const ALLOWED_JOB_TYPES = ["package_auto_publish"];
      const jobType = body.job_type as string;
      const packageId = body.package_id as string;
      const courseId = body.course_id as string;

      if (!jobType || !ALLOWED_JOB_TYPES.includes(jobType)) {
        return json({ error: `job_type must be one of: ${ALLOWED_JOB_TYPES.join(", ")}` }, 400);
      }
      if (!packageId) return json({ error: "package_id required" }, 400);
      if (!courseId) return json({ error: "course_id required" }, 400);

      const maxAttempts = Math.max(1, Math.min(body.max_attempts ?? 3, 10));

      const { data, error: err } = await sb
        .from("job_queue")
        .insert({
          job_type: jobType,
          status: "pending",
          payload: { package_id: packageId, course_id: courseId },
          max_attempts: maxAttempts,
        })
        .select("id")
        .single();

      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] enqueue_job: ${jobType} job=${data?.id} pkg=${packageId} by ${user.id}`);
      return json({ success: true, job_id: data?.id });
    }

    // ── set_provider_pause ───────────────────────────────────
    if (action === "set_provider_pause") {
      const provider = body.provider as string;
      const pause = body.pause as boolean;
      if (!provider || typeof pause !== "boolean") {
        return json({ error: "provider (string) and pause (boolean) required" }, 400);
      }
      const { error: err } = await sb
        .from("llm_rate_limits")
        .update({ is_paused: pause, updated_at: new Date().toISOString() })
        .eq("provider", provider);
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] set_provider_pause: ${provider} → ${pause ? "paused" : "resumed"} by ${user.id}`);
      return json({ success: true });
    }

    // ── set_provider_concurrency ─────────────────────────────
    if (action === "set_provider_concurrency") {
      const provider = body.provider as string;
      const value = Number(body.value);
      if (!provider || !Number.isFinite(value) || value < 1 || value > 50) {
        return json({ error: "provider (string) and value (1–50) required" }, 400);
      }
      const { error: err } = await sb
        .from("llm_rate_limits")
        .update({ max_concurrent: Math.round(value), updated_at: new Date().toISOString() })
        .eq("provider", provider);
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] set_provider_concurrency: ${provider} → ${value} by ${user.id}`);
      return json({ success: true });
    }

    // ── set_hard_stop ────────────────────────────────────────
    if (action === "set_hard_stop") {
      const hardStop = body.hard_stop as boolean;
      const budgetId = body.budget_id as string;
      if (typeof hardStop !== "boolean" || !budgetId) {
        return json({ error: "budget_id (string) and hard_stop (boolean) required" }, 400);
      }
      const { error: err } = await sb
        .from("llm_budget")
        .update({ hard_stop: hardStop })
        .eq("id", budgetId);
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] set_hard_stop: ${hardStop} budget=${budgetId} by ${user.id}`);
      return json({ success: true });
    }

    // ── retry_rate_limited ───────────────────────────────────
    if (action === "retry_rate_limited") {
      const TRANSIENT_CODES = ["RATE_LIMIT", "RATE_LIMIT_EXHAUSTED", "TIMEOUT_EXHAUSTED", "TRANSIENT_NETWORK_EXHAUSTED"];
      const { data, error: err } = await sb
        .from("job_queue")
        .update({
          status: "pending",
          scheduled_at: null,
          rate_limited_until: null,
          last_error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("status", "failed")
        .in("last_error_code", TRANSIENT_CODES)
        .select("id");
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] retry_rate_limited: ${data?.length ?? 0} jobs reset by ${user.id}`);
      return json({ success: true, count: data?.length ?? 0 });
    }

    // ── cancel_failed ────────────────────────────────────────
    if (action === "cancel_failed") {
      const { data, error: err } = await sb
        .from("job_queue")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("status", "failed")
        .select("id");
      if (err) return json({ error: err.message }, 500);
      console.log(`[admin-ops] cancel_failed: ${data?.length ?? 0} jobs cancelled by ${user.id}`);
      return json({ success: true, count: data?.length ?? 0 });
    }

    return json({
      error: "Unknown action. Use: retry_failed_jobs | recover_stuck_processing | queue_health | freeze_package | unfreeze_package | enqueue_job | set_provider_pause | set_provider_concurrency | set_hard_stop | retry_rate_limited | cancel_failed",
    }, 400);
  } catch (e) {
    console.error("[admin-ops] error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
