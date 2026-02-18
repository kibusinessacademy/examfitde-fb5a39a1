import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

      const [pendingR, processingR, failedR, stuckR] = await Promise.all([
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
        sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing").lt("started_at", tenMinAgo),
      ]);

      return json({
        pending: pendingR.count ?? 0,
        processing: processingR.count ?? 0,
        failed: failedR.count ?? 0,
        stuck: stuckR.count ?? 0,
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

    return json({ error: "Unknown action. Use: retry_failed_jobs | recover_stuck_processing | queue_health | freeze_package | unfreeze_package" }, 400);
  } catch (e) {
    console.error("[admin-ops] error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
