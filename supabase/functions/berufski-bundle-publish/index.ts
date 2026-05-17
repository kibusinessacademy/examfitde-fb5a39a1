/**
 * berufski-bundle-publish — DEPRECATED 2026-05-17
 *
 * Naming-Migration Phase A4: deny-by-default. Funktion bleibt 7–14 Tage online,
 * lehnt jedoch alle Calls mit 410 ab und schreibt einen Audit-Hit, damit wir
 * versteckte Caller erkennen. Ohne Hits in 14 Tagen → Delete (siehe Plan).
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      const admin = createClient(supabaseUrl, serviceKey);
      await admin.rpc("fn_emit_audit", {
        _action_type: "deprecated_edge_function_called",
        _target_type: "edge_function",
        _target_id: "berufski-bundle-publish",
        _result_status: "warning",
        _payload: {
          fn: "berufski-bundle-publish",
          method: req.method,
          ua: req.headers.get("user-agent"),
          origin: req.headers.get("origin"),
          referer: req.headers.get("referer"),
        },
        _trigger_source: "deprecated_fn_guard",
        _error_message: "Edge function deprecated 2026-05-17 (naming-migration A4).",
      });
    }
  } catch (_e) {
    // never fail on audit problems — primary goal is the 410 response
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: "gone",
      message: "berufski-bundle-publish wurde am 2026-05-17 deprecated. Wird nach 14 Tagen ohne Caller gelöscht.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
