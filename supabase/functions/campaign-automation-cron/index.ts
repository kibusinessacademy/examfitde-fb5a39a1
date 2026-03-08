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
  const doPerformance = body.performance !== false;

  const steps: any[] = [];

  // Step 1: Sync launch recommendations → campaign launch plans
  if (doPlanSync) {
    steps.push({
      step: "plan_sync",
      ...(await invokeSelf(supabaseUrl, serviceKey, "campaign-plan-sync", {})),
    });
  }

  // Step 2: Enqueue assets from queued plans
  if (doEnqueue) {
    steps.push({
      step: "asset_enqueue",
      ...(await invokeSelf(supabaseUrl, serviceKey, "campaign-asset-enqueue", {})),
    });
  }

  // Step 3: Process queued asset jobs
  if (doWorker) {
    steps.push({
      step: "asset_worker",
      ...(await invokeSelf(supabaseUrl, serviceKey, "campaign-asset-worker", {
        limit: body.worker_limit ?? 10,
      })),
    });
  }

  // Step 4: Sync performance snapshots
  if (doPerformance) {
    steps.push({
      step: "performance_sync",
      ...(await invokeSelf(supabaseUrl, serviceKey, "campaign-performance-sync", {})),
    });
  }

  return json(200, { ok: true, steps, ran_at: new Date().toISOString() }, origin);
});
