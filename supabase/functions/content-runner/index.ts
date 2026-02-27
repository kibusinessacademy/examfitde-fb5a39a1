import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { inferBackoffSeconds, edgeFunctionForJobType } from "../_shared/job-map.ts";

import { PIPELINE_GRAPH, validatePipelineGraph } from "../_shared/job-map.ts";

const BASE_CONCURRENCY = 3;
const WORKER_ID = `content-runner-${crypto.randomUUID().slice(0, 8)}`;
const FUNCTION_VERSION = "v1.2-boot-guards";

// ── Boot-time guards (crash loudly on drift) ──────────────────────
validatePipelineGraph(PIPELINE_GRAPH);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

// deno-lint-ignore no-explicit-any
async function dispatchJob(job: any, supabaseUrl: string, serviceKey: string): Promise<{ ok: boolean; result?: any; error?: string; terminal?: boolean }> {
  const edgeFn = edgeFunctionForJobType(job.job_type);
  if (!edgeFn) {
    return { ok: false, error: `NO_EDGE_FUNCTION_MAPPING:${job.job_type}`, terminal: true };
  }

  const url = `${supabaseUrl}/functions/v1/${edgeFn}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000); // 55s hard cutoff

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(job.payload ?? {}),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json().catch(() => ({}));
    return { ok: true, result: data };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted")) {
      return { ok: false, error: "TIMEOUT: edge function exceeded 55s" };
    }
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  // ── Boot-time RPC guard: crash loudly if claim RPC missing ──
  const concurrency = Number(Deno.env.get("CONTENT_RUNNER_CONCURRENCY") ?? String(BASE_CONCURRENCY));

  // ── 1. Claim content-pool jobs via v4 RPC (with auto-lease healing) ──
  // deno-lint-ignore no-explicit-any
  let { data: jobs, error: claimErr } = await sb.rpc("claim_pending_jobs_v4" as any, {
    p_limit: concurrency,
    p_worker_id: WORKER_ID,
    p_lock_timeout_minutes: 25, // content jobs need longer locks
    p_worker_pool: "content",
  });
  jobs = (jobs ?? []) as any[];

  if (claimErr) {
    console.error(`[content-runner] claim error: ${claimErr.message}`);
    return json({ ok: false, error: claimErr.message }, 500);
  }

  if (!jobs || jobs.length === 0) {
    return json({ ok: true, processed: 0, worker: WORKER_ID, message: "No content jobs pending" });
  }

  console.log(`[content-runner] Claimed ${jobs.length} job(s) [concurrency=${concurrency}, worker=${WORKER_ID}, version=${FUNCTION_VERSION}]`);

  // ── 2. Process each job sequentially (heavy jobs = no parallel dispatch) ──
  // deno-lint-ignore no-explicit-any
  const results: any[] = [];

  for (const job of jobs) {
    const shortId = String(job.id).slice(0, 8);
    const startMs = Date.now();

    try {
      const { ok, result, error: dispatchError, terminal } = await dispatchJob(job, supabaseUrl, serviceKey);

      if (ok) {
        // ── Success ──
        const now = new Date().toISOString();
        await sb.from("job_queue").update({
          status: "completed",
          result: result ?? {},
          completed_at: now,
          updated_at: now,
          locked_at: null,
          locked_by: null,
        }).eq("id", job.id);

        console.log(`[content-runner] ✅ ${job.job_type} (${shortId}) completed in ${Date.now() - startMs}ms`);
        results.push({ id: job.id, ok: true, latency_ms: Date.now() - startMs });
      } else if (terminal) {
        // ── Terminal / structural error — fail immediately, no retry ──
        const now = new Date().toISOString();
        await sb.from("job_queue").update({
          status: "failed",
          last_error: (dispatchError || "terminal").slice(0, 2000),
          completed_at: now,
          updated_at: now,
          locked_at: null,
          locked_by: null,
        }).eq("id", job.id);
        console.error(`[content-runner] 🛑 TERMINAL ${job.job_type} (${shortId}): ${dispatchError}`);
        results.push({ id: job.id, ok: false, error: dispatchError, terminal: true });
      } else {
        // ── Transient failure — retry with backoff ──
        const attemptsNext = (job.attempts ?? 0) + 1;
        const maxAttempts = job.max_attempts ?? 8;
        const exhausted = attemptsNext >= maxAttempts;
        const now = new Date().toISOString();
        const backoffSec = inferBackoffSeconds(dispatchError || "");

        const update: Record<string, unknown> = {
          attempts: attemptsNext,
          last_error: (dispatchError || "unknown").slice(0, 2000),
          updated_at: now,
          locked_at: null,
          locked_by: null,
        };

        if (exhausted) {
          update.status = "failed";
          update.completed_at = now;
        } else {
          update.status = "pending";
          update.run_after = new Date(Date.now() + backoffSec * 1000).toISOString();
        }

        await sb.from("job_queue").update(update).eq("id", job.id);

        console.warn(`[content-runner] ❌ ${job.job_type} (${shortId}) failed [${attemptsNext}/${maxAttempts}]: ${(dispatchError || "").slice(0, 200)}`);
        results.push({ id: job.id, ok: false, error: dispatchError, exhausted });
      }
    } catch (e) {
      // Unexpected error — release lock
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[content-runner] UNEXPECTED error on ${shortId}: ${msg}`);
      await sb.from("job_queue").update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
        last_error: `content-runner crash: ${msg.slice(0, 500)}`,
        run_after: new Date(Date.now() + 30_000).toISOString(),
      }).eq("id", job.id);
      results.push({ id: job.id, ok: false, error: msg });
    }
  }

  const processed = results.filter(r => r.ok).length;
  console.log(`[content-runner] Done: ${processed}/${jobs.length} succeeded`);
  return json({ ok: true, leased: jobs.length, processed, results, worker: WORKER_ID });
});
