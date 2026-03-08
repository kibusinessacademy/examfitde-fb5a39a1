import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

async function invokeSelf(url: string, serviceKey: string, fn: string, body: unknown) {
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const body = await req.json().catch(() => ({}));
  const doIngest = body.ingest !== false;
  const doScore = body.score !== false;

  const steps: any[] = [];

  // Step 1: Ingest market signals
  if (doIngest) {
    steps.push({
      step: "signal_ingest",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-signal-ingest", {
        limit: body.limit ?? 100,
      })),
    });
  }

  // Step 2: Compute intelligence scores + sync recommendations
  if (doScore) {
    steps.push({
      step: "intelligence_score",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-intelligence-score", {
        limit: body.limit ?? 100,
      })),
    });
  }

  return json(200, {
    ok: true,
    steps,
    ran_at: new Date().toISOString(),
  }, origin);
});
