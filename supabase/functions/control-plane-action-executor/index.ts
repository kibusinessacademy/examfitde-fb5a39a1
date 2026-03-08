import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: actions, error } = await sb
    .from("control_plane_actions")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) return json(500, { error: error.message });

  const results: any[] = [];

  for (const action of actions || []) {
    try {
      await sb.from("control_plane_actions").update({
        status: "processing",
        updated_at: new Date().toISOString(),
      }).eq("id", action.id);

      let resultDetail: any = { note: "executed" };

      if (action.action_type === "auto_throttle") {
        // Disable aggressive auto-throttle policies temporarily
        await sb.from("control_plane_policies").update({
          is_enabled: false,
          updated_at: new Date().toISOString(),
        }).eq("policy_key", "queue_failed_critical_1h");
        resultDetail = { throttled: true, disabled_policy: "queue_failed_critical_1h" };
      }

      if (action.action_type === "auto_pause") {
        const { count } = await sb.from("campaign_launch_plans").update({
          status: "blocked",
          updated_at: new Date().toISOString(),
        }).in("status", ["queued", "in_progress"]);
        resultDetail = { paused_plans: count };
      }

      if (action.action_type === "auto_resume") {
        const { count } = await sb.from("campaign_launch_plans").update({
          status: "queued",
          updated_at: new Date().toISOString(),
        }).eq("status", "blocked");
        resultDetail = { resumed_plans: count };
      }

      await sb.from("control_plane_actions").update({
        status: "done",
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: resultDetail,
      }).eq("id", action.id);

      results.push({ id: action.id, action_type: action.action_type, status: "done" });
    } catch (e) {
      await sb.from("control_plane_actions").update({
        status: "failed",
        updated_at: new Date().toISOString(),
        result: { error: (e as Error).message },
      }).eq("id", action.id);

      results.push({ id: action.id, action_type: action.action_type, status: "failed", error: (e as Error).message });
    }
  }

  return json(200, { ok: true, processed: results.length, results });
});
