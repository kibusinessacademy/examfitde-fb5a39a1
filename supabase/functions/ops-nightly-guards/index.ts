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

    // 2) Trigger-binding verification guard
    const { data: triggerCheck, error: triggerErr } = await sb.rpc("check_trigger_bindings");
    const missingTriggers = (triggerCheck as any[])?.filter((t: any) => t.is_missing) || [];
    
    if (missingTriggers.length > 0) {
      const names = missingTriggers.map((t: any) => `${t.expected_trigger} → ${t.expected_table}`).join(", ");
      await sb.from("admin_notifications").insert({
        title: "🚨 CRITICAL: Missing DB triggers detected",
        body: `The following triggers are NOT bound to their tables: ${names}. This is a governance violation that can cause silent publish bypasses.`,
        severity: "error",
        category: "ops",
        entity_type: "system",
        entity_id: "trigger_binding_guard",
      });
    }

    const result = data as Record<string, unknown>;
    const allClear = result?.all_clear === true && missingTriggers.length === 0;

    return new Response(
      JSON.stringify({ ...result, trigger_guard: { missing: missingTriggers.length, details: missingTriggers } }),
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
