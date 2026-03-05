import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { inferBackoffSeconds, edgeFunctionForJobType, poolForJobType } from "../_shared/job-map.ts";
import { isTransientLlmError, classifyError } from "../_shared/llm/normalize.ts";
import { setProviderCooldown, cleanupExpiredCooldowns } from "../_shared/llm/provider-cooldown.ts";

import { PIPELINE_GRAPH, validatePipelineGraph } from "../_shared/job-map.ts";

const BASE_CONCURRENCY = 6;
const CONTENT_LOCK_TIMEOUT_MINUTES = 5; // was 25: shorter stale-lock recovery for 42s dispatch jobs
const STALE_LOCK_RECOVERY_MS = 3 * 60_000; // recover orphaned processing locks after 3 minutes
const DISPATCH_TIMEOUT_MS = 42_000;
const WORKER_ID = `content-runner-${crypto.randomUUID().slice(0, 8)}`;
const FUNCTION_VERSION = "v1.4-persistent-cooldown";

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
  const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS); // align with runner budget

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        ...(job.payload ?? {}),
        attempts: job.attempts ?? 0,
        attempt_index: (job.meta?.transient_attempts ?? job.attempts ?? 0),  // v6: use transient counter for provider rotation (attempts stays 0 for transients)
        max_attempts: job.max_attempts ?? 8,
        job_id: job.id,
        _meta_attempt_index: (job.meta?.transient_attempts ?? job.attempts ?? 0),  // v6.1: echo for forensic persistence
      }),
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
      return { ok: false, error: `TIMEOUT: edge function exceeded ${Math.round(DISPATCH_TIMEOUT_MS / 1000)}s` };
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
  // Content concurrency: controlled via BASE_CONCURRENCY (env-overridable)
  const concurrency = BASE_CONCURRENCY;

  // ── 0. Stale-lock recovery (orphaned processing jobs) ──
  // If a previous worker died mid-run, those jobs block package-level dedup and stall progress.
  const staleBefore = new Date(Date.now() - STALE_LOCK_RECOVERY_MS).toISOString();
  const { data: staleRows } = await sb
    .from("job_queue")
    .select("id")
    .eq("worker_pool", "content")
    .eq("status", "processing")
    .not("locked_by", "is", null)
    .lt("locked_at", staleBefore)
    .limit(50);

  if (staleRows && staleRows.length > 0) {
    const staleIds = staleRows.map((r: any) => r.id);
    await sb.from("job_queue").update({
      status: "pending",
      run_after: new Date(Date.now() + 5_000).toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
      last_error: `STALE_LOCK_RECOVERY: released by ${WORKER_ID}`,
      meta: { recovered_by: WORKER_ID, recovered_at: new Date().toISOString(), reason: "stale_processing_lock" },
    }).in("id", staleIds);
    console.warn(`[content-runner] STALE_LOCK_RECOVERY: released ${staleIds.length} orphaned processing job(s)`);
  }

  // ── 1. Claim content-pool jobs via v4 RPC (with auto-lease healing) ──
  // deno-lint-ignore no-explicit-any
  let { data: jobs, error: claimErr } = await sb.rpc("claim_pending_jobs_v4" as any, {
    p_limit: concurrency,
    p_worker_id: WORKER_ID,
    p_lock_timeout_minutes: CONTENT_LOCK_TIMEOUT_MINUTES,
    p_worker_pool: "content",
  });
  jobs = ((jobs ?? []) as any[]).slice(0, concurrency);

  if (claimErr) {
    console.error(`[content-runner] claim error: ${claimErr.message}`);
    return json({ ok: false, error: claimErr.message }, 500);
  }

  if (!jobs || jobs.length === 0) {
    return json({ ok: true, processed: 0, worker: WORKER_ID, message: "No content jobs pending" });
  }

  // ── Defense-in-Depth: Auto-fix pool mismatch on claimed jobs ──
  for (const job of jobs) {
    const expectedPool = poolForJobType(job.job_type);
    if (job.worker_pool && job.worker_pool !== expectedPool) {
      console.warn(`[content-runner] POOL_AUTOFIX: ${job.job_type} (${String(job.id).slice(0,8)}) had pool="${job.worker_pool}" → fixing to "${expectedPool}"`);
      await sb.from("job_queue").update({
        worker_pool: expectedPool,
        meta: { ...(job.meta || {}), pool_autofixed: true, old_pool: job.worker_pool },
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      job.worker_pool = expectedPool;
    }
  }

  console.log(`[content-runner] Claimed ${jobs.length} job(s) [concurrency=${concurrency}, worker=${WORKER_ID}, version=${FUNCTION_VERSION}]`);

  // ── 2. Process each job sequentially (heavy jobs = no parallel dispatch) ──
  // deno-lint-ignore no-explicit-any
  const results: any[] = [];
  const runnerStartMs = Date.now();
  const RUNNER_TIME_BUDGET_MS = 100_000;

  for (let jobIdx = 0; jobIdx < jobs.length; jobIdx++) {
    const job = jobs[jobIdx];
    const shortId = String(job.id).slice(0, 8);
    const elapsed = Date.now() - runnerStartMs;

    if (elapsed > RUNNER_TIME_BUDGET_MS) {
      const remaining = jobs.slice(jobIdx);
      const releaseAt = new Date(Date.now() + 5_000).toISOString();
      for (const rj of remaining) {
        await sb.from("job_queue").update({
          status: "pending",
          run_after: releaseAt,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
          last_error: `RUNNER_TIME_GUARD: released by ${WORKER_ID}`,
        }).eq("id", rj.id).eq("status", "processing");
        results.push({ id: rj.id, ok: false, released: true, reason: "runner_time_guard" });
      }
      console.warn(`[content-runner] RUNNER_TIME_GUARD: released ${remaining.length} job(s) after ${elapsed}ms`);
      break;
  }

  // ── 0b. Cleanup expired provider cooldowns ──
  try {
    const cleaned = await cleanupExpiredCooldowns();
    if (cleaned > 0) console.log(`[content-runner] Cleaned ${cleaned} expired provider cooldown(s)`);
  } catch { /* best-effort */ }


    const startMs = Date.now();

    try {
      const { ok, result, error: dispatchError, terminal } = await dispatchJob(job, supabaseUrl, serviceKey);

      if (ok) {
        // ── v5.6: Success ONLY if result has real content ──
        // Prevent "completed" status on empty/transient results
        const hasRealResult = result && typeof result === "object" && (
          (result.generated !== undefined && result.generated > 0) ||
          result.batch_complete === true ||
          result.ok === true
        );
        const isTransient = result?.transient === true;

        if (isTransient || !hasRealResult) {
          // Transient or empty result → use SEPARATE transient budget (not main attempts)
          const now = new Date().toISOString();
          const prevTransient = (job.meta?.transient_attempts ?? 0);
          const transientNext = prevTransient + 1;
          const TRANSIENT_MAX = 25;
          const TRANSIENT_TIMEOUT_MS = 45 * 60 * 1000; // 45 min max transient window (was 20 — too short for extended provider outages)

          // Track first transient occurrence for timeout guard
          const firstTransientAtRaw = job.meta?.first_transient_at;
          const firstTransientAt =
            typeof firstTransientAtRaw === "string" && !Number.isNaN(Date.parse(firstTransientAtRaw))
              ? firstTransientAtRaw
              : now;
          const transientElapsedMs = Date.now() - new Date(firstTransientAt).getTime();
          const timedOut = transientElapsedMs > TRANSIENT_TIMEOUT_MS;
          const exhausted = transientNext >= TRANSIENT_MAX || timedOut;

          // Stall penalty: min 15s, escalating, capped at 1800s
          const stallBackoff = Math.max(15, Math.min(30 * Math.pow(2, Math.min(transientNext - 1, 5)), 1800));

          const errorLabel = isTransient
            ? `TRANSIENT: empty/timeout result (gen=${result?.generated ?? 0})`
            : `EMPTY_RESULT: job returned ok=true but no real content`;

          const update: Record<string, unknown> = {
            // DO NOT increment attempts — transient budget is separate
            last_error: errorLabel,
            updated_at: now,
            locked_at: null,
            locked_by: null,
            meta: {
              ...(job.meta || {}),
              transient_attempts: transientNext,
              attempt_index: transientNext,
              last_error_kind: "transient",
              last_error_class: "transient",
              last_transient_at: now,
              first_transient_at: firstTransientAt,
            },
          };

          if (exhausted) {
            update.status = "failed";
            update.completed_at = now;
            update.attempts = (job.attempts ?? 0) + 1; // consume 1 attempt only on exhaustion
            (update.meta as Record<string, unknown>).transient_exhausted = true;
            (update.meta as Record<string, unknown>).exhaust_reason = timedOut ? "ops_transient_timeout" : "max_transient_attempts";
          } else {
            update.status = "pending";
            update.run_after = new Date(Date.now() + stallBackoff * 1000).toISOString();
          }

          await sb.from("job_queue").update(update).eq("id", job.id);
          console.warn(`[content-runner] ⚠️ ${job.job_type} (${shortId}) ${isTransient ? "TRANSIENT" : "EMPTY_RESULT"} — backoff ${stallBackoff}s [transient ${transientNext}/${TRANSIENT_MAX}]`);
          results.push({ id: job.id, ok: false, error: errorLabel, exhausted, transient: true });
        } else {
          // Real success
          const now = new Date().toISOString();
          await sb.from("job_queue").update({
            status: "completed",
            result: result ?? {},
            completed_at: now,
            updated_at: now,
            locked_at: null,
            locked_by: null,
          }).eq("id", job.id);

          console.log(`[content-runner] ✅ ${job.job_type} (${shortId}) completed in ${Date.now() - startMs}ms (gen=${result?.generated ?? "?"})`);
          results.push({ id: job.id, ok: true, latency_ms: Date.now() - startMs });
        }
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
        // ── Transient or permanent failure — classify with cooldown info ──
        const errorStr = dispatchError || "";
        const classification = classifyError(errorStr);
        const isTransient = classification.isTransient;
        const now = new Date().toISOString();
        const backoffSec = Math.max(15, inferBackoffSeconds(errorStr)); // clamp minimum 15s

        // v13: Set provider cooldown if classification recommends it
        // This prevents the runner from re-dispatching to the same failing provider
        if (classification.providerCooldownMs) {
          // Extract provider/model from job payload or error for cooldown tracking
          const jobProvider = job.meta?.last_provider || job.payload?.provider || "unknown";
          const jobModel = job.meta?.last_model || job.payload?.model || "unknown";
          setProviderCooldown({
            provider: jobProvider,
            model: jobModel,
            ms: classification.providerCooldownMs,
            reason: classification.reason,
          });
          console.warn(`[content-runner] 🔄 COOLDOWN SET: ${jobProvider}/${jobModel} for ${Math.round(classification.providerCooldownMs / 1000)}s — reason: ${classification.reason}`);
        }

        if (isTransient) {
          // Transient errors (503, timeout, rate limit, empty response) use separate budget
          const prevTransient = (job.meta?.transient_attempts ?? 0);
          const transientNext = prevTransient + 1;
          const TRANSIENT_MAX = 25;
          const TRANSIENT_TIMEOUT_MS = 45 * 60 * 1000; // 45 min max transient window

          // Track first transient occurrence for timeout guard (robust parsing)
          const firstTransientAtRaw = job.meta?.first_transient_at;
          const firstTransientAt =
            typeof firstTransientAtRaw === "string" && !Number.isNaN(Date.parse(firstTransientAtRaw))
              ? firstTransientAtRaw
              : now;
          const transientElapsedMs = Date.now() - new Date(firstTransientAt).getTime();
          const timedOut = transientElapsedMs > TRANSIENT_TIMEOUT_MS;
          const exhausted = transientNext >= TRANSIENT_MAX || timedOut;

          const update: Record<string, unknown> = {
            last_error: errorStr.slice(0, 2000),
            updated_at: now,
            locked_at: null,
            locked_by: null,
            meta: {
              ...(job.meta || {}),
              transient_attempts: transientNext,
              attempt_index: transientNext,
              last_error_kind: "transient",
              last_error_class: "transient",
              last_error_reason: classification.reason,
              last_transient_at: now,
              first_transient_at: firstTransientAt,
            },
          };

          if (exhausted) {
            update.status = "failed";
            update.completed_at = now;
            update.attempts = (job.attempts ?? 0) + 1;
            (update.meta as Record<string, unknown>).transient_exhausted = true;
            (update.meta as Record<string, unknown>).exhaust_reason = timedOut ? "ops_transient_timeout" : "max_transient_attempts";
          } else {
            update.status = "pending";
            // v13: Use shorter backoff for empty responses (rotate faster)
            const effectiveBackoff = classification.reason === "ops_empty_response"
              ? Math.max(15, Math.min(backoffSec, 30))  // fast rotate on empty response
              : backoffSec;
            update.run_after = new Date(Date.now() + effectiveBackoff * 1000).toISOString();
          }

          await sb.from("job_queue").update(update).eq("id", job.id);
          const logBackoff = classification.reason === "ops_empty_response"
            ? Math.max(15, Math.min(backoffSec, 30))
            : backoffSec;
          console.warn(`[content-runner] ⚡ ${job.job_type} (${shortId}) TRANSIENT [${classification.reason}] — backoff ${logBackoff}s [transient ${transientNext}/${TRANSIENT_MAX}]`);
          results.push({ id: job.id, ok: false, error: errorStr, exhausted, transient: true });
        } else {
          // Non-transient (permanent) failure — consume attempts budget
          const attemptsNext = (job.attempts ?? 0) + 1;
          const maxAttempts = job.max_attempts ?? 8;
          const exhausted = attemptsNext >= maxAttempts;

          const update: Record<string, unknown> = {
            attempts: attemptsNext,
            last_error: errorStr.slice(0, 2000),
            updated_at: now,
            locked_at: null,
            locked_by: null,
            meta: {
              ...(job.meta || {}),
              last_error_kind: "permanent",
              last_error_class: "permanent",
              last_error_reason: classification.reason,
            },
          };

          if (exhausted) {
            update.status = "failed";
            update.completed_at = now;
          } else {
            update.status = "pending";
            update.run_after = new Date(Date.now() + backoffSec * 1000).toISOString();
          }

          await sb.from("job_queue").update(update).eq("id", job.id);
          console.warn(`[content-runner] ❌ ${job.job_type} (${shortId}) PERMANENT fail [${attemptsNext}/${maxAttempts}]: ${errorStr.slice(0, 200)}`);
          results.push({ id: job.id, ok: false, error: errorStr, exhausted });
        }
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
