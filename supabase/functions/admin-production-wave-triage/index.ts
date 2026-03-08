import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth } from "../_shared/auth.ts";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  const auth = await validateAuth(req, true);
  if (auth.error || !auth.isAdmin) {
    return json(401, { error: auth.error || "Admin required" }, origin);
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action || "list";
  const waveId = body.wave_id || null;
  const waveItemId = body.wave_item_id || null;
  const status = body.status || null;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (action === "list") {
    if (!waveId) return json(400, { error: "wave_id required" }, origin);

    const { data, error } = await sb.rpc("get_wave_triage_items", {
      p_wave_id: waveId,
      p_status_filter: status,
    });

    if (error) return json(500, { error: error.message }, origin);
    return json(200, data, origin);
  }

  if (action === "retry" || action === "resume" || action === "skip") {
    if (!waveItemId) return json(400, { error: "wave_item_id required" }, origin);

    const { data, error } = await sb.rpc("wave_item_retry_action", {
      p_wave_item_id: waveItemId,
      p_action: action,
    });

    if (error) return json(500, { error: error.message }, origin);
    return json(200, data, origin);
  }

  return json(400, { error: `Unknown action: ${action}` }, origin);
});
