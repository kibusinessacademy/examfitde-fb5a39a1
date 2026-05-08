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

  // Auth modes accepted (in order):
  //  1. internal shared secret (pg_cron / scripted invokes via x-internal-secret OR x-job-runner-key)
  //  2. service_role bearer (admin tooling)
  //  3. validated admin user
  // The legacy isAnonCron branch was removed — the anon key is public and
  // allowed any unauthenticated caller to trigger the production supervisor.
  const internalSecretHdr = req.headers.get("x-internal-secret") ?? "";
  const jobRunnerKey = req.headers.get("x-job-runner-key") ?? "";
  const edgeSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";
  const authHeader = req.headers.get("authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const isInternal =
    !!edgeSecret &&
    ((internalSecretHdr && internalSecretHdr === edgeSecret) ||
      (jobRunnerKey && jobRunnerKey === edgeSecret));
  const isService = !!serviceKey && authHeader.includes(serviceKey);

  if (!isInternal && !isService) {
    const auth = await validateAuth(req, true);
    if (auth.error || !auth.isAdmin) {
      return json(401, { ok: false, error: "Unauthorized" }, origin);
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
