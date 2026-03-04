import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-job-runner-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Auth: require service_role via x-job-runner-key ──
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const callerKey = req.headers.get("x-job-runner-key") ?? "";

  if (!callerKey || callerKey !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // 1) Run nightly pipeline guards RPC
    const { data, error } = await sb.rpc("run_nightly_pipeline_guards");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Trigger-binding verification guard (SSOT table-driven)
    const { data: tgData, error: tgErr } = await sb.rpc("check_trigger_bindings");

    if (tgErr) {
      // Non-blocking but visible
      await sb.from("admin_notifications").insert({
        title: "🚨 Trigger Binding Guard failed",
        body: `check_trigger_bindings() RPC failed: ${tgErr.message}`,
        severity: "error",
        category: "ops",
        entity_type: "system",
        entity_id: "trigger_binding_guard",
      });
    }

    // Extract missing triggers from the new RPC format
    const tgResult = Array.isArray(tgData) ? tgData[0] : tgData;
    const missingTriggers = (tgResult?.missing ?? []) as Array<{
      expected_trigger: string;
      expected_schema: string;
      expected_table: string;
      function_exists: boolean;
      is_missing: boolean;
    }>;

    if (missingTriggers.length > 0) {
      const names = missingTriggers
        .map(
          (t) =>
            `${t.expected_trigger} → ${t.expected_schema}.${t.expected_table} (fn_exists=${t.function_exists})`
        )
        .join(", ");

      await sb.from("admin_notifications").insert({
        title: "🚨 CRITICAL: Missing DB triggers detected",
        body: `Triggers are NOT bound: ${names}. This can silently bypass publish gates.`,
        severity: "error",
        category: "ops",
        entity_type: "system",
        entity_id: "trigger_binding_guard",
      });
    }

    const result = data as Record<string, unknown>;
    const allClear =
      result?.all_clear === true && missingTriggers.length === 0;

    return new Response(
      JSON.stringify({
        ...result,
        trigger_guard: {
          all_clear: missingTriggers.length === 0,
          missing_count: missingTriggers.length,
          details: missingTriggers,
        },
      }),
      {
        status: allClear ? 200 : 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
