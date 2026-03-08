import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

/**
 * admin-production-supervisor-cron — Thin cron invoker.
 *
 * Called by pg_cron every 5 minutes. Delegates to admin-run-production-supervisor
 * using the shared internal secret.
 */

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  const internalSecret = req.headers.get("x-internal-secret") ?? "";
  const edgeSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";

  if (!edgeSecret || internalSecret !== edgeSecret) {
    return json(401, { ok: false, error: "Unauthorized" }, origin);
  }

  const res = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-run-production-supervisor`,
    {
      method: "POST",
      headers: {
        "x-internal-secret": edgeSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "cron" }),
    },
  );

  const body = await res.text();
  const data = (() => { try { return JSON.parse(body); } catch { return { raw: body }; } })();

  return json(res.status, data, origin);
});
