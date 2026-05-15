// SEO Pool Runner — claims worker_pool='seo' jobs and dispatches to seo-intent-page-generator.
// Atomic claim via claim_pending_jobs_v5 (sets status=processing, started_at, attempts++, locked_by).
// Idempotent: SKIP LOCKED + small batch. Generator self-finalizes job (completed/failed).
//
// Called by pg_cron `seo-pool-drain-5min`.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BATCH = 5;
const MAX_BATCH = 10;
const DISPATCH_CONCURRENCY = 3;
const WORKER_ID = `seo-pool-runner-${crypto.randomUUID().slice(0, 8)}`;

interface ClaimedJob {
  id: string;
  job_type: string;
  payload: Record<string, unknown> | null;
}

async function dispatchOne(
  supabaseUrl: string,
  serviceKey: string,
  jobId: string,
): Promise<{ job_id: string; ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/seo-intent-page-generator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
      body: JSON.stringify({ job_id: jobId }),
    });
    const text = await res.text();
    return { job_id: jobId, ok: res.ok, status: res.status, error: res.ok ? undefined : text.slice(0, 300) };
  } catch (e) {
    return { job_id: jobId, ok: false, status: 0, error: String((e as Error).message ?? e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let batch = DEFAULT_BATCH;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (typeof body?.batch === "number") {
        batch = Math.max(1, Math.min(MAX_BATCH, Math.floor(body.batch)));
      }
    } catch { /* tolerate empty body / cron call */ }
  }

  // 1) Atomic claim from pool='seo'
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_pending_jobs_v5", {
    p_worker_id: WORKER_ID,
    p_limit: batch,
    p_worker_pool: "seo",
  });

  if (claimErr) {
    await supabase.from("auto_heal_log").insert({
      action_type: "seo_pool_runner_claim_failed",
      target_type: "system",
      result_status: "failed",
      metadata: { worker_id: WORKER_ID, error: claimErr.message, batch },
    });
    return new Response(
      JSON.stringify({ ok: false, error: "claim_failed", detail: claimErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const jobs = (claimed ?? []) as ClaimedJob[];
  if (jobs.length === 0) {
    await supabase.from("auto_heal_log").insert({
      action_type: "seo_pool_runner_run",
      target_type: "system",
      result_status: "noop",
      metadata: { worker_id: WORKER_ID, batch, claimed: 0 },
    });
    return new Response(
      JSON.stringify({ ok: true, claimed: 0, dispatched: 0, results: [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 2) Dispatch (limited concurrency)
  const results: Array<{ job_id: string; ok: boolean; status: number; error?: string }> = [];
  for (let i = 0; i < jobs.length; i += DISPATCH_CONCURRENCY) {
    const chunk = jobs.slice(i, i + DISPATCH_CONCURRENCY);
    const settled = await Promise.all(
      chunk.map((j) => dispatchOne(supabaseUrl, serviceKey, j.id)),
    );
    results.push(...settled);
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  await supabase.from("auto_heal_log").insert({
    action_type: "seo_pool_runner_run",
    target_type: "system",
    result_status: failCount === 0 ? "success" : "partial",
    metadata: {
      worker_id: WORKER_ID,
      batch,
      claimed: jobs.length,
      dispatched_ok: okCount,
      dispatched_failed: failCount,
      results: results.map((r) => ({ job_id: r.job_id, ok: r.ok, status: r.status, error: r.error })),
    },
  });

  return new Response(
    JSON.stringify({ ok: true, claimed: jobs.length, dispatched: okCount, failed: failCount, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
