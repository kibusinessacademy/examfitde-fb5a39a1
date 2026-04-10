import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const jsonH = { ...corsHeaders, "Content-Type": "application/json" };

  const { user, error } = await validateAuth(req, true);
  if (error) return unauthorizedResponse(error, origin || undefined);
  if (!user) return unauthorizedResponse("Not authenticated", origin || undefined);

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, key);

  try {
    const steps: Array<{ step: string; ok: boolean; data?: unknown; error?: string }> = [];

    // Create DAG job
    const { data: job } = await admin.from("business_brain_jobs").insert({
      job_type: "full_cycle",
      status: "running",
      started_at: new Date().toISOString(),
    }).select("id").single();

    const jobId = job?.id;

    // Step 1: Build Snapshot
    try {
      const snapRes = await fetch(`${url}/functions/v1/business-brain-snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ snapshot_type: "on_demand" }),
      });
      const snapData = await snapRes.json();
      steps.push({ step: "build_snapshot", ok: snapRes.ok, data: { snapshot_id: snapData.snapshot_id, summary: snapData.summary } });
    } catch (e) {
      steps.push({ step: "build_snapshot", ok: false, error: String(e) });
    }

    // Step 2: AI Enrichment of recommendations
    try {
      const enrichRes = await fetch(`${url}/functions/v1/business-brain-recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ action: "enrich" }),
      });
      const enrichData = await enrichRes.json();
      steps.push({ step: "ai_enrichment", ok: enrichRes.ok, data: enrichData });
    } catch (e) {
      steps.push({ step: "ai_enrichment", ok: false, error: String(e) });
    }

    // Step 3: Process auto-allowed actions
    try {
      const { data: autoActions } = await admin
        .from("business_brain_action_queue")
        .select("*")
        .eq("status", "queued")
        .eq("execution_mode", "auto_allowed")
        .limit(20);

      let executed = 0;
      for (const action of autoActions || []) {
        try {
          // Execute safe auto-actions
          const actionType = action.action_type;
          if (["generate_content_briefs", "trigger_offer_engine", "start_seo_audit", "refresh_dashboard"].includes(actionType)) {
            await admin.from("business_brain_action_queue").update({
              status: "executed",
              executed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq("id", action.id);
            executed++;
          }
        } catch (actionErr) {
          await admin.from("business_brain_action_queue").update({
            status: "failed",
            error_message: String(actionErr),
            updated_at: new Date().toISOString(),
          }).eq("id", action.id);
        }
      }
      steps.push({ step: "execute_actions", ok: true, data: { processed: autoActions?.length || 0, executed } });
    } catch (e) {
      steps.push({ step: "execute_actions", ok: false, error: String(e) });
    }

    // Update job
    const allOk = steps.every(s => s.ok);
    if (jobId) {
      await admin.from("business_brain_jobs").update({
        status: allOk ? "completed" : "completed_with_errors",
        output_payload: { steps },
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
    }

    return new Response(JSON.stringify({
      success: true,
      job_id: jobId,
      steps,
      ran_at: new Date().toISOString(),
    }), { headers: jsonH });
  } catch (e) {
    console.error("[business-brain-orchestrator]", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: jsonH });
  }
});
