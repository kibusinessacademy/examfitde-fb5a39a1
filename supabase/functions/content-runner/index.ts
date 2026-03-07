import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { inferBackoffSeconds, edgeFunctionForJobType, poolForJobType } from "../_shared/job-map.ts";
import { isTransientLlmError, classifyError } from "../_shared/llm/normalize.ts";
import { setProviderCooldown, cleanupExpiredCooldowns, filterCooledDownProviders, isOnCooldown } from "../_shared/llm/provider-cooldown.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";

import { PIPELINE_GRAPH, validatePipelineGraph } from "../_shared/job-map.ts";

const BASE_CONCURRENCY = 8; // v2.0: raised from 4 to 8 for adaptive throughput — matches worker-config hard cap
const CONTENT_LOCK_TIMEOUT_MINUTES = 5; // was 25: shorter stale-lock recovery for 42s dispatch jobs
const STALE_LOCK_RECOVERY_MS = 3 * 60_000; // recover orphaned processing locks after 3 minutes
const DISPATCH_TIMEOUT_MS = 42_000;
const WORKER_ID = `content-runner-${crypto.randomUUID().slice(0, 8)}`;
const FUNCTION_VERSION = "v1.6-parallel-healthgate";

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

/** Simple numeric hash from job UUID for fair provider distribution */
function hashJobId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
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
        attempt_index: (job.meta?.transient_attempts ?? job.attempts ?? 0),  // v6: use transient counter for provider rotation
        max_attempts: job.max_attempts ?? 8,
        job_id: job.id,
        _meta_attempt_index: (job.meta?.transient_attempts ?? job.attempts ?? 0),
        _job_hash: hashJobId(job.id),  // v1.6: deterministic seed for fair provider distribution
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
    .lt("updated_at", staleBefore)  // v1.4: require BOTH locked_at AND updated_at to be stale (prevents recovering legit long jobs)
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

  // ── Cleanup expired cooldowns (once per run) ──
  try {
    const cleaned = await cleanupExpiredCooldowns();
    if (cleaned > 0) console.log(`[content-runner] Cleaned ${cleaned} expired provider cooldown(s)`);
  } catch { /* best-effort */ }

  // ── 2. Pre-dispatch Provider Health Gate ──
  // Check cooldowns BEFORE dispatching to avoid burst-failures across parallel runners
  let activeChain: { provider: string; model: string; [k: string]: unknown }[] = [];
  let fullChainLength = 0;
  try {
    const fullChain = await getModelChainAsync("learning_content");
    fullChainLength = fullChain.length;
    activeChain = await filterCooledDownProviders(fullChain);
    if (activeChain.length < fullChain.length) {
      console.log(`[content-runner] HEALTH_GATE: ${fullChain.length - activeChain.length} provider(s) on cooldown, ${activeChain.length} available`);
    }
  } catch (e) {
    console.warn(`[content-runner] HEALTH_GATE: chain fetch failed, proceeding without gate: ${(e as Error)?.message?.slice(0, 100)}`);
  }

  // If ALL providers were filtered and the sole survivor is still on cooldown, defer everything
  // filterCooledDownProviders never returns empty — when all are cooled it returns the shortest-cooldown one
  const allProvidersCooled = fullChainLength > 1 && activeChain.length === 1;
  if (allProvidersCooled) {
    const onlyProvider = activeChain[0];
    const stillCooled = await isOnCooldown(onlyProvider.provider, onlyProvider.model);
    if (stillCooled) {
      console.warn(`[content-runner] HEALTH_GATE: ALL ${fullChainLength} providers on cooldown — deferring ${jobs.length} job(s) by 30s`);
      const deferAt = new Date(Date.now() + 30_000).toISOString();
      for (const job of jobs) {
        await sb.from("job_queue").update({
          status: "pending",
          run_after: deferAt,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
          last_error: `HEALTH_GATE: all providers on cooldown, deferred by ${WORKER_ID}`,
        }).eq("id", job.id).eq("status", "processing");
      }
      return json({ ok: true, leased: jobs.length, processed: 0, deferred: jobs.length, reason: "all_providers_cooled", worker: WORKER_ID });
    }
  }

  // ── 3. Process jobs in parallel via Promise.allSettled ──
  // deno-lint-ignore no-explicit-any
  const results: any[] = [];

  // deno-lint-ignore no-explicit-any
  async function processOneJob(job: any): Promise<any> {
    const shortId = String(job.id).slice(0, 8);
    const startMs = Date.now();

    try {
      const { ok, result, error: dispatchError, terminal } = await dispatchJob(job, supabaseUrl, serviceKey);

      if (ok) {
        const hasRealResult = result && typeof result === "object" && (
          (result.generated !== undefined && result.generated > 0) ||
          result.batch_complete === true ||
          result.ok === true
        );
        const isTransient = result?.transient === true;

        if (isTransient || !hasRealResult) {
          const now = new Date().toISOString();
          const usedProvider = result?.used_provider || result?.provider || "unknown";
          const usedModel = result?.used_model || result?.model || "unknown";
          const prevTransient = (job.meta?.transient_attempts ?? 0);
          const transientNext = prevTransient + 1;
          const TRANSIENT_MAX = 25;
          const TRANSIENT_TIMEOUT_MS = 45 * 60 * 1000;

          const firstTransientAtRaw = job.meta?.first_transient_at;
          const firstTransientAt =
            typeof firstTransientAtRaw === "string" && !Number.isNaN(Date.parse(firstTransientAtRaw))
              ? firstTransientAtRaw
              : now;
          const transientElapsedMs = Date.now() - new Date(firstTransientAt).getTime();
          const timedOut = transientElapsedMs > TRANSIENT_TIMEOUT_MS;
          const exhausted = transientNext >= TRANSIENT_MAX || timedOut;

          const stallBackoff = Math.max(15, Math.min(30 * Math.pow(2, Math.min(transientNext - 1, 5)), 1800));

          const errorLabel = isTransient
            ? `TRANSIENT: empty/timeout result (gen=${result?.generated ?? 0})`
            : `EMPTY_RESULT: job returned ok=true but no real content`;

          const update: Record<string, unknown> = {
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
            update.attempts = (job.attempts ?? 0) + 1;
            (update.meta as Record<string, unknown>).transient_exhausted = true;
            (update.meta as Record<string, unknown>).exhaust_reason = timedOut ? "ops_transient_timeout" : "max_transient_attempts";
          } else {
            update.status = "pending";
            update.run_after = new Date(Date.now() + stallBackoff * 1000).toISOString();
          }

          await sb.from("job_queue").update(update).eq("id", job.id);
          console.warn(`[content-runner] ⚠️ ${job.job_type} (${shortId}) ${isTransient ? "TRANSIENT" : "EMPTY_RESULT"} — backoff ${stallBackoff}s [transient ${transientNext}/${TRANSIENT_MAX}]`);
          return { id: job.id, ok: false, error: errorLabel, exhausted, transient: true };
        } else {
          // Real success — clear last_error
          const now = new Date().toISOString();
          await sb.from("job_queue").update({
            status: "completed",
            result: result ?? {},
            completed_at: now,
            updated_at: now,
            locked_at: null,
            locked_by: null,
            last_error: null,
            meta: {
              ...(job.meta || {}),
              last_provider: result?.used_provider || result?.provider || null,
              last_model: result?.used_model || result?.model || null,
            },
          }).eq("id", job.id);

          console.log(`[content-runner] ✅ ${job.job_type} (${shortId}) completed in ${Date.now() - startMs}ms (gen=${result?.generated ?? "?"})`);
          return { id: job.id, ok: true, latency_ms: Date.now() - startMs };
        }
      } else if (terminal) {
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
        return { id: job.id, ok: false, error: dispatchError, terminal: true };
      } else {
        // Transient or permanent failure — classify with cooldown
        const errorStr = dispatchError || "";
        const classification = classifyError(errorStr);
        const isTransientErr = classification.isTransient;
        const now = new Date().toISOString();
        const backoffSec = Math.max(15, inferBackoffSeconds(errorStr));

        if (classification.providerCooldownMs) {
          const attemptIdx = job.meta?.transient_attempts ?? job.attempts ?? 0;
          let jobProvider = "unknown";
          let jobModel = "unknown";
          try {
            const chainForCooldown = await getModelChainAsync("learning_content");
            const provIdx = attemptIdx % Math.max(1, chainForCooldown.length);
            jobProvider = chainForCooldown[provIdx]?.provider || "unknown";
            jobModel = chainForCooldown[provIdx]?.model || "unknown";
          } catch { /* fallback to unknown */ }
          if (job.meta?.last_provider && job.meta.last_provider !== "unknown") jobProvider = job.meta.last_provider;
          if (job.meta?.last_model && job.meta.last_model !== "unknown") jobModel = job.meta.last_model;
          setProviderCooldown({
            provider: jobProvider,
            model: jobModel,
            ms: classification.providerCooldownMs,
            reason: classification.reason,
          });
          console.warn(`[content-runner] 🔄 COOLDOWN SET: ${jobProvider}/${jobModel} for ${Math.round(classification.providerCooldownMs / 1000)}s — reason: ${classification.reason}`);
        }

        if (isTransientErr) {
          const prevTransient = (job.meta?.transient_attempts ?? 0);
          const transientNext = prevTransient + 1;
          const TRANSIENT_MAX = 25;
          const TRANSIENT_TIMEOUT_MS = 45 * 60 * 1000;

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
            const effectiveBackoff = classification.reason === "ops_empty_response"
              ? Math.max(15, Math.min(backoffSec, 30))
              : backoffSec;
            update.run_after = new Date(Date.now() + effectiveBackoff * 1000).toISOString();
          }

          await sb.from("job_queue").update(update).eq("id", job.id);
          const logBackoff = classification.reason === "ops_empty_response"
            ? Math.max(15, Math.min(backoffSec, 30))
            : backoffSec;
          console.warn(`[content-runner] ⚡ ${job.job_type} (${shortId}) TRANSIENT [${classification.reason}] — backoff ${logBackoff}s [transient ${transientNext}/${TRANSIENT_MAX}]`);
          return { id: job.id, ok: false, error: errorStr, exhausted, transient: true };
        } else {
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
          return { id: job.id, ok: false, error: errorStr, exhausted };
        }
      }
    } catch (e) {
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
      return { id: job.id, ok: false, error: msg };
    }
  }

  // Dispatch all claimed jobs in parallel
  const settled = await Promise.allSettled(jobs.map((job: any) => processOneJob(job)));
  for (const s of settled) {
    if (s.status === "fulfilled") {
      results.push(s.value);
    } else {
      results.push({ ok: false, error: s.reason?.message ?? String(s.reason) });
    }
  }

  const processed = results.filter(r => r.ok).length;
  console.log(`[content-runner] Done: ${processed}/${jobs.length} succeeded`);
  return json({ ok: true, leased: jobs.length, processed, results, worker: WORKER_ID });
});
