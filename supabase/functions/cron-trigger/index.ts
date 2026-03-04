import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient as createSbClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";

/**
 * cron-trigger — Secure proxy for pg_cron → pipeline-runner
 *
 * pg_cron calls this every minute with x-cron-secret header.
 * This function validates the secret and forwards to pipeline-runner
 * using the service role key (never exposed in SQL).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Schema-Version Handshake
    const sbGate = createSbClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await assertSchemaReady("cron-trigger", sbGate);

    if (!CRON_SECRET) {
      return json({ ok: false, error: "CRON_SECRET not configured" }, 500);
    }

    const provided = req.headers.get("x-cron-secret") ?? "";
    if (provided !== CRON_SECRET) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    // Determine which functions to trigger (default: both pipeline-runner + job-runner)
    let targetFns: string[] = ["pipeline-runner", "job-runner", "pipeline-forensic-test"];
    try {
      const body = await req.json();
      if (body?.function) targetFns = [String(body.function)];
      if (body?.functions && Array.isArray(body.functions)) targetFns = body.functions.map(String);
    } catch {
      // no body is fine — trigger both by default
    }

    const results: Record<string, unknown>[] = [];

    for (const fn of targetFns) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            apikey: SERVICE_ROLE_KEY,
            authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: "{}",
        });

        const text = await res.text().catch(() => "");
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        results.push({ function: fn, status: res.status, result: parsed });
      } catch (e: unknown) {
        results.push({ function: fn, error: (e as Error)?.message || String(e) });
      }
    }

    return json({ ok: true, triggered: targetFns, results });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
