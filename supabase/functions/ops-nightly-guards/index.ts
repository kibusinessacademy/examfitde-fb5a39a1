import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

  const AUTO_REBIND = (Deno.env.get("AUTO_REBIND_TRIGGERS") ?? "false") === "true";

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
      await sb.from("admin_notifications").insert({
        title: "🚨 Trigger Binding Guard failed",
        body: `check_trigger_bindings() RPC failed: ${tgErr.message}`,
        severity: "error",
        category: "ops",
        entity_type: "system",
        entity_id: "trigger_binding_guard",
      });
    }

    // Extract missing triggers
    const tgResult = Array.isArray(tgData) ? tgData[0] : tgData;
    const missingTriggers = (tgResult?.missing ?? []) as Array<{
      expected_trigger: string;
      expected_schema: string;
      expected_table: string;
      function_exists: boolean;
    }>;

    // 3) Auto-rebind if enabled and triggers are missing
    let rebindResult: { attempted?: number; rebound?: number; skipped?: number; actions?: unknown } = {};

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

      if (AUTO_REBIND) {
        // Dry run first for visibility
        const { data: dryData } = await sb.rpc("auto_rebind_missing_triggers", { dry_run: true });
        const dryResult = Array.isArray(dryData) ? dryData[0] : dryData;

        if (dryResult && (dryResult.attempted ?? 0) > 0) {
          await sb.from("admin_notifications").insert({
            title: "🛠 Auto-Rebind dry run",
            body: `Would rebind: attempted=${dryResult.attempted} skipped=${dryResult.skipped}`,
            severity: "info",
            category: "ops",
            entity_type: "system",
            entity_id: "auto_rebind_triggers",
            metadata: { actions: dryResult.actions },
          });
        }

        // Execute rebind
        const { data: execData, error: execErr } = await sb.rpc("auto_rebind_missing_triggers", { dry_run: false });
        const execResult = Array.isArray(execData) ? execData[0] : execData;

        if (execErr) {
          await sb.from("admin_notifications").insert({
            title: "🚨 Auto-Rebind failed",
            body: `auto_rebind_missing_triggers() failed: ${execErr.message}`,
            severity: "error",
            category: "ops",
            entity_type: "system",
            entity_id: "auto_rebind_triggers",
          });
        } else if (execResult) {
          rebindResult = execResult;
          await sb.from("admin_notifications").insert({
            title: execResult.rebound > 0
              ? "✅ Auto-Rebind: triggers restored"
              : "ℹ️ Auto-Rebind: nothing to fix",
            body: `attempted=${execResult.attempted} rebound=${execResult.rebound} skipped=${execResult.skipped}`,
            severity: execResult.rebound > 0 ? "warning" : "info",
            category: "ops",
            entity_type: "system",
            entity_id: "auto_rebind_triggers",
            metadata: { actions: execResult.actions },
          });
        }
      }
    }

    // 4) Auto-revive transient-failed lesson jobs
    let revivedCount = 0;
    try {
      const { data: revived } = await sb.rpc("revive_transient_failed_lesson_jobs", { p_limit: 200 });
      revivedCount = Array.isArray(revived) ? revived.length : 0;
      if (revivedCount > 0) {
        console.log(`[nightly-guards] Auto-revived ${revivedCount} transient-failed lesson jobs`);
      }
    } catch (reviveErr) {
      console.warn(`[nightly-guards] revive_transient_failed_lesson_jobs failed:`, reviveErr);
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
        auto_rebind: {
          enabled: AUTO_REBIND,
          ...rebindResult,
        },
        auto_revive: { revived_count: revivedCount },
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
