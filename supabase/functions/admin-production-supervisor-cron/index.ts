import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import { validateAuth } from "../_shared/auth.ts";

/**
 * admin-production-supervisor-cron — Thin cron invoker.
 *
 * Called by pg_cron every 5 minutes via anon key auth.
 * Delegates to admin-run-production-supervisor using internal secret.
 */

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  // Accept either internal secret or admin auth
  const internalSecret = req.headers.get("x-internal-secret") ?? "";
  const edgeSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";
  const isInternal = edgeSecret && internalSecret && internalSecret === edgeSecret;

  if (!isInternal) {
    // pg_cron sends anon key — validate as admin or accept service_role
    const auth = await validateAuth(req, true);
    if (auth.error || !auth.isAdmin) {
      // Also allow service_role calls (pg_cron uses anon key but we accept it)
      const authHeader = req.headers.get("authorization") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (!serviceKey || !authHeader.includes(serviceKey)) {
        return json(401, { ok: false, error: "Unauthorized" }, origin);
      }
    }
  }

  const targetUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-run-production-supervisor`;

  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: "cron" }),
  });

  const body = await res.text();
  const data = (() => { try { return JSON.parse(body); } catch { return { raw: body }; } })();

  return json(res.status, data, origin);
});
