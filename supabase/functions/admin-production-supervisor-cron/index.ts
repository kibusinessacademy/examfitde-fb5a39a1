import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";

/**
 * admin-production-supervisor-cron — Thin cron invoker.
 * Auth via assertAdmin: x-internal-secret OR service-role bearer OR admin JWT.
 */

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  const auth = await assertAdmin(req, "admin-production-supervisor-cron");
  if (!auth.ok) return json(auth.status, { ok: false, error: "Unauthorized" }, origin);


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
