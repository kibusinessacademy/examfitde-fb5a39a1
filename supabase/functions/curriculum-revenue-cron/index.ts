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
  const doSignalIngest = body.signal_ingest !== false;
  const doGtmScore = body.gtm_score !== false;
  const doLaunchRecommend = body.launch_recommend !== false;

  const steps: any[] = [];

  if (doSignalIngest) {
    steps.push({
      step: "revenue_signal_ingest",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-revenue-signal-ingest", {
        limit: body.limit ?? 200,
      })),
    });
  }

  if (doGtmScore) {
    steps.push({
      step: "gtm_score",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-gtm-score", {
        limit: body.limit ?? 200,
      })),
    });
  }

  if (doLaunchRecommend) {
    steps.push({
      step: "launch_recommend",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-launch-recommend", {})),
    });
  }

  return json(200, { ok: true, steps, ran_at: new Date().toISOString() }, origin);
});
