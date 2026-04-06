import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

/**
 * priority-scoring — Automatic Priority Scoring System
 *
 * Actions:
 *   compute  — recalculate all priority scores based on rules
 *   preview  — dry-run: show what would change
 *   apply    — actually update package priorities
 *   rules    — list current scoring rules
 */
Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const action = body.action || "compute";

  try {
    if (action === "rules") {
      const { data } = await sb
        .from("priority_score_rules")
        .select("*")
        .eq("is_active", true)
        .order("dimension, weight", { ascending: false });
      return json(200, { ok: true, rules: data }, origin);
    }

    if (action === "compute") {
      const { data, error } = await sb.rpc("compute_priority_scores");
      if (error) throw error;
      return json(200, { ok: true, action: "compute", result: data }, origin);
    }

    if (action === "preview") {
      const { data, error } = await sb.rpc("apply_priority_from_scores", { p_dry_run: true });
      if (error) throw error;
      return json(200, { ok: true, action: "preview", changes: data, count: data?.length ?? 0 }, origin);
    }

    if (action === "apply") {
      // First compute fresh scores
      await sb.rpc("compute_priority_scores");
      // Then apply
      const { data, error } = await sb.rpc("apply_priority_from_scores", { p_dry_run: false });
      if (error) throw error;

      // Log the action
      await sb.from("auto_heal_log").insert({
        action_type: "priority_scoring_apply",
        trigger_source: body.source || "api",
        result_status: "ok",
        result_detail: `${data?.length ?? 0} packages reprioritized`,
        metadata: { changes: data },
      });

      return json(200, { ok: true, action: "apply", applied: data?.length ?? 0, changes: data }, origin);
    }

    return json(400, { error: `Unknown action: ${action}` }, origin);
  } catch (e) {
    return json(500, { error: (e as Error).message }, origin);
  }
});
