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

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await sb.rpc("get_factory_executive_report");

  if (error) {
    return json(500, { error: error.message }, origin);
  }

  return json(200, data, origin);
});
