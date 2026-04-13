import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { bootstrapLLMLogging } from "../_shared/llm-log-bootstrap.ts";
import { inferBackoffSeconds, edgeFunctionForJobType, poolForJobType, STEP_TO_JOB_TYPE } from "../_shared/job-map.ts";
import { laneForJobType, partitionByLane, allocateLaneBudgets, LANE_DISPATCH_ORDER, type RunnerLane, jobTypesForLane } from "../_shared/runner-lanes.ts";
import { isTransientLlmError, classifyError } from "../_shared/llm/normalize.ts";
import { setProviderCooldown, cleanupExpiredCooldowns, filterCooledDownProviders, isOnCooldown } from "../_shared/llm/provider-cooldown.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveAvailableRoute, resolveLastResortRoute } from "../_shared/llm/provider-load-balancer.ts";
import { checkCircuitBreaker, recordPermanentProviderFailure, recordProviderSuccess, isPermanentProviderError } from "../_shared/llm/provider-circuit-breaker.ts";
import { runPrebuildPass } from "../_shared/prebuild.ts";

import { PIPELINE_GRAPH, validatePipelineGraph } from "../_shared/job-map.ts";

// ── Sanitize HTML error pages (Cloudflare 502/503) ──
function sanitizeError(msg: string): string {
  if (!msg) return msg;
  if (msg.includes("<!DOCTYPE") || msg.includes("<html")) {
    const m = msg.match(/^HTTP (\d{3})/);
    return `HTTP ${m?.[1] ?? "502"}: upstream proxy error (HTML stripped)`;
  }
  return msg;
}

// ── Config ────────────────────────────────────────────────────
function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── SSOT Concurrency: imported from worker-config (single source of truth) ──
// DO NOT define local fallbacks here — they bypass the hardened caps.
import { getRunnerConfig } from "../_shared/worker-config.ts";
const _runnerCfg = getRunnerConfig("content_runner");
const BASE_CONCURRENCY = _runnerCfg.maxConcurrency;  // SSOT: 6 (hard cap 8)
const CLAIM_LIMIT = _runnerCfg.claimLimit;            // SSOT: 8 (hard cap 12)
const CONTENT_LOCK_TIMEOUT_MINUTES = 5;
const STALE_LOCK_RECOVERY_MS = 3 * 60_000;
// ── DISPATCH TIMEOUTS (v2.5: 4-Tier system for budget efficiency) ──
// Edge Function hard limit = 60s.  LOOP_MAX_MS = 50s.
// Dispatch timeout MUST be < LOOP_MAX_MS minus overhead (status-write buffer ~5s).
const DISPATCH_TIMEOUT_LIGHT_MS = 10_000;    // Tier 4: pure DB-query orchestrators (<5s actual)
const DISPATCH_TIMEOUT_MS = 25_000;          // Tier 3: structural/DB-only jobs
const DISPATCH_TIMEOUT_HEAVY_MS = 35_000;    // Tier 2: LLM-validation + DB-heavy jobs
const DISPATCH_TIMEOUT_GENERATION_MS = 40_000; // Tier 1: LLM-generation jobs
const STATUS_WRITE_BUFFER_MS = 5_000;        // Reserved for status-write after dispatch
const WORKER_ID = `content-runner-${crypto.randomUUID().slice(0, 8)}`;
const FUNCTION_VERSION = "v4.3-lane-aware-claiming";

// Pull-loop parameters — TUNED for max throughput
const LOOP_MAX_MS = envInt("CONTENT_RUNNER_LOOP_MAX_MS", 50_000);    // v2.1: 30s→50s (edge fn limit ~60s)
const LOOP_SLEEP_MS = envInt("CONTENT_RUNNER_LOOP_SLEEP_MS", 1_500); // v2.1: 2s→1.5s (faster polling)
const MAX_EMPTY_POLLS = envInt("CONTENT_RUNNER_MAX_EMPTY_POLLS", 3); // v2.1: 2→3 (wait longer for new jobs)
const ABORT_FAIL_RATE_PERCENT = envInt("CONTENT_RUNNER_ABORT_FAIL_RATE_PERCENT", 80);

// ── Boot-time guards ──────────────────────────────────────────
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

// ── CENTRAL RELEASE FUNCTION (v4.2) ──────────────────────────
// Single source of truth for releasing jobs back to pending.
// All skip/defer/budget paths MUST use this instead of inline updates.
// Invariant: No skip/defer path may leave a job in processing.
type ReleaseReason =
  | "RELEASE_BUDGET_EXHAUSTED"
  | "RELEASE_LANE_BUDGET_STOP"
  | "RELEASE_LANE_OVERFLOW"
  | "RELEASE_HEALTH_GATE"
  | "RELEASE_ROUTING_DEFERRED"
  | "RELEASE_CIRCUIT_BREAKER"
  | "RELEASE_CLAIM_BUDGET_EXCEEDED"
  | "RELEASE_COOLDOWN_DEFERRED";

interface ReleaseOpts {
  deferMs?: number;       // delay before job is re-eligible (default: 3000)
  detail?: string;        // human-readable detail appended to reason
  skipAttemptIncrement?: boolean; // default true — release paths don't count as attempts
}

async function releaseJobToPending(
  sb: ReturnType<typeof createClient>,
  jobId: string,
  reason: ReleaseReason,
  opts: ReleaseOpts = {},
): Promise<boolean> {
  const { deferMs = 3_000, detail } = opts;
  const shortId = String(jobId).slice(0, 8);
  const errorMsg = detail ? `${reason}: ${detail}`.slice(0, 2000) : reason;
  const releasePayload = {
    status: "pending" as const,
    locked_at: null as null,
    locked_by: null as null,
    updated_at: new Date().toISOString(),
    last_error: errorMsg,
    run_after: new Date(Date.now() + deferMs).toISOString(),
  };

  // Attempt 1
  const { error: err1 } = await sb.from("job_queue").update(releasePayload)
    .eq("id", jobId).eq("status", "processing");
  if (!err1) return true;

  console.error(`[content-runner] 🚨 ${reason} release FAILED for ${shortId}: ${err1.message} — retrying`);
  // Retry after 200ms
  await new Promise(r => setTimeout(r, 200));
  const { error: err2 } = await sb.from("job_queue").update(releasePayload)
    .eq("id", jobId).eq("status", "processing");
  if (!err2) {
    console.warn(`[content-runner] ⏸️ ${reason} release succeeded on retry for ${shortId}`);
    return true;
  }

  console.error(`[content-runner] 🚨 ${reason} RETRY FAILED for ${shortId}: ${err2.message} — job may remain stuck as processing`);
  return false;
}


// Tier 1 (40s): LLM generation — target functions with actual LLM calls
const GENERATION_JOB_TYPES = new Set([
  "package_generate_handbook", "handbook_expand_section",
  "package_generate_exam_pool",
  "package_auto_seed_exam_blueprints",
  "package_generate_lesson_minichecks",
  "lesson_generate_content_shard",
  "package_generate_oral_exam",  // v4.4: promoted from T3 — real LLM generation, was causing STALE_LOCK_RECOVERY loops at 25s
]);

// Tier 2 (35s): ONLY jobs with actual long-running LLM calls that genuinely need 30s+
// v6.0: Drastically reduced — over-classification caused persistent BUDGET_EXHAUSTED
// because T2 requires 40s budget (35s+5s buffer) out of 50s loop, leaving <10s for all other lanes.
// Most "heavy" jobs actually complete in 1-5s and were mis-promoted in v5.1.
const HEAVY_JOB_TYPES = new Set([
  "package_generate_blueprint_variants",  // real LLM generation, genuinely needs 30s+
  "package_build_ai_tutor_index",         // heavy indexing operation
]);

// v6.0: HEAVY_EXPANDED removed entirely. Previous v5.1 expansion was the root cause of
// BUDGET_EXHAUSTED starvation — 6 control/validation jobs at T2_HEAVY (40s required budget)
// consumed all loop budget, causing every other job type to starve.
// These jobs actually complete in 1-5s and belong in T3_DEFAULT (25s) or T4_LIGHT (10s):
//   - package_run_integrity_check → T3 (edge function, 1-3s actual)
//   - package_quality_council → T3 (AI phases capped internally, 2-8s actual)
//   - package_promote_blueprint_variants → T4 (deterministic DB promotion, <2s actual)
//   - package_scaffold_learning_course → T3 (scaffolding, 3-5s actual)
//   - package_elite_harden → T3 (annotation mode is pure DB, <5s actual)
//   - package_repair_exam_pool_quality → T3 (recovery lane, 3-10s actual)
const HEAVY_EXPANDED_JOB_TYPES = new Set([
  ...HEAVY_JOB_TYPES,
  // v6.0: NO additional jobs — T2 is reserved for genuinely long-running operations only
]);

// Tier 4 (10s): ONLY truly instant DB status-checks — zero Edge Function calls, zero LLM.
// Required budget: 10s + 5s buffer = 15s. Only jobs that do a single DB read + status write.
const LIGHT_JOB_TYPES = new Set([
  "package_validate_learning_content",  // pure DB gate check
  "package_validate_handbook",          // pure DB gate check
  "package_validate_handbook_depth",    // pure DB gate check
  "package_validate_oral_exam",         // pure DB gate check
  "package_validate_tutor_index",       // pure DB gate check
  "package_validate_lesson_minichecks", // pure DB gate check
  "package_enqueue_handbook_expand",    // pure orchestration enqueue
  "package_finalize_learning_content",  // pure barrier check
  "package_auto_publish",              // pure status transition
  "package_validate_blueprints",       // pure DB gate check
  "package_validate_blueprint_variants",// pure DB gate check
  "package_promote_blueprint_variants", // v6.0: demoted from T2 — deterministic DB promotion, <2s actual
  "package_validate_exam_pool",        // v6.0: demoted from T2 — pure validation check, <3s actual
  "package_exam_rebalance",            // pure DB rebalance
]);

// Everything else not in Tier 1/2/4: Tier 3 (25s) — moderate DB + orchestration

// deno-lint-ignore no-explicit-any
async function dispatchJob(job: any, supabaseUrl: string, serviceKey: string, loopDeadlineMs?: number): Promise<{ ok: boolean; result?: any; error?: string; terminal?: boolean }> {
  const edgeFn = edgeFunctionForJobType(job.job_type);
  if (!edgeFn) {
    return { ok: false, error: `NO_EDGE_FUNCTION_MAPPING:${job.job_type}`, terminal: true };
  }

  const tierLabel = GENERATION_JOB_TYPES.has(job.job_type) ? "T1_GEN"
    : HEAVY_EXPANDED_JOB_TYPES.has(job.job_type) ? "T2_HEAVY"
    : LIGHT_JOB_TYPES.has(job.job_type) ? "T4_LIGHT"
    : "T3_DEFAULT";

  const tierTimeout = tierLabel === "T1_GEN" ? DISPATCH_TIMEOUT_GENERATION_MS
    : tierLabel === "T2_HEAVY" ? DISPATCH_TIMEOUT_HEAVY_MS
    : tierLabel === "T4_LIGHT" ? DISPATCH_TIMEOUT_LIGHT_MS
    : DISPATCH_TIMEOUT_MS;

  // ── BUDGET GUARD: never dispatch if remaining loop time < timeout + write buffer ──
  const remainingMs = loopDeadlineMs ? loopDeadlineMs - Date.now() : Infinity;
  const requiredMs = tierTimeout + STATUS_WRITE_BUFFER_MS;
  if (remainingMs < requiredMs) {
    return { ok: false, error: `BUDGET_EXHAUSTED: remaining=${Math.round(remainingMs)}ms < required=${requiredMs}ms (${tierLabel}) — skipping dispatch`, terminal: false };
  }

  // Clamp timeout to remaining budget minus write buffer
  const timeoutMs = Math.min(tierTimeout, remainingMs - STATUS_WRITE_BUFFER_MS);
  const url = `${supabaseUrl}/functions/v1/${edgeFn}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Normalize camelCase→snake_case payload keys (safety net for orphan_reconciler compat)
    const rawPayload = job.payload ?? {};
    const normalizedPayload = { ...rawPayload };
    // Inject top-level job columns into payload if missing (materialization gap fix)
    if (job.package_id && !normalizedPayload.package_id) normalizedPayload.package_id = job.package_id;
    if (rawPayload.packageId && !normalizedPayload.package_id) normalizedPayload.package_id = rawPayload.packageId;
    if (rawPayload.courseId && !rawPayload.course_id) normalizedPayload.course_id = rawPayload.courseId;
    if (rawPayload.curriculumId && !rawPayload.curriculum_id) normalizedPayload.curriculum_id = rawPayload.curriculumId;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        ...normalizedPayload,
        attempts: job.attempts ?? 0,
        attempt_index: (job.meta?.transient_attempts ?? job.attempts ?? 0),
        max_attempts: job.max_attempts ?? 8,
        job_id: job.id,
        _meta_attempt_index: (job.meta?.transient_attempts ?? job.attempts ?? 0),
        _job_hash: hashJobId(job.id),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      
      // ── HTTP 409 RETRY GUARD ──
      // Edge functions return HTTP 409 with { retry: true } when prerequisites
      // are not met (e.g. PREREQ_NOT_DONE). Treat as validator retry to avoid
      // burning attempts and creating retry storms.
      if (res.status === 409) {
        try {
          const body409 = JSON.parse(text);
          if (body409?.retry === true) {
            return { ok: true, result: { ...body409, ok: false, retry: true, backoff_seconds: 120 } };
          }
        } catch { /* not JSON, fall through to normal error */ }
      }
      
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json().catch(() => ({}));
    const dispatchMs = Date.now() - (loopDeadlineMs ? loopDeadlineMs - remainingMs : Date.now());
    // Runtime warning for Light jobs that exceed 8s — may be mis-classified
    if (tierLabel === "T4_LIGHT" && (Date.now() - (loopDeadlineMs! - remainingMs)) > 8_000) {
      console.warn(`[runner] ⚠️ LIGHT_JOB_SLOW: ${job.job_type} took >${8}s — consider reclassification`);
    }
    return { ok: true, result: data };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted")) {
      return { ok: false, error: `TIMEOUT: edge function exceeded ${Math.round(timeoutMs / 1000)}s` };
    }
    return { ok: false, error: msg };
  }
}

// ── Intent-aware workload key mapping (used by health gate + cooldown) ──
const WORKLOAD_KEY_MAP: Record<string, string> = {
  package_generate_learning_content: "learning_content",
  lesson_generate_content: "learning_content",
  lesson_generate_content_shard: "learning_content",
  package_generate_handbook: "handbook",
  package_generate_exam_pool: "exam_pool",
  package_generate_oral_exam: "oral_exam",
  package_generate_lesson_minichecks: "minichecks",
  package_generate_glossary: "glossary",
  lesson_generate_competency_bundle: "competency_bundle",
  mass_enrich_competencies_v2: "enrichment",
  pool_fill_lf_gaps: "enrichment",
  pool_fill_bloom_gaps: "enrichment",
};

function workloadKeyForJob(jobType: string): string {
  return WORKLOAD_KEY_MAP[jobType] ?? "learning_content";
}

// ═══════════════════════════════════════════════════════════════
// Job Liveness Guard helpers
// ═══════════════════════════════════════════════════════════════

// Track consecutive heartbeat failures per job to detect RPC instability
const heartbeatFailures = new Map<string, number>();

async function heartbeatJob(
  sb: any,
  jobId: string,
  provider?: string | null,
  model?: string | null,
  extra: Record<string, unknown> = {},
) {
  try {
    await sb.rpc("heartbeat_job_processing", {
      p_job_id: jobId,
      p_worker_id: WORKER_ID,
      p_provider: provider ?? null,
      p_model: model ?? null,
      p_meta: {
        ...extra,
        consecutive_heartbeat_failures: heartbeatFailures.get(jobId) ?? 0,
      },
    });
    // Reset on success
    heartbeatFailures.delete(jobId);
  } catch (e) {
    const prev = heartbeatFailures.get(jobId) ?? 0;
    const next = prev + 1;
    heartbeatFailures.set(jobId, next);
    console.warn(`[content-runner] heartbeat failed for ${String(jobId).slice(0, 8)} (consecutive: ${next}): ${(e as Error).message}`);
    // After 3 consecutive failures, use merge_job_meta RPC to patch meta
    // without overwriting existing keys, and update updated_at as fallback
    if (next >= 3) {
      try {
        await sb.rpc("merge_job_meta", {
          p_job_id: jobId,
          p_patch: {
            heartbeat_rpc_failures: next,
            heartbeat_fallback_at: new Date().toISOString(),
          },
        });
      } catch { /* last resort fallback */ }
    }
  }
}

function incrementSameProviderTransient(job: any, provider?: string | null, model?: string | null): number {
  const meta = (job.meta || {}) as Record<string, any>;
  const prevProvider = meta.last_provider || null;
  const prevModel = meta.last_model || null;
  const prevCount = Number(meta.same_provider_transient_attempts || 0) || 0;
  const sameRoute = prevProvider === (provider ?? null) && prevModel === (model ?? null);
  return sameRoute ? prevCount + 1 : 1;
}

function resetProviderTransientMeta(job: any, provider?: string | null, model?: string | null): Record<string, unknown> {
  return {
    ...(job.meta || {}),
    same_provider_transient_attempts: 0,
    last_provider: provider ?? null,
    last_model: model ?? null,
    last_success_at: new Date().toISOString(),
    liveness_status: "healthy",
  };
}

// ═══════════════════════════════════════════════════════════════
// processOneJob — with heartbeat ticker + provider-loop guard
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function processOneJob(job: any, sb: any, supabaseUrl: string, serviceKey: string, loopDeadlineMs?: number): Promise<any> {
  const shortId = String(job.id).slice(0, 8);
  const startMs = Date.now();

  // Resolve provider route for heartbeat tracking
  let jobProvider: string | null = null;
  let jobModel: string | null = null;
  try {
    const route = await resolveAvailableRoute(workloadKeyForJob(job.job_type));
    jobProvider = route?.provider ?? job.meta?.last_provider ?? "unknown";
    jobModel = route?.model ?? job.meta?.last_model ?? "unknown";
  } catch {
    jobProvider = job.meta?.last_provider ?? "unknown";
    jobModel = job.meta?.last_model ?? "unknown";
  }

  // Initial heartbeat
  await heartbeatJob(sb, job.id, jobProvider, jobModel, {
    liveness_status: "healthy",
    processing_started_by: WORKER_ID,
  });

  // Periodic heartbeat ticker (every 20s)
  const hbInterval = setInterval(() => {
    heartbeatJob(sb, job.id, jobProvider, jobModel, {
      processing_tick_at: new Date().toISOString(),
    });
  }, 20_000);

  try {
    const { ok, result, error: dispatchError, terminal } = await dispatchJob(job, supabaseUrl, serviceKey, loopDeadlineMs);

    if (ok) {
      // ── SKIP GUARD (Branch 4b) ──
      // If the function returned ok:true + skipped:true, it was intentionally
      // skipped (e.g. glossary without beruf_id). Mark completed WITHOUT
      // running the materialization guard — no artifact was expected.
      const isSkipped = result && typeof result === "object"
        && result.skipped === true;

      if (isSkipped) {
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
            skipped: true,
            skip_reason: result.reason || "unknown",
            skipped_at: now,
          },
        }).eq("id", job.id);
        console.log(`[content-runner] ⏭️ ${job.job_type} (${shortId}) → SKIPPED (reason=${result.reason || "?"})`);
        return { id: job.id, ok: true, skipped: true };
      }

      // ── BATCH MODE GUARD ──
      // If the job returned batch_mode=true with batch_complete=false,
      // it was enqueued for async batch processing. Don't mark as completed
      // or treat as zero-progress — park it as batch_pending.
      const isBatchEnqueued = result && typeof result === "object"
        && result.batch_mode === true
        && result.batch_complete === false;

      if (isBatchEnqueued) {
        const now = new Date().toISOString();
        await sb.from("job_queue").update({
          status: "batch_pending",
          updated_at: now,
          locked_at: null,
          locked_by: null,
          meta: {
            ...(job.meta || {}),
            batch_id: result.batch_id,
            batch_mode: true,
            batch_enqueued_at: now,
          },
        }).eq("id", job.id);
        console.log(`[content-runner] 📦 ${job.job_type} (${shortId}) → batch_pending (batch=${result.batch_id})`);
        return { id: job.id, ok: true, batch_pending: true };
      }

      // ── VALIDATOR PERMANENT FAIL GUARD ──
      // Validators return HTTP 200 with { ok: false, permanent: true } for
      // fachliche gate failures (e.g. GATE_FAIL: coverage=91%). These must NOT
      // be treated as transient/empty results — they are permanent failures that
      // should immediately fail the job and update the step to 'failed'.
      const isValidatorPermanentFail = result && typeof result === "object"
        && result.ok === false && result.permanent === true;

      if (isValidatorPermanentFail) {
        const now = new Date().toISOString();
        const errorMsg = (result.error || "VALIDATOR_PERMANENT_FAIL").slice(0, 2000);
        await sb.from("job_queue").update({
          status: "failed",
          last_error: errorMsg,
          completed_at: now,
          updated_at: now,
          locked_at: null,
          locked_by: null,
          meta: {
            ...(job.meta || {}),
            last_error_kind: "permanent",
            last_error_class: "permanent",
            last_error_reason: result.reason_code || result.classification || "gate_fail",
            gate_classification: result.classification,
            gate_reason_code: result.reason_code,
            gate_coverage_state: result.coverage_state,
          },
        }).eq("id", job.id);

        // Also update the step to 'failed' to prevent stuck-scan from re-enqueueing
        const packageId = job.payload?.package_id;
        const stepKey = job.job_type?.replace(/^package_/, "");
        if (packageId && stepKey) {
          try {
            await sb.from("package_steps").update({
              status: "failed",
              last_error: errorMsg,
              started_at: now,
              updated_at: now,
            }).eq("package_id", packageId).eq("step_key", stepKey);
          } catch (_stepErr) {
            console.warn(`[content-runner] Could not sync step ${stepKey} to failed: ${(_stepErr as Error)?.message}`);
          }
        }

        console.warn(`[content-runner] 🚫 ${job.job_type} (${shortId}) VALIDATOR PERMANENT FAIL: ${errorMsg.slice(0, 200)}`);
        return { id: job.id, ok: false, error: errorMsg, terminal: true };
      }

      // ── VALIDATOR RETRY GUARD (ATTEMPT-SAFE) ──
      // Validators may return { ok: false, retry: true } for prereq-not-ready.
      // Use DB-level RPC to return to pending WITHOUT burning attempts.
      const isValidatorRetry = result && typeof result === "object"
        && result.ok === false && result.retry === true && !result.permanent;

      if (isValidatorRetry) {
        const backoff = result.backoff_seconds || 120;
        const errorMsg = (result.error || "VALIDATOR_RETRY").slice(0, 2000);
        // Use attempt-safe RPC — does NOT increment attempts
        await sb.rpc("fn_return_job_to_pending_no_burn", {
          p_job_id: job.id,
          p_backoff_seconds: backoff,
          p_reason: errorMsg,
        });
        console.warn(`[content-runner] 🔄 ${job.job_type} (${shortId}) VALIDATOR RETRY (no-burn) — backoff ${backoff}s: ${errorMsg.slice(0, 150)}`);
        return { id: job.id, ok: false, error: errorMsg, retry: true };
      }

      // ── ZERO-PROGRESS GUARD ──
      // A job that returns ok=true but batch_complete=false with 0 sections written
      // is NOT a real success — it must be treated as transient to allow retry.
      const isZeroProgressBatch = result && typeof result === "object"
        && result.batch_complete === false
        && (result.sections_this_batch === 0 || result.generated === 0)
        && result.remaining !== undefined && result.remaining > 0;

      const hasRealResult = !isZeroProgressBatch && result && typeof result === "object" && (
        (result.generated !== undefined && result.generated > 0) ||
        result.batch_complete === true ||
        result.ok === true
      );
      const isTransient = result?.transient === true;

      if (isTransient || !hasRealResult) {
        const now = new Date().toISOString();
        const prevTransient = (job.meta?.transient_attempts ?? 0);
        const transientNext = prevTransient + 1;
        const TRANSIENT_MAX = 25;
        const TRANSIENT_TIMEOUT_MS = 45 * 60 * 1000;

        const firstTransientAtRaw = job.meta?.first_transient_at;
        const wasLivenessKilled2 = !!job.meta?.liveness_requeued || !!job.meta?.liveness_killed_at;
        const firstTransientAt =
          (typeof firstTransientAtRaw === "string" && !Number.isNaN(Date.parse(firstTransientAtRaw)) && !wasLivenessKilled2)
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
        // Real success — verify artifact materialization before completing
        const now = new Date().toISOString();
        const successProvider = result?.used_provider || result?.provider || jobProvider || null;
        const successModel = result?.used_model || result?.model || jobModel || null;

        // ── MATERIALIZATION GUARD ──
        const { verifyArtifact, buildVerifyAuditMeta } = await import("../_shared/artifact-verifier.ts");
        const artifactCheck = await verifyArtifact(sb, job);
        const auditMeta = buildVerifyAuditMeta(artifactCheck);
        
        if (!artifactCheck.ok) {
          const matRetries = ((job.meta as any)?.materialization_retries ?? 0) + 1;
          console.warn(`[content-runner] MATERIALIZATION_GUARD: ${job.job_type} (${shortId}) blocked — ${artifactCheck.reason} (retry ${matRetries}/3)`);
          
          if (artifactCheck.permanent || matRetries >= 3) {
            await sb.from("job_queue").update({
              status: "failed",
              last_error: `MATERIALIZATION_GUARD: ${artifactCheck.reason}${matRetries >= 3 ? " — exhausted" : ""}`,
              completed_at: now,
              updated_at: now,
              locked_at: null,
              locked_by: null,
              meta: { ...(job.meta || {}), ...auditMeta, materialization_retries: matRetries },
            }).eq("id", job.id);
            return { id: job.id, ok: false, error: `MATERIALIZATION_GUARD: ${artifactCheck.reason}` };
          }
          
          // Requeue with backoff
          await sb.from("job_queue").update({
            status: "pending",
            run_after: new Date(Date.now() + 90_000).toISOString(),
            last_error: `MATERIALIZATION_GUARD: ${artifactCheck.reason} — retry ${matRetries}/3`,
            updated_at: now,
            locked_at: null,
            locked_by: null,
            meta: { ...(job.meta || {}), ...auditMeta, materialization_retries: matRetries },
          }).eq("id", job.id);
          return { id: job.id, ok: false, error: `MATERIALIZATION_GUARD: ${artifactCheck.reason}`, retry: true };
        }

        await sb.from("job_queue").update({
          status: "completed",
          result: result ?? {},
          completed_at: now,
          updated_at: now,
          locked_at: null,
          locked_by: null,
          last_error: null,
          last_heartbeat_at: now,
          liveness_status: "healthy",
          meta: { ...resetProviderTransientMeta(job, successProvider, successModel), ...auditMeta },
        }).eq("id", job.id);

        // ── GHOST-COMPLETION FIX: Propagate ok/batch_complete to package_steps.meta ──
        // Without this, the pipeline-runner's finalization rules never see ok=true
        // and steps stay in queued/running forever despite completed jobs.
        const resultOk = result && typeof result === "object" && result.ok === true;
        const resultBatchComplete = result && typeof result === "object" && result.batch_complete === true;
        if (resultOk || resultBatchComplete) {
          const packageId = job.payload?.package_id;
          // Reverse-lookup step_key from job_type (defensive: filter nulls)
          const JOB_TYPE_TO_STEP = Object.fromEntries(
            Object.entries(STEP_TO_JOB_TYPE)
              .filter(([, v]) => !!v)
              .map(([k, v]) => [v, k])
          );
          const stepKey = JOB_TYPE_TO_STEP[job.job_type];
          if (packageId && stepKey) {
            try {
              const metaPatch: Record<string, unknown> = {};
              if (resultOk) metaPatch.ok = true;
              if (resultBatchComplete) metaPatch.batch_complete = true;
              if (result.validation_passed != null) metaPatch.validation_passed = result.validation_passed;
              metaPatch.last_completed_job_id = job.id;
              metaPatch.last_completed_at = now;
              await sb.rpc("merge_package_step_meta", {
                p_package_id: packageId,
                p_step_key: stepKey,
                p_patch: metaPatch,
              });
              console.log(`[content-runner] 📋 Propagated ok=${resultOk} batch_complete=${resultBatchComplete} to package_steps.meta for ${stepKey} (${packageId.slice(0, 8)})`);
            } catch (metaErr) {
              console.warn(`[content-runner] ⚠️ Failed to propagate step meta for ${stepKey}: ${(metaErr as Error).message}`);
              // Non-blocking — job is already completed
            }
          }
        }

        // Signal provider success to circuit breaker
        recordProviderSuccess();

        console.log(`[content-runner] ✅ ${job.job_type} (${shortId}) completed in ${Date.now() - startMs}ms (gen=${result?.generated ?? "?"})`);
        return { id: job.id, ok: true, latency_ms: Date.now() - startMs };
      }
    } else if (terminal) {
      const now = new Date().toISOString();
      await sb.from("job_queue").update({
        status: "failed",
        last_error: sanitizeError(dispatchError || "terminal").slice(0, 2000),
        completed_at: now,
        updated_at: now,
        locked_at: null,
        locked_by: null,
      }).eq("id", job.id);
      console.error(`[content-runner] 🛑 TERMINAL ${job.job_type} (${shortId}): ${dispatchError}`);
      return { id: job.id, ok: false, error: dispatchError, terminal: true };
    } else {
      // ── BUDGET_EXHAUSTED FAST-RELEASE ──
      // Job was never dispatched — release immediately without attempt increment
      // v4.2: Uses central releaseJobToPending with built-in retry
      if (dispatchError?.startsWith("BUDGET_EXHAUSTED")) {
        await releaseJobToPending(sb, job.id, "RELEASE_BUDGET_EXHAUSTED", {
          deferMs: 5_000,
          detail: dispatchError.slice(0, 500),
        });
        // Log to telemetry table for monitoring (fire-and-forget)
        sb.from("ops_budget_exhausted_log").insert({
          job_type: job.job_type,
          package_id: job.payload?.package_id ?? null,
          runner: WORKER_ID,
          reason: dispatchError.slice(0, 500),
        }).then(() => {}).catch(() => {});
        console.warn(`[content-runner] ⏸️ ${job.job_type} (${shortId}) ${dispatchError.slice(0, 100)} — released without attempt increment`);
        return { id: job.id, ok: false, error: "budget_exhausted_released", terminal: false };
      }

      // Transient or permanent failure
      const errorStr = sanitizeError(dispatchError || "");

      // ── SELF-POISONING GUARD ──
      // "all_candidates_on_cooldown" is a ROUTER STATE, not a provider error.
      // Do NOT count it as transient, do NOT set new cooldowns, just requeue.
      if (errorStr.includes("all_candidates_on_cooldown")) {
        await releaseJobToPending(sb, job.id, "RELEASE_ROUTING_DEFERRED", {
          deferMs: 20_000,
          detail: "all_candidates_on_cooldown — requeued without attempt increment",
        });
        console.warn(`[content-runner] ⏸️ ROUTING_DEFERRED ${job.job_type} (${shortId}) — all candidates on cooldown, requeue in 20s (no attempt increment)`);
        return { id: job.id, ok: false, error: "routing_deferred", terminal: false };
      }

      const classification = classifyError(errorStr);
      const isTransientErr = classification.isTransient;
      const now = new Date().toISOString();
      const backoffSec = Math.max(15, inferBackoffSeconds(errorStr));

      if (classification.providerCooldownMs) {
        const attemptIdx = job.meta?.transient_attempts ?? job.attempts ?? 0;
        let jobProvider = "unknown";
        let jobModel = "unknown";
        try {
          const chainForCooldown = await getModelChainAsync(workloadKeyForJob(job.job_type));
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

      // Circuit breaker: detect permanent failures even in transient-classified errors
      // (e.g. "All providers failed: anthropic: credit balance too low")
      if (isPermanentProviderError(errorStr)) {
        const tripped = await recordPermanentProviderFailure(errorStr.slice(0, 200));
        if (tripped) {
          await releaseJobToPending(sb, job.id, "RELEASE_CIRCUIT_BREAKER", {
            deferMs: 10 * 60_000,
            detail: errorStr.slice(0, 200),
          });
          return { id: job.id, ok: false, error: "CIRCUIT_BREAKER_TRIPPED", terminal: true };
        }
      }

        if (isTransientErr) {
        const prevTransient = (job.meta?.transient_attempts ?? 0);
        const transientNext = prevTransient + 1;
        const TRANSIENT_MAX = 25;
        const TRANSIENT_TIMEOUT_MS = 45 * 60 * 1000;

        const firstTransientAtRaw = job.meta?.first_transient_at;
        const wasLivenessKilled = !!job.meta?.liveness_requeued || !!job.meta?.liveness_killed_at;
        const firstTransientAt =
          (typeof firstTransientAtRaw === "string" && !Number.isNaN(Date.parse(firstTransientAtRaw)) && !wasLivenessKilled)
            ? firstTransientAtRaw
            : now;
        const transientElapsedMs = Date.now() - new Date(firstTransientAt).getTime();
        const timedOut = transientElapsedMs > TRANSIENT_TIMEOUT_MS;
        const exhausted = transientNext >= TRANSIENT_MAX || timedOut;

        // ── PROVIDER LOOP GUARD (job-type-scoped) ──
        const sameProviderTransientAttempts = incrementSameProviderTransient(job, jobProvider, jobModel);
        // Job-type-specific thresholds: oral_exam gets more runway (8 vs 5)
        const loopThreshold = job.job_type === "package_generate_oral_exam" ? 8 : 5;
        const providerLoopExhausted = sameProviderTransientAttempts >= loopThreshold;

        const update: Record<string, unknown> = {
          last_error: providerLoopExhausted
            ? `PROVIDER_LOOP_GUARD: ${jobProvider}/${jobModel} transient x${sameProviderTransientAttempts} — reroute`
            : errorStr.slice(0, 2000),
          last_error_code: providerLoopExhausted ? "PROVIDER_LOOP_GUARD" : "TRANSIENT",
          updated_at: now,
          locked_at: null,
          locked_by: null,
          liveness_status: providerLoopExhausted ? "cooldown_exhausted" : "healthy",
          meta: {
            ...(job.meta || {}),
            transient_attempts: transientNext,
            attempt_index: transientNext,
            last_error_kind: "transient",
            last_error_class: "transient",
            last_error_reason: classification.reason,
            last_transient_at: now,
            first_transient_at: firstTransientAt,
            same_provider_transient_attempts: sameProviderTransientAttempts,
            last_provider: jobProvider,
            last_model: jobModel,
            ...(providerLoopExhausted ? {
              quarantined_provider: jobProvider,
              quarantined_model: jobModel,
              quarantined_until: new Date(Date.now() + 10 * 60_000).toISOString(),
            } : {}),
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
          const effectiveBackoff = providerLoopExhausted
            ? 120  // 2 min cooldown before reroute
            : classification.reason === "ops_empty_response"
              ? Math.max(15, Math.min(backoffSec, 30))
              : backoffSec;
          update.run_after = new Date(Date.now() + effectiveBackoff * 1000).toISOString();
        }

        // Set provider cooldown if loop exhausted — JOB-TYPE SCOPED
        if (providerLoopExhausted && jobProvider && jobProvider !== "unknown") {
          const workloadKey = workloadKeyForJob(job.job_type);
          // Cooldown duration: oral_exam gets shorter (3min vs 10min) to recover faster
          const cooldownMs = job.job_type === "package_generate_oral_exam" ? 3 * 60_000 : 10 * 60_000;
          setProviderCooldown({
            provider: jobProvider,
            model: jobModel ?? "unknown",
            ms: cooldownMs,
            reason: `PROVIDER_LOOP_GUARD: ${sameProviderTransientAttempts}x transient on same route`,
            jobType: workloadKey,
          });
          console.warn(`[content-runner] 🔒 PROVIDER_LOOP_GUARD: ${jobProvider}/${jobModel} [${workloadKey}] quarantined for ${Math.round(cooldownMs / 60_000)}min after ${sameProviderTransientAttempts}x transient`);
        }

        await sb.from("job_queue").update(update).eq("id", job.id);
        const logBackoff = providerLoopExhausted ? 120 : (classification.reason === "ops_empty_response"
          ? Math.max(15, Math.min(backoffSec, 30))
          : backoffSec);
        console.warn(`[content-runner] ⚡ ${job.job_type} (${shortId}) TRANSIENT [${classification.reason}] — backoff ${logBackoff}s [transient ${transientNext}/${TRANSIENT_MAX}]${providerLoopExhausted ? " [PROVIDER_LOOP_GUARD]" : ""}`);
        return { id: job.id, ok: false, error: errorStr, exhausted, transient: true, providerLoopExhausted };
      } else {
        // ── PERMANENT FAILURE — check for provider-level permanent errors ──
        const errorStr = dispatchError || "";

        // Circuit breaker: detect permanent provider failures (credits, auth)
        if (isPermanentProviderError(errorStr)) {
          const tripped = await recordPermanentProviderFailure(errorStr.slice(0, 200));
          if (tripped) {
            // Abort immediately — circuit breaker tripped
            const now2 = new Date().toISOString();
            await sb.from("job_queue").update({
              status: "pending",
              run_after: new Date(Date.now() + 10 * 60_000).toISOString(),
              locked_at: null,
              locked_by: null,
              updated_at: now2,
              last_error: `CIRCUIT_BREAKER: all providers permanently down — ${errorStr.slice(0, 200)}`,
            }).eq("id", job.id);
            return { id: job.id, ok: false, error: "CIRCUIT_BREAKER_TRIPPED", terminal: true };
          }
        }

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
  } finally {
    clearInterval(hbInterval);
    heartbeatFailures.delete(job.id);
  }
}

// ═══════════════════════════════════════════════════════════════
// Single pass: claim + stale-lock recovery + health gate + process
// ═══════════════════════════════════════════════════════════════

type PassResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  deferred: number;
};

// deno-lint-ignore no-explicit-any
async function runOnePass(sb: any, supabaseUrl: string, serviceKey: string, isFirstPass: boolean, loopDeadlineMs?: number): Promise<PassResult> {
  // ── Stale-lock recovery (only on first pass to avoid repeated scanning) ──
  if (isFirstPass) {
    const staleBefore = new Date(Date.now() - STALE_LOCK_RECOVERY_MS).toISOString();
    const { data: staleRows } = await sb
      .from("job_queue")
      .select("id, attempts, max_attempts")
      .eq("worker_pool", "default")
      .eq("status", "processing")
      .not("locked_by", "is", null)
      .lt("locked_at", staleBefore)
      .lt("updated_at", staleBefore)
      .limit(50);

    if (staleRows && staleRows.length > 0) {
      // ── Stale-lock recovery with attempt increment to prevent infinite cycling ──
      for (const row of staleRows) {
        const nextAttempts = (row.attempts ?? 0) + 1;
        const maxAttempts = row.max_attempts ?? 8;
        const exhausted = nextAttempts >= maxAttempts;
        await sb.from("job_queue").update({
          status: exhausted ? "failed" : "pending",
          run_after: exhausted ? null : new Date(Date.now() + Math.min(nextAttempts * 10_000, 120_000)).toISOString(),
          locked_at: null,
          locked_by: null,
          attempts: nextAttempts,
          updated_at: new Date().toISOString(),
          last_error: exhausted
            ? `STALE_LOCK_EXHAUSTED: ${nextAttempts}/${maxAttempts} attempts by ${WORKER_ID}`
            : `STALE_LOCK_RECOVERY: attempt ${nextAttempts}/${maxAttempts} by ${WORKER_ID}`,
        }).eq("id", row.id);
      }
      const staleIds = staleRows.map((r: { id: string }) => r.id);
      // Best-effort: update job meta with recovery info (no RPC dependency)
      for (const sid of staleIds) {
        try {
          const { data: existingJob } = await sb
            .from("job_queue")
            .select("meta")
            .eq("id", sid)
            .maybeSingle();
          const merged = {
            ...(existingJob?.meta ?? {}),
            recovered_by: WORKER_ID,
            recovered_at: new Date().toISOString(),
            reason: "stale_processing_lock",
          };
          await sb.from("job_queue").update({ meta: merged }).eq("id", sid);
        } catch (_e) { /* best-effort */ }
      }
      console.warn(`[content-runner] STALE_LOCK_RECOVERY: released ${staleIds.length} orphaned processing job(s)`);
    }
  }

  // ── PREBUILD PASS: deterministic queue-bypass ──
  // Before claiming queue jobs, try to advance deterministic steps directly via SQL RPCs.
  // Budget: max 5 packages, max 3 hops per package — shared with normal claiming.
  if (isFirstPass) {
    try {
      const prebuildSummary = await runPrebuildPass(sb, 5, 3);
      if (prebuildSummary.steps_advanced > 0) {
        console.log(`[content-runner] PREBUILD: advanced ${prebuildSummary.steps_advanced} step(s) across ${prebuildSummary.packages_checked} package(s)`);
      }
    } catch (e) {
      // Non-fatal: prebuild is an optimization, not a requirement
      console.warn(`[content-runner] PREBUILD error (non-fatal): ${(e as Error).message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LANE-AWARE CLAIMING (v4.3)
  // Instead of claiming globally then releasing excess per-lane,
  // we claim per-lane with lane-specific budgets.
  // This prevents the claim→release→reclaim loop.
  // ═══════════════════════════════════════════════════════════════
  const laneBudgets = allocateLaneBudgets(CLAIM_LIMIT);
  const laneMetrics: Record<RunnerLane, { claimed: number; dispatched: number; succeeded: number; failed: number; budget_exhausted: number }> = {
    control:    { claimed: 0, dispatched: 0, succeeded: 0, failed: 0, budget_exhausted: 0 },
    recovery:   { claimed: 0, dispatched: 0, succeeded: 0, failed: 0, budget_exhausted: 0 },
    generation: { claimed: 0, dispatched: 0, succeeded: 0, failed: 0, budget_exhausted: 0 },
  };

  // deno-lint-ignore no-explicit-any
  const allClaimedJobs: any[] = [];

  for (const lane of LANE_DISPATCH_ORDER) {
    const budget = laneBudgets[lane];
    if (budget <= 0) continue;

    // Check time budget before claiming this lane
    const remainingMs = loopDeadlineMs ? loopDeadlineMs - Date.now() : Infinity;
    if (remainingMs < STATUS_WRITE_BUFFER_MS * 2) {
      console.warn(`[content-runner] LANE_SKIP_PRE_CLAIM: ${lane} lane — only ${Math.round(remainingMs)}ms remaining, not claiming`);
      continue;
    }

    const laneJobTypes = jobTypesForLane(lane);
    // deno-lint-ignore no-explicit-any
    const { data: laneJobs, error: laneErr } = await (sb as any).rpc("claim_pending_jobs_by_types", {
      p_job_types: laneJobTypes,
      p_limit: budget,
      p_worker_id: WORKER_ID,
      p_worker_pool: "default",
    });

    if (laneErr) {
      console.error(`[content-runner] claim error for ${lane}: ${laneErr.message}`);
      continue;
    }

    const claimed = ((laneJobs ?? []) as any[]).slice(0, budget);
    laneMetrics[lane].claimed = claimed.length;
    allClaimedJobs.push(...claimed);

    if (claimed.length > 0) {
      console.log(`[content-runner] LANE_CLAIM[${lane}]: claimed ${claimed.length}/${budget} job(s)`);
    }
  }

  // ── Also claim prebuild-pool jobs (lane-agnostic, small budget) ──
  const PREBUILD_MAX = 2;
  // deno-lint-ignore no-explicit-any
  const { data: prebuildJobs, error: prebuildErr } = await sb.rpc("claim_pending_jobs_v4" as any, {
    p_limit: PREBUILD_MAX,
    p_worker_id: WORKER_ID,
    p_worker_pool: "prebuild",
  });
  if (!prebuildErr && prebuildJobs && (prebuildJobs as any[]).length > 0) {
    console.log(`[content-runner] Also claimed ${(prebuildJobs as any[]).length} prebuild job(s)`);
    allClaimedJobs.push(...(prebuildJobs as any[]));
  }

  // deno-lint-ignore no-explicit-any
  let jobs: any[] = allClaimedJobs;

  if (jobs.length === 0) {
    return { claimed: 0, succeeded: 0, failed: 0, deferred: 0 };
  }

  console.log(`[content-runner] Claimed ${jobs.length} job(s) [lane-aware, worker=${WORKER_ID}] ctrl=${laneMetrics.control.claimed} recov=${laneMetrics.recovery.claimed} gen=${laneMetrics.generation.claimed}`);

  // ── Pool mismatch auto-fix (preserved from v4.2) ──
  for (const job of jobs) {
    const expectedPool = poolForJobType(job.job_type);
    if (job.worker_pool && job.worker_pool !== expectedPool) {
      console.warn(`[content-runner] POOL_AUTOFIX: ${job.job_type} (${String(job.id).slice(0, 8)}) had pool="${job.worker_pool}" → fixing to "${expectedPool}"`);
      await sb.from("job_queue").update({
        worker_pool: expectedPool,
        meta: { ...(job.meta || {}), pool_autofixed: true, old_pool: job.worker_pool },
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      job.worker_pool = expectedPool;
    }
  }

  // ── Finish-Line Guard: enforce jobtype_limits ──
  {
    const { data: limits } = await sb.from("jobtype_limits").select("job_type, max_processing");
    if (limits && limits.length > 0) {
      const limitMap = new Map(limits.map((l: any) => [l.job_type, l.max_processing as number]));
      const typesInBatch = [...new Set(jobs.map((j: any) => j.job_type))];
      const deferredIds: string[] = [];
      
      for (const jt of typesInBatch) {
        const cap = limitMap.get(jt);
        if (cap == null) continue;
        const { count: totalProcessing } = await sb
          .from("job_queue")
          .select("id", { count: "exact", head: true })
          .eq("job_type", jt)
          .eq("status", "processing");
        
        const global = totalProcessing ?? 0;
        const batchJobs = jobs.filter((j: any) => j.job_type === jt);
        const overLimit = global - cap;
        
        if (overLimit > 0) {
          const toRelease = Math.min(overLimit, batchJobs.length);
          const excess = batchJobs.slice(0, toRelease);
          for (const ej of excess) {
            deferredIds.push(ej.id);
          }
          console.warn(`[content-runner] FINISH_LINE_GUARD: ${jt} at ${global}/${cap} globally → releasing ${toRelease} of ${batchJobs.length} from this batch`);
        }
      }
      
      if (deferredIds.length > 0) {
        for (const defId of deferredIds) {
          const defJob = jobs.find((j: any) => j.id === defId);
          const existingMeta = (defJob?.meta || {}) as Record<string, unknown>;
          await sb.from("job_queue").update({
            status: "pending",
            locked_at: null,
            locked_by: null,
            completed_at: null,
            updated_at: new Date().toISOString(),
            meta: {
              ...existingMeta,
              deferred_by: WORKER_ID,
              deferred_reason: "jobtype_limit_exceeded",
              deferred_at: new Date().toISOString(),
              last_success_at: null,
              liveness_status: "deferred",
            },
          }).eq("id", defId);
        }
        
        jobs = jobs.filter((j: any) => !deferredIds.includes(j.id));
        console.log(`[content-runner] FINISH_LINE_GUARD: released ${deferredIds.length} excess job(s) back to pending`);
      }
    }
  }

  // ── Cleanup expired cooldowns ──
  if (isFirstPass) {
    try {
      const cleaned = await cleanupExpiredCooldowns();
      if (cleaned > 0) console.log(`[content-runner] Cleaned ${cleaned} expired provider cooldown(s)`);
    } catch { /* best-effort */ }
  }

  // ── Intent-aware Provider Health Gate ──
  const jobsByWorkload = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const wk = workloadKeyForJob(job.job_type);
    if (!jobsByWorkload.has(wk)) jobsByWorkload.set(wk, []);
    jobsByWorkload.get(wk)!.push(job);
  }

  const healthyJobs: typeof jobs = [];
  let totalDeferred = 0;

  const LAST_RESORT_MAX_PER_WORKLOAD = 2;

  for (const [workloadKey, wkJobs] of jobsByWorkload) {
    const route = await resolveAvailableRoute(workloadKey);
    if (!route?.ok) {
      const fallbackRoute = workloadKey !== "learning_content"
        ? await resolveAvailableRoute("learning_content")
        : null;

      if (fallbackRoute?.ok) {
        console.log(`[content-runner] ROUTE_FALLBACK: ${workloadKey} unhealthy, using learning_content route for ${wkJobs.length} job(s)`);
        healthyJobs.push(...wkJobs);
        continue;
      }

      const lastResort = await resolveLastResortRoute(workloadKey);
      if (lastResort?.ok) {
        const forceThrough = wkJobs.slice(0, LAST_RESORT_MAX_PER_WORKLOAD);
        const deferred = wkJobs.slice(LAST_RESORT_MAX_PER_WORKLOAD);

        console.warn(
          `[content-runner] LAST_RESORT: forcing ${forceThrough.length}/${wkJobs.length} ${workloadKey} job(s) through ` +
          `${lastResort.provider}/${lastResort.model} despite cooldown`
        );
        healthyJobs.push(...forceThrough);

        if (deferred.length > 0) {
          for (const job of deferred) {
            await releaseJobToPending(sb, job.id, "RELEASE_HEALTH_GATE", {
              deferMs: 15_000,
              detail: `${workloadKey} on cooldown, deferred (last-resort active for ${forceThrough.length} jobs) by ${WORKER_ID}`,
            });
          }
          totalDeferred += deferred.length;
        }
        continue;
      }

      console.warn(
        `[content-runner] HEALTH_GATE: no healthy route for ${workloadKey} — deferring ${wkJobs.length} job(s) by 10s`,
      );
      for (const job of wkJobs) {
        await releaseJobToPending(sb, job.id, "RELEASE_HEALTH_GATE", {
          deferMs: 10_000,
          detail: `${workloadKey} on cooldown, full-defer by ${WORKER_ID}`,
        });
      }
      totalDeferred += wkJobs.length;
    } else {
      console.log(`[content-runner] ROUTE: ${workloadKey} → ${route.provider}/${route.model} for ${wkJobs.length} job(s)`);
      healthyJobs.push(...wkJobs);
    }
  }

  jobs = healthyJobs;

  if (jobs.length === 0) {
    return { claimed: totalDeferred, succeeded: 0, failed: 0, deferred: totalDeferred };
  }

  // ═══════════════════════════════════════════════════════════════
  // DISPATCH: Process all claimed jobs (already lane-scoped by claiming)
  // No more lane-level release needed — jobs were claimed per-lane.
  // ═══════════════════════════════════════════════════════════════

  // deno-lint-ignore no-explicit-any
  const results: any[] = [];

  // Dispatch in lane order for priority, but no excess release needed
  const lanes = partitionByLane(jobs as { job_type: string; id: string }[]);

  for (const lane of LANE_DISPATCH_ORDER) {
    const laneJobs = lanes[lane];
    if (laneJobs.length === 0) continue;

    // Budget check: is there enough time left?
    const remainingMs = loopDeadlineMs ? loopDeadlineMs - Date.now() : Infinity;
    if (remainingMs < STATUS_WRITE_BUFFER_MS * 2) {
      console.warn(`[content-runner] LANE_BUDGET_STOP: skipping ${lane} lane — only ${Math.round(remainingMs)}ms remaining`);
      for (const job of laneJobs) {
        await releaseJobToPending(sb, (job as any).id, "RELEASE_LANE_BUDGET_STOP", {
          deferMs: 3_000,
          detail: `${lane} lane skipped — insufficient time`,
        });
        laneMetrics[lane].budget_exhausted++;
      }
      continue;
    }

    // v6.0: Sort jobs within lane — light jobs first to maximize completions per loop.
    // Heavy jobs last: if budget runs out, light jobs already completed.
    const tierRank = (jt: string): number => {
      if (LIGHT_JOB_TYPES.has(jt)) return 0;
      if (GENERATION_JOB_TYPES.has(jt) || HEAVY_EXPANDED_JOB_TYPES.has(jt)) return 2;
      return 1; // T3_DEFAULT
    };
    laneJobs.sort((a: any, b: any) => tierRank(a.job_type) - tierRank(b.job_type));

    // Dispatch lane jobs in parallel
    const settled = await Promise.allSettled(
      laneJobs.map((job: any) => processOneJob(job, sb, supabaseUrl, serviceKey, loopDeadlineMs))
    );

    for (const s of settled) {
      if (s.status === "fulfilled") {
        results.push(s.value);
        laneMetrics[lane].dispatched++;
        const isBudgetExhausted = s.value?.error?.includes("budget_exhausted");
        if (isBudgetExhausted) {
          // BUDGET_EXHAUSTED = job was never dispatched, not a real failure
          // Must NOT count toward circuit-breaker fail rate
          laneMetrics[lane].budget_exhausted++;
        } else if (s.value?.ok) {
          laneMetrics[lane].succeeded++;
        } else {
          laneMetrics[lane].failed++;
        }
      } else {
        results.push({ ok: false, error: s.reason?.message ?? String(s.reason) });
        laneMetrics[lane].dispatched++;
        laneMetrics[lane].failed++;
      }
    }

    console.log(
      `[content-runner] LANE[${lane}]: dispatched=${laneMetrics[lane].dispatched} ` +
      `ok=${laneMetrics[lane].succeeded} fail=${laneMetrics[lane].failed} ` +
      `budget_exhausted=${laneMetrics[lane].budget_exhausted}`
    );
  }

  const budgetExhaustedCount = results.filter(r => !r.ok && r.error?.includes("budget_exhausted")).length;
  const succeeded = results.filter(r => r.ok).length;
  // CRITICAL: budget_exhausted jobs were never dispatched — exclude from failed count
  // so they don't inflate the circuit-breaker fail rate and starve the pipeline
  const failed = results.filter(r => !r.ok).length - budgetExhaustedCount;

  console.log(
    `[content-runner] pass: ${succeeded}/${jobs.length} succeeded, ${failed} failed, ${budgetExhaustedCount} budget_exhausted | ` +
    `lanes: C=${laneMetrics.control.succeeded}/${laneMetrics.control.dispatched} ` +
    `R=${laneMetrics.recovery.succeeded}/${laneMetrics.recovery.dispatched} ` +
    `G=${laneMetrics.generation.succeeded}/${laneMetrics.generation.dispatched}`
  );
  return { claimed: jobs.length, succeeded, failed, deferred: 0 };
}

// ═══════════════════════════════════════════════════════════════
// Main handler — Pull Loop
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);
  bootstrapLLMLogging(sb, "content_runner");

  const startedAt = Date.now();
  const deadline = startedAt + LOOP_MAX_MS;

  // ═══ BOOT GUARD: Pool-SSOT Alignment ═══════════════════════
  // Hard-fail if the pools this runner claims don't exist in DB SSOT.
  // Prevents the silent "Claimed 0" standstill that went undetected for weeks.
  const RUNNER_CLAIM_POOLS = ["default", "prebuild"];
  try {
    const { data: dbPools, error: poolErr } = await sb
      .from("job_type_policies")
      .select("worker_pool")
      .limit(500);

    if (!poolErr && dbPools) {
      const knownPools = new Set((dbPools as any[]).map((r: any) => r.worker_pool));
      const orphanPools = RUNNER_CLAIM_POOLS.filter(p => !knownPools.has(p));
      if (orphanPools.length > 0) {
        const msg = `BOOT_GUARD_POOL_MISMATCH: Runner claims pools [${orphanPools.join(", ")}] but DB SSOT only has [${[...knownPools].join(", ")}]. Aborting to prevent silent standstill.`;
        console.error(`[content-runner] 🔴 ${msg}`);
        return json({ ok: false, error: "BOOT_GUARD_POOL_MISMATCH", orphan_pools: orphanPools, db_pools: [...knownPools], message: msg }, 500);
      }
      console.log(`[content-runner] ✅ Boot pool guard passed: claiming [${RUNNER_CLAIM_POOLS.join(", ")}], DB has [${[...knownPools].join(", ")}]`);
    }
  } catch (e) {
    // Non-fatal: log but continue (don't block runner on transient DB errors)
    console.warn(`[content-runner] ⚠️ Boot pool guard skipped (DB error): ${(e as Error).message}`);
  }

  let passes = 0;
  let emptyPolls = 0;
  let totalClaimed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalDeferred = 0;

  // ── Circuit Breaker check before starting loop ──
  const cbStatus = await checkCircuitBreaker();
  if (cbStatus.paused) {
    console.warn(
      `[content-runner] 🔴 CIRCUIT_BREAKER: pipeline paused — ${cbStatus.reason} ` +
      `(${Math.round((cbStatus.remainingMs ?? 0) / 1000)}s remaining)`,
    );
    return json({
      ok: false,
      circuit_breaker: true,
      reason: cbStatus.reason,
      expires_at: cbStatus.expiresAt,
      remaining_ms: cbStatus.remainingMs,
    });
  }

  while (Date.now() < deadline) {
    passes++;

    const pass = await runOnePass(sb, supabaseUrl, serviceKey, passes === 1, deadline);

    totalClaimed += pass.claimed;
    totalSucceeded += pass.succeeded;
    totalFailed += pass.failed;
    totalDeferred += pass.deferred;

    // If all providers cooled, don't loop — exit and let next cron retry
    if (pass.deferred > 0) {
      break;
    }

    if (pass.claimed === 0) {
      emptyPolls++;
      console.log(`[content-runner] empty poll ${emptyPolls}/${MAX_EMPTY_POLLS} after pass=${passes}`);

      if (emptyPolls >= MAX_EMPTY_POLLS) break;

      const remaining = deadline - Date.now();
      if (remaining <= LOOP_SLEEP_MS) break;

      await sleep(LOOP_SLEEP_MS);
      continue;
    }

    emptyPolls = 0;

    // Circuit breaker: abort if fail rate too high
    const attempted = totalSucceeded + totalFailed;
    if (attempted >= 10) {
      const failRatePct = (totalFailed / attempted) * 100;
      if (failRatePct >= ABORT_FAIL_RATE_PERCENT) {
        console.warn(`[content-runner] aborting loop: fail rate ${failRatePct.toFixed(1)}% >= ${ABORT_FAIL_RATE_PERCENT}%`);
        break;
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= LOOP_SLEEP_MS) break;

    await sleep(LOOP_SLEEP_MS);
  }

  const runtimeMs = Date.now() - startedAt;

  console.log(
    `[content-runner] loop done: passes=${passes} runtime=${runtimeMs}ms claimed=${totalClaimed} succeeded=${totalSucceeded} failed=${totalFailed} deferred=${totalDeferred} emptyPolls=${emptyPolls}`,
  );

  return json({
    ok: true,
    mode: "pull_loop",
    version: FUNCTION_VERSION,
    worker: WORKER_ID,
    passes,
    runtime_ms: runtimeMs,
    claimed: totalClaimed,
    succeeded: totalSucceeded,
    failed: totalFailed,
    deferred: totalDeferred,
    empty_polls: emptyPolls,
    concurrency: BASE_CONCURRENCY,
    loop_max_ms: LOOP_MAX_MS,
    loop_sleep_ms: LOOP_SLEEP_MS,
    lane_dispatch: "control→recovery→generation",
  });
});
