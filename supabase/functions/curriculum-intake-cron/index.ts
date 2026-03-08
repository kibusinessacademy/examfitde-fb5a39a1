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
  const doDiscover = body.discover !== false;
  const doDownload = body.download !== false;
  const doParse = body.parse !== false;
  const doPromote = body.promote !== false;

  const steps: any[] = [];

  // Step 1: Discover new sources
  if (doDiscover) {
    steps.push({
      step: "discover",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-discover-sources", {})),
    });
  }

  // Step 2: Download worker
  if (doDownload) {
    steps.push({
      step: "download",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-intake-worker", {
        job_type: "download",
        limit: 10,
      })),
    });
  }

  // Step 3: Parse worker
  if (doParse) {
    steps.push({
      step: "parse",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-intake-worker", {
        job_type: "parse",
        limit: 10,
      })),
    });
  }

  // Step 4: Promote ready candidates
  if (doPromote) {
    steps.push({
      step: "promote",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-promote-candidates", {
        limit: 20,
      })),
    });
  }

  return json(200, {
    ok: true,
    steps,
    ran_at: new Date().toISOString(),
  }, origin);
});
