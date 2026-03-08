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
  const doScoreAssets = body.score_assets !== false;
  const doScoreCurricula = body.score_curricula !== false;
  const doActionSync = body.action_sync !== false;
  const doExecutor = body.executor !== false;

  const steps: any[] = [];

  if (doScoreAssets) {
    steps.push({
      step: "score_assets",
      ...(await invokeSelf(supabaseUrl, serviceKey, "optimization-score-assets", { limit: body.limit ?? 300 })),
    });
  }

  if (doScoreCurricula) {
    steps.push({
      step: "score_curricula",
      ...(await invokeSelf(supabaseUrl, serviceKey, "optimization-score-curricula", { limit: body.limit ?? 300 })),
    });
  }

  if (doActionSync) {
    steps.push({
      step: "action_sync",
      ...(await invokeSelf(supabaseUrl, serviceKey, "optimization-action-sync", {})),
    });
  }

  if (doExecutor) {
    steps.push({
      step: "executor",
      ...(await invokeSelf(supabaseUrl, serviceKey, "optimization-executor", { limit: body.executor_limit ?? 20 })),
    });
  }

  return json(200, { ok: true, steps, ran_at: new Date().toISOString() }, origin);
});
