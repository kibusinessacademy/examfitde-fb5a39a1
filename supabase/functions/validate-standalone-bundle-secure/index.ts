/**
 * validate-standalone-bundle-secure — DEPRECATED 2026-05-17
 * Deny-by-default + Audit. Delete nach 14 Tagen ohne Audit-Hits.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      const admin = createClient(url, key);
      await admin.rpc("fn_emit_audit", {
        _action_type: "deprecated_edge_function_called",
        _target_type: "edge_function",
        _target_id: "validate-standalone-bundle-secure",
        _result_status: "warning",
        _payload: {
          fn: "validate-standalone-bundle-secure",
          method: req.method,
          ua: req.headers.get("user-agent"),
          origin: req.headers.get("origin"),
          referer: req.headers.get("referer"),
        },
        _trigger_source: "deprecated_fn_guard",
        _error_message: "Edge function deprecated 2026-05-17 (naming-migration A4).",
      });
    }
  } catch (_e) { /* never fail on audit */ }

  return new Response(
    JSON.stringify({
      ok: false,
      error: "gone",
      message: "validate-standalone-bundle-secure wurde am 2026-05-17 deprecated.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
