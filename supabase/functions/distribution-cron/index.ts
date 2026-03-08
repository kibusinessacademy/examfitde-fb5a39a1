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
  const doPlanSync = body.plan_sync !== false;
  const doEnqueue = body.enqueue !== false;
  const doWorker = body.worker !== false;
  const doStatusSync = body.status_sync !== false;

  const steps: any[] = [];

  if (doPlanSync) {
    steps.push({
      step: "distribution_plan_sync",
      ...(await invokeSelf(supabaseUrl, serviceKey, "distribution-plan-sync", {})),
    });
  }

  if (doEnqueue) {
    steps.push({
      step: "distribution_enqueue",
      ...(await invokeSelf(supabaseUrl, serviceKey, "distribution-enqueue", {})),
    });
  }

  if (doWorker) {
    steps.push({
      step: "distribution_worker",
      ...(await invokeSelf(supabaseUrl, serviceKey, "distribution-worker", {
        limit: body.worker_limit ?? 10,
      })),
    });
  }

  if (doStatusSync) {
    steps.push({
      step: "distribution_status_sync",
      ...(await invokeSelf(supabaseUrl, serviceKey, "distribution-status-sync", {})),
    });
  }

  return json(200, { ok: true, steps, ran_at: new Date().toISOString() }, origin);
});
