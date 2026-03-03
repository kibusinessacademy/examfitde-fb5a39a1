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

  // Auth: require service_role via x-job-runner-key (same pattern as ops-nightly-guards)
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
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body ok */ }

    const cap = Math.max(10, Math.min(Number(body.cap ?? 150), 500));
    const markLegacy = body.markLegacy !== false; // default true
    const reason = String(body.reason ?? "nightly_backfill");

    // 1) Mark stale reports as legacy (forensic clarity)
    if (markLegacy) {
      const { error: markErr } = await sb.rpc("mark_legacy_integrity_reports");
      if (markErr) {
        console.error("[nightly-integrity] mark legacy failed:", markErr.message);
        // non-fatal, continue
      }
    }

    // 2) Enqueue re-check jobs (cap-limited + deduped)
    const { data, error } = await sb.rpc("enqueue_integrity_rechecks", {
      p_cap: cap,
      p_reason: reason,
    });

    if (error) {
      console.error("[nightly-integrity] enqueue failed:", error.message);
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = data as Record<string, unknown>;
    console.log(`[nightly-integrity] done: ${JSON.stringify(result)}`);

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[nightly-integrity] crash:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
