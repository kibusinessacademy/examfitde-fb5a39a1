import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { PIPELINE_GRAPH, validatePipelineGraph, STEP_TO_JOB_TYPE, ARTIFACT_IMPACT, getArtifactPriorityBump, poolForJobType, JOB_DEFINITIONS } from "../_shared/job-map.ts";
import { checkArtifacts } from "../_shared/artifact-resolver.ts";
import { enqueueJob, allowedPackageStatusesForJobType } from "../_shared/enqueue.ts";
import { isRepairActionEligible } from "../_shared/repair-eligibility.ts";
import { verifyArtifact, buildVerifyAuditMeta } from "../_shared/artifact-verifier.ts";

/**
 * job-runner — Atomically claims pending jobs via claim_pending_jobs RPC
 * (FOR UPDATE SKIP LOCKED), dispatches to Edge Functions, writes back
 * completed / failed / pending+run_after (backoff).
 *
 * v5: Proper Lock Management — locked_at/locked_by set on claim, nulled on release
 *
 * SSOT Status values: pending | processing | completed | failed | cancelled
 * Requeue = pending + run_after (backoff), NOT custom status values.
 */

// ── JOB_TYPE_MAP: auto-generated from JOB_DEFINITIONS (SSOT) ──
// No manual map to drift. Every entry with edgeFunction becomes a mapping.
const JOB_TYPE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(JOB_DEFINITIONS)
    .filter(([, def]) => def.edgeFunction)
    .map(([jobType, def]) => [jobType, def.edgeFunction!])
);

// ── Boot-time integrity: log job types without edgeFunction (not dispatched) ──
{
  const noEdge = Object.entries(JOB_DEFINITIONS)
    .filter(([, d]) => !d.edgeFunction)
    .map(([t]) => t);
  if (noEdge.length) {
    console.warn(`[job-runner] INFO: ${noEdge.length} job types have no edgeFunction (not dispatched by runner): ${noEdge.join(", ")}`);
  }
}

// Functions that require x-rework-secret instead of Bearer auth
const REWORK_SECRET_FUNCTIONS = new Set([
  "pool-rework",
  "pool-rework-trap-retrofit",
]);

// ── Adaptive Concurrency Constants ──────────────────────────────────
const BASE_CONCURRENCY = 6;
const MIN_CONCURRENCY = 4;
const MAX_CONCURRENCY = 12;
// v5.3: Increased from 140s→180s to reduce "signal aborted" on heavy AI jobs
// (exam-pool generation with 58+ questions, learning content with glossary injection)
const JOB_TIMEOUT_MS = 180_000;
const WORKER_ID = `job-runner-${crypto.randomUUID().slice(0, 8)}`;

// Backoff delays (ms) for requeue scenarios
const BACKOFF_409_MS = 30_000;
const BACKOFF_429_MS = 60_000;

// ── Transient exhaustion governance ──────────────────────────────────
// Max transient retries before escalating to failed (prevents infinite loops)
const MAX_TRANSIENT_ATTEMPTS = 25;
const TRANSIENT_WINDOW_MS = 45 * 60_000; // 45 min window
const BACKOFF_BATCH_MS = 3_000;
const BACKOFF_PREREQ_MS = 20_000;

/** Exponential backoff with ±20% jitter for transient/hard failures.
 *  attempt 0→30s, 1→90s, 2→180s, 3→300s, 4→600s, 5+→900s (cap) */
function computeErrorBackoffMs(attempt: number): number {
  const table = [30_000, 90_000, 180_000, 300_000, 600_000, 900_000];
  const base = table[Math.min(attempt, table.length - 1)];
  const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20%
  return Math.round(base + jitter);
}

// ── Function versioning (for deployment forensics) ──────────────────
const FUNCTION_VERSION = "v5.9-phase3+6-hardened";
const DEPLOYED_AT = "2026-02-27T17:00:00Z";

// Adaptive thresholds (rolling 5-min window)
const THROTTLE_TIMEOUT_THRESHOLD = 10;
const THROTTLE_RATELIMIT_THRESHOLD = 8;
const STABLE_MINUTES_TO_RAMP = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

/** Release lock fields — MUST be included in every terminal/requeue update.
 *  Accepts a pre-generated timestamp to ensure consistency within a single job transition. */
function lockRelease(tsNow: string) {
  return {
    locked_at: null as string | null,
    locked_by: null as string | null,
    updated_at: tsNow,
  };
}

/** Requeue a job as pending with a run_after backoff */
async function requeueWithBackoff(
  sb: ReturnType<typeof createClient>,
  jobId: string,
  meta: Record<string, unknown> | null,
  delayMs: number,
  errorMsg: string,
  tsNow: string,
) {
  await sb.from("job_queue").update({
    status: "pending",
    run_after: new Date(Date.now() + delayMs).toISOString(),
    error: errorMsg,
    meta: { ...(meta || {}), last_retry: tsNow },
    ...lockRelease(tsNow),
  }).eq("id", jobId);
}

async function boostPendingPrereqJob(
  sb: ReturnType<typeof createClient>,
  opts: {
    packageId: string;
    prereqJobType: string;
    prereqStep: string;
    blockerJobType: string;
    tsNow: string;
  },
) {
  const { data } = await sb
    .from("job_queue")
    .select("id,status,priority,run_after,meta")
    .eq("job_type", opts.prereqJobType)
    .eq("package_id", opts.packageId)
    .in("status", ["pending", "queued", "processing"])
    .order("created_at", { ascending: true })
    .limit(5);

  const prereqJobs = (data ?? []) as Array<{
    id: string;
    status: string;
    priority: number | null;
    run_after: string | null;
    meta?: Record<string, unknown> | null;
  }>;

  const processingCount = prereqJobs.filter((row) => row.status === "processing").length;
  const waitingRows = prereqJobs.filter((row) => row.status === "pending" || row.status === "queued");

  if (processingCount > 0 || waitingRows.length === 0) {
    return { activeCount: prereqJobs.length, boosted: false };
  }

  const boostTarget = waitingRows[0];
  await sb.from("job_queue").update({
    status: "pending",
    priority: 0,
    run_after: null,
    completed_at: null,
    error: null,
    last_error: null,
    locked_at: null,
    locked_by: null,
    updated_at: opts.tsNow,
    meta: {
      ...(boostTarget.meta || {}),
      prereq_priority_boosted_at: opts.tsNow,
      prereq_priority_boosted_by: opts.blockerJobType,
      prereq_priority_boosted_for: opts.prereqStep,
    },
  }).eq("id", boostTarget.id).neq("status", "processing");

  console.warn(
    `[job-runner] PREREQ_PRIORITY_BOOST: ${opts.prereqJobType} (${String(boostTarget.id).slice(0, 8)}) → priority 0 ` +
    `because ${opts.blockerJobType} is blocked by ${opts.prereqStep} (pkg ${opts.packageId.slice(0, 8)})`,
  );

  return { activeCount: prereqJobs.length, boosted: true };
}

// ── Adaptive Concurrency Controller ─────────────────────────────────

interface TickMetrics {
  timeouts: number;
  rateLimits: number;
  escalations: number;
  dlqItems: number;
  completed: number;
  totalLatencyMs: number;
}

async function getAdaptiveConcurrency(
  sb: ReturnType<typeof createClient>,
): Promise<number> {
  const { data: lastSnapshot } = await sb.from("concurrency_snapshots")
    .select("active_concurrency, snapshot_at, action_taken")
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastSnapshot) return BASE_CONCURRENCY;

  const current = lastSnapshot.active_concurrency ?? BASE_CONCURRENCY;

  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

  const { count: recentTimeouts } = await sb.from("job_queue")
    .select("id", { count: "exact", head: true })
    .gte("updated_at", fiveMinAgo)
    .eq("status", "failed")
    .ilike("error", "%timeout%");

  const { count: recentRateLimits } = await sb.from("job_queue")
    .select("id", { count: "exact", head: true })
    .gte("updated_at", fiveMinAgo)
    .in("status", ["pending", "failed"])
    .or("error.ilike.%429%,error.ilike.%rate limit%,error.ilike.%Rate limit%");

  const timeouts = recentTimeouts ?? 0;
  const rateLimits = recentRateLimits ?? 0;

  if (timeouts >= THROTTLE_TIMEOUT_THRESHOLD || rateLimits >= THROTTLE_RATELIMIT_THRESHOLD) {
    const newConcurrency = Math.max(MIN_CONCURRENCY, current - 3);
    console.log(`[Adaptive] THROTTLE: timeouts=${timeouts} rateLimits=${rateLimits} → ${current}→${newConcurrency}`);
    return newConcurrency;
  }

  if (lastSnapshot.action_taken === "stable") {
    const tenMinAgo = new Date(Date.now() - STABLE_MINUTES_TO_RAMP * 60_000).toISOString();
    const { data: recentSnapshots } = await sb.from("concurrency_snapshots")
      .select("action_taken")
      .gte("snapshot_at", tenMinAgo)
      .order("snapshot_at", { ascending: false })
      .limit(10);

    const allStable = recentSnapshots?.every(s => s.action_taken === "stable") ?? false;
    if (allStable && current < MAX_CONCURRENCY) {
      const newConcurrency = Math.min(MAX_CONCURRENCY, current + 1);
      console.log(`[Adaptive] RAMP-UP: stable ${STABLE_MINUTES_TO_RAMP}min → ${current}→${newConcurrency}`);
      return newConcurrency;
    }
  }

  // Hard cap — DB snapshot may exceed MAX_CONCURRENCY from legacy data
  return Math.min(MAX_CONCURRENCY, current);
}

async function writeSnapshot(
  sb: ReturnType<typeof createClient>,
  metrics: TickMetrics,
  activeConcurrency: number,
  action: string,
) {
  const medianLatency = metrics.completed > 0
    ? Math.round(metrics.totalLatencyMs / metrics.completed)
    : null;

  try {
    await sb.from("concurrency_snapshots").insert({
      timeouts_5min: metrics.timeouts,
      rate_limits_5min: metrics.rateLimits,
      escalations_5min: metrics.escalations,
      dlq_count_5min: metrics.dlqItems,
      jobs_per_min: metrics.completed,
      median_latency_ms: medianLatency,
      active_concurrency: activeConcurrency,
      action_taken: action,
    });
  } catch (_e) { /* best-effort */ }
}

/** Write failed job to Dead-Letter Queue */
async function writeToDLQ(
  sb: ReturnType<typeof createClient>,
  job: any,
  errorType: string,
  errorMessage: string,
) {
  try {
    await sb.from("exam_pool_dlq").insert({
      blueprint_id: job.payload?.blueprint_id ?? null,
      job_id: job.id,
      package_id: job.payload?.package_id ?? null,
      provider: job.meta?.last_provider ?? null,
      model: job.meta?.last_model ?? null,
      error_type: errorType,
      error_message: errorMessage?.slice(0, 2000),
      attempt_count: job.attempts || 0,
      prompt_hash: job.meta?.prompt_hash ?? null,
      original_payload: job.payload ?? null,
    });
  } catch (e) {
    console.log(`[DLQ] Write failed: ${(e as Error)?.message}`);
  }
}

// ── Main Handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Schema-Version Handshake — block if DB is behind required migration
  try {
    await assertSchemaReady("job-runner", sb);
  } catch (e) {
    console.error("[job-runner] SCHEMA_DRIFT:", (e as Error).message);
    return json({ ok: false, error: (e as Error).message, blocked: "schema_drift" }, 503);
  }

  // ── 0. Adaptive Concurrency ──────────────────────────────────────
  const adaptiveConcurrency = await getAdaptiveConcurrency(sb).catch(() => BASE_CONCURRENCY);

  // ── 1. Claim jobs via canonical RPC contract ──
  let { data: jobs, error: claimErr } = await sb.rpc("claim_pending_jobs_v4" as any, {
    p_limit: adaptiveConcurrency,
    p_worker_id: WORKER_ID,
    p_worker_pool: "default",
  });
  jobs = (jobs ?? []) as any[];

  if (claimErr) {
    console.error("[job-runner] claim_pending_jobs_v4 error:", claimErr.message);
    return json({ ok: false, error: claimErr.message }, 500);
  }

  if (!jobs || jobs.length === 0) {
    return json({ ok: true, processed: 0, concurrency: adaptiveConcurrency, worker: WORKER_ID, message: "No pending jobs" });
  }

  // ── Defense-in-Depth: Auto-fix pool mismatch on claimed jobs ──
  for (const job of jobs) {
    const expectedPool = poolForJobType(job.job_type);
    if (job.worker_pool && job.worker_pool !== expectedPool) {
      console.warn(`[job-runner] POOL_AUTOFIX: ${job.job_type} (${String(job.id).slice(0,8)}) had pool="${job.worker_pool}" → fixing to "${expectedPool}"`);
      await sb.from("job_queue").update({
        worker_pool: expectedPool,
        meta: { ...(job.meta || {}), pool_autofixed: true, old_pool: job.worker_pool },
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      job.worker_pool = expectedPool;
    }
  }

  console.log(`[job-runner] Claimed ${jobs.length} job(s) [concurrency=${adaptiveConcurrency}, worker=${WORKER_ID}, version=${FUNCTION_VERSION}]`);

  const results: Record<string, unknown>[] = [];
  const tickMetrics: TickMetrics = {
    timeouts: 0, rateLimits: 0, escalations: 0, dlqItems: 0,
    completed: 0, totalLatencyMs: 0,
  };
  const packageStateCache = new Map<string, { status: string | null; published_at: string | null }>();

  // ── Pipeline prerequisite map ──────────────────────────────────────
  // Each entry lists prerequisite(s) in priority order.
  // The guard checks the FIRST prereq that actually exists as a step
  // in the package — this makes the chain track-aware so EXAM_FIRST
  // packages don't deadlock on missing handbook/learning steps.
  // PIPELINE_PREREQS must match PIPELINE_GRAPH (SSOT in job-map.ts).
  // Each entry lists candidate prereqs — the first one that exists in
  // the package's steps is used. This is track-aware: tracks that lack
  // certain steps fall through to the next candidate.
  // ⚠️ DO NOT add cross-branch dependencies here! Use PIPELINE_GRAPH.
  const PIPELINE_PREREQS: Record<string, string[]> = {
    // ── Early chain (safety net — pipeline-process is primary gate) ──
    package_generate_glossary: ["scaffold_learning_course"],
    package_generate_learning_content: ["scaffold_learning_course"],
    package_validate_learning_content: ["generate_learning_content"],
    package_auto_seed_exam_blueprints: ["validate_learning_content"],
    package_validate_blueprints: ["auto_seed_exam_blueprints"],
    // ── Exam branch ──
    package_generate_exam_pool: ["validate_blueprints"],
    package_validate_exam_pool: ["generate_exam_pool"],
    // ── Tutor branch (from validate_exam_pool) ──
    package_build_ai_tutor_index: ["validate_exam_pool"],
    package_validate_tutor_index: ["build_ai_tutor_index"],
    // ── Oral exam branch (from validate_tutor_index — needs tutor_index artifact) ──
    package_generate_oral_exam: ["validate_tutor_index"],
    package_validate_oral_exam: ["generate_oral_exam"],
    // ── MiniChecks branch (from validate_learning_content) ──
    package_generate_lesson_minichecks: ["validate_learning_content"],
    package_validate_lesson_minichecks: ["generate_lesson_minichecks"],
    // ── Elite harden branch (from validate_exam_pool) ──
    package_elite_harden: ["validate_exam_pool"],
    // ── Handbook branch (from validate_learning_content) ──
    package_generate_handbook: ["validate_learning_content"],
    package_validate_handbook: ["generate_handbook"],
    package_enqueue_handbook_expand: ["validate_handbook"],
    package_validate_handbook_depth: ["expand_handbook"],
    // ── Convergence: integrity check requires ALL 5 terminal branches ──
    package_run_integrity_check: ["elite_harden", "validate_lesson_minichecks", "validate_handbook_depth", "validate_oral_exam", "validate_tutor_index"],
    package_quality_council: ["run_integrity_check"],
    package_auto_publish: ["quality_council"],
  };

  const runnerStart = Date.now();
  const RUNNER_TIME_BUDGET_MS = 110_000; // 110s — leave 70s headroom before 180s Edge limit

  // ── v5.6 Package-Fair-Share (final) ──────────────────────────────────
  // Max 1 heavy LF-job per package per tick, max GLOBAL_HEAVY_LIMIT globally.
  // Root orchestrator jobs (no learning_field_filter) are treated as non-heavy
  // since they only fan-out and complete fast.
  const HEAVY_JOB_TYPES_ARR = ["package_generate_exam_pool", "package_generate_learning_content", "package_generate_handbook", "package_auto_seed_exam_blueprints", "package_elite_harden"];
  const HEAVY_JOB_TYPES = new Set(HEAVY_JOB_TYPES_ARR);
  const GLOBAL_HEAVY_LIMIT = 3;

  // Fix #6: Root orchestrator jobs (no learning_field_filter) bypass heavy gating
  const isHeavyLfJob = (j: any) =>
    HEAVY_JOB_TYPES.has(j.job_type) && !!j.payload?.learning_field_filter;

  const heavyJobs = jobs.filter(isHeavyLfJob);
  if (heavyJobs.length > 1) {
    // ── Concurrency guard: packages already processing heavy LF jobs get skipped ──
    const alreadyProcessing = new Set<string>();
    try {
      const { data: procRows } = await sb.rpc("heavy_processing_per_package", {
        p_heavy_types: HEAVY_JOB_TYPES_ARR,
      });
      if (procRows) {
        for (const r of procRows as any[]) {
          if (r.package_id && r.processing_count > 0) alreadyProcessing.add(r.package_id);
        }
      }
    } catch (e) {
      console.log(`[job-runner] heavy_processing_per_package RPC failed, skipping guard: ${(e as Error).message}`);
    }

    // ── Group by package_id, skip unknown and already-processing ──
    const byPackage = new Map<string, any[]>();
    for (const hj of heavyJobs) {
      const pkgId = hj.payload?.package_id;
      if (!pkgId) continue; // Fix #3: skip jobs without package_id
      if (alreadyProcessing.has(pkgId)) continue; // already has heavy processing
      if (!byPackage.has(pkgId)) byPackage.set(pkgId, []);
      byPackage.get(pkgId)!.push(hj);
    }

    // ── Batch LF question counts via RPC (single-pass across all packages) ──
    const currLfMap = new Map<string, Set<string>>();
    for (const [, pkgHeavy] of byPackage) {
      for (const hj of pkgHeavy) {
        const cid = hj.payload?.curriculum_id;
        const lf = hj.payload?.learning_field_filter;
        if (cid && lf) {
          if (!currLfMap.has(cid)) currLfMap.set(cid, new Set());
          currLfMap.get(cid)!.add(lf);
        }
      }
    }

    const qByLfGlobal = new Map<string, number>();
    const rpcPromises = [...currLfMap.entries()].map(async ([cid, lfSet]) => {
      try {
        const { data } = await sb.rpc("count_questions_by_lf", {
          p_curriculum_id: cid,
          p_lf_ids: [...lfSet],
        });
        if (data) {
          for (const row of data as any[]) {
            qByLfGlobal.set(row.learning_field_id, row.q_count);
          }
        }
      } catch (e) {
        console.log(`[job-runner] count_questions_by_lf failed for ${cid.slice(0,8)}: ${(e as Error).message}`);
      }
    });
    await Promise.all(rpcPromises);

    // ── Select 1 winner per package (0-question LFs first, then fewest, then oldest) ──
    const winners: any[] = [];
    for (const [pkgId, pkgHeavy] of byPackage) {
      pkgHeavy.sort((a: any, b: any) => {
        const aQ = qByLfGlobal.get(a.payload?.learning_field_filter) ?? 0;
        const bQ = qByLfGlobal.get(b.payload?.learning_field_filter) ?? 0;
        if (aQ === 0 && bQ !== 0) return -1;
        if (bQ === 0 && aQ !== 0) return 1;
        return aQ - bQ || new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      winners.push(pkgHeavy[0]);
      console.log(`[job-runner] FAIR_SHARE: pkg ${pkgId.slice(0,8)} → winner ${pkgHeavy[0].job_type}/${pkgHeavy[0].payload?.learning_field_filter?.slice(0,8) ?? '__root__'} (qCount=${qByLfGlobal.get(pkgHeavy[0].payload?.learning_field_filter) ?? 0})`);
    }

    // Global cap: oldest package wins
    winners.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const globalWinners = winners.slice(0, GLOBAL_HEAVY_LIMIT);
    const keepIds = new Set(globalWinners.map((w: any) => w.id));

    // Fix #3: Log capacity underuse + "all busy" explicitly
    console.log(`[job-runner] FAIR_SHARE: winners=${globalWinners.length}/${GLOBAL_HEAVY_LIMIT}, skippedBusyPkgs=${alreadyProcessing.size}, eligiblePkgs=${byPackage.size}`);
    if (globalWinners.length === 0 && byPackage.size > 0) {
      console.log(`[job-runner] FAIR_SHARE: all eligible packages already have heavy processing — dispatching 0 heavy this tick`);
    }

    // Fix #4: Release non-winners — only locked jobs we own AND status=processing (exact match)
    const releaseHeavy = heavyJobs.filter((j: any) => !keepIds.has(j.id));
    if (releaseHeavy.length > 0) {
      for (const rj of releaseHeavy) {
        const ts = new Date(Date.now() + 5_000).toISOString();
        await sb.from("job_queue").update({
          status: "pending",
          locked_at: null,
          locked_by: null,
          run_after: ts,
          updated_at: new Date().toISOString(),
        }).eq("id", rj.id).eq("locked_by", WORKER_ID).eq("status", "processing"); // exact: only processing jobs we own
      }
      console.log(`[job-runner] FAIR_SHARE: released ${releaseHeavy.length} non-winner heavy jobs`);
    }

    // Filter jobs list: keep non-heavy + root orchestrators + winners
    jobs = jobs.filter((j: any) => !isHeavyLfJob(j) || keepIds.has(j.id));
  }

  for (let jobIdx = 0; jobIdx < jobs.length; jobIdx++) {
    const job = jobs[jobIdx];

    // ── Ghost-lock guard: release remaining jobs if time is running out ──
    const elapsedRunner = Date.now() - runnerStart;
    if (elapsedRunner > RUNNER_TIME_BUDGET_MS) {
      const remainingJobs = jobs.slice(jobIdx);
      console.log(`[job-runner] TIME_GUARD: ${elapsedRunner}ms elapsed, releasing ${remainingJobs.length} remaining claimed jobs back to pending`);
      for (const rj of remainingJobs) {
        const ts = new Date(Date.now() + 5_000).toISOString();
        await sb.from("job_queue").update({
          status: "pending",
          locked_at: null,
          locked_by: null,
          scheduled_at: ts,
          run_after: ts,
          updated_at: new Date().toISOString(),
        }).eq("id", rj.id);
      }
      results.push(...remainingJobs.map(rj => ({ id: rj.id, status: "released", reason: "runner_time_guard" })));
      break;
    }

    // ── Generate ONE timestamp per job transition ──────────────────
    const tsNow = new Date().toISOString();

    let resolvedJobType = job.job_type;
    let fnName = JOB_TYPE_MAP[resolvedJobType];

    // ── AUTO-REMAP: unprefixed step_key → package_ prefixed job_type ──
    // Some DB triggers/RPCs enqueue jobs using step_key directly (e.g. "validate_exam_pool")
    // instead of the correct job_type ("package_validate_exam_pool"). Auto-fix this.
    if (!fnName && STEP_TO_JOB_TYPE[resolvedJobType as keyof typeof STEP_TO_JOB_TYPE]) {
      const remappedJobType = STEP_TO_JOB_TYPE[resolvedJobType as keyof typeof STEP_TO_JOB_TYPE];
      fnName = JOB_TYPE_MAP[remappedJobType];
      if (fnName) {
        console.warn(`[job-runner] ⚠️ AUTO-REMAP: "${resolvedJobType}" → "${remappedJobType}" (unprefixed step_key used as job_type)`);
        // Fix the job record so it won't happen again
        await sb.from("job_queue").update({ job_type: remappedJobType }).eq("id", job.id);
        resolvedJobType = remappedJobType;
      }
    }

    if (!fnName) {
      console.error(`[job-runner] ❌ Unknown job_type: ${job.job_type} — permanent hard-fail (add to JOB_TYPE_MAP + JOB_DEFINITIONS!)`);
      await sb.from("job_queue").update({
        status: "failed",
        error: `UNKNOWN_JOB_TYPE: ${job.job_type}. Add mapping to JOB_TYPE_MAP + JOB_DEFINITIONS.`,
        last_error: `UNKNOWN_JOB_TYPE: ${job.job_type}`,
        completed_at: tsNow,
        max_attempts: 1,
        meta: { ...(job.meta ?? {}), last_error_class: "permanent", error_kind: "unknown_job_type" },
        ...lockRelease(tsNow),
      }).eq("id", job.id);
      sb.from("admin_notifications").insert({
        title: "SSOT Drift: Unknown job_type in runner",
        body: `Job ${String(job.id).slice(0,8)} has unregistered type "${job.job_type}". Add it to JOB_TYPE_MAP + JOB_DEFINITIONS.`,
        category: "ops", severity: "error",
        entity_type: "job", entity_id: job.id,
        metadata: { job_type: job.job_type, error_class: "permanent" },
      }).then(() => {/* fire-and-forget */});
      results.push({ id: job.id, status: "failed", reason: "unknown_type_permanent" });
      continue;
    }

    // ── Package executability guard (hard invariant) ─────────────────
    const jobPackageId = (job.package_id ?? job.payload?.package_id) as string | undefined;
    if (jobPackageId) {
      let pkgState = packageStateCache.get(jobPackageId);
      if (!pkgState) {
        const { data: pkgRow } = await sb
          .from("course_packages")
          .select("status,published_at")
          .eq("id", jobPackageId)
          .maybeSingle();
        pkgState = {
          status: pkgRow?.status ?? null,
          published_at: pkgRow?.published_at ?? null,
        };
        packageStateCache.set(jobPackageId, pkgState);
      }

      // SSOT: keep runner executability aligned with shared enqueue/admin-op rules.
      // Preserve council_review for integrity recovery during council-loop remediation.
      const allowedStatuses = job.job_type === "package_run_integrity_check"
        ? new Set([...
          allowedPackageStatusesForJobType(job.job_type),
          "council_review",
        ])
        : allowedPackageStatusesForJobType(job.job_type);
      const notExecutable = !!pkgState.published_at || !allowedStatuses.has(pkgState.status ?? "");
      if (notExecutable) {
        const reason = `OPS_GUARD:PACKAGE_NOT_EXECUTABLE status=${pkgState.status ?? "missing"} published_at=${pkgState.published_at ? "set" : "null"}`;
        // Use "cancelled" — this is a deterministic block, not a failure.
        // Prevents noise in failure metrics and stops retry loops.
        await sb.from("job_queue").update({
          status: "cancelled",
          completed_at: tsNow,
          last_error: reason,
          meta: { ...(job.meta || {}), outcome: "blocked", blocked_reason: reason },
          ...lockRelease(tsNow),
        }).eq("id", job.id);
        results.push({ id: job.id, status: "cancelled", reason: "package_not_executable" });
        continue;
      }
    }

    // ── Auto-publish readiness gate ─────────────────────────────────────
    // Prevent noise: don't dispatch auto_publish until integrity_passed=true.
    // This eliminates premature 422/guard failures that inflate error metrics.
    // RECONCILIATION: Also checks integrity_report as fallback for write-race conditions.
    if (job.job_type === "package_auto_publish" && jobPackageId) {
      const REQUIRED_REPORT_VERSION_NUM = 15; // COURSE_READY_v1.5
      const { data: pubGate } = await sb
        .from("course_packages")
        .select("integrity_passed, integrity_report, integrity_report_version_num")
        .eq("id", jobPackageId)
        .maybeSingle();

      let integrityOk = !!pubGate?.integrity_passed;
      const reportVersionNum = Number((pubGate as any)?.integrity_report_version_num) || 0;

      // ── REPORT VERSION GUARD: reject stale/legacy integrity reports ──
      if (integrityOk && reportVersionNum < REQUIRED_REPORT_VERSION_NUM) {
        console.warn(`[job-runner] 🔄 STALE_REPORT_GUARD: integrity_report_version_num=${reportVersionNum} < ${REQUIRED_REPORT_VERSION_NUM} — forcing re-check (pkg ${jobPackageId.slice(0, 8)})`);
        // Only reset step if NOT currently running (prevent overwriting active integrity check)
        const { data: intStep } = await sb.from("package_steps")
          .select("status")
          .eq("package_id", jobPackageId)
          .eq("step_key", "run_integrity_check")
          .maybeSingle();
        const stepStatus = intStep?.status as string | undefined;
        if (stepStatus === "running" || stepStatus === "processing") {
          console.log(`[job-runner] STALE_REPORT_GUARD: integrity step already running — skipping reset (pkg ${jobPackageId.slice(0, 8)})`);
        } else {
          await sb.from("course_packages").update({ integrity_passed: false }).eq("id", jobPackageId);
          await sb.from("package_steps").update({ status: "queued" })
            .eq("package_id", jobPackageId)
            .eq("step_key", "run_integrity_check");
        }
        const gateReason = `STALE_REPORT: version_num=${reportVersionNum}, required=${REQUIRED_REPORT_VERSION_NUM}`;
        await requeueWithBackoff(sb, job.id, job.meta, 120_000, gateReason, tsNow);
        results.push({ id: job.id, status: "requeued", reason: "stale_integrity_report" });
        continue;
      }

      // Reconciliation: if integrity_passed=false but integrity_report confirms passing,
      // auto-heal the flag (race condition between integrity-check write and pipeline-process)
      if (!integrityOk && pubGate?.integrity_report) {
        const report = pubGate.integrity_report as Record<string, unknown>;
        const score = typeof report.score === "number" ? report.score : 0;
        const hardFails = (report as any)?.v3?.hard_fail_reasons ?? [];
        if (score >= 85 && Array.isArray(hardFails) && hardFails.length === 0 && reportVersionNum >= REQUIRED_REPORT_VERSION_NUM) {
          console.warn(`[job-runner] 🔧 RECONCILE: integrity_passed=false but report.score=${score}, hardFails=0, version=${reportVersionNum} — auto-fixing`);
          await sb.from("course_packages").update({ integrity_passed: true }).eq("id", jobPackageId);
          integrityOk = true;
        }
      }

      if (!integrityOk) {
        const { data: activeAutofix } = await sb
          .from("autofix_runs")
          .select("id, current_round, max_rounds, last_score, target_score, budget_eur, course_id, curriculum_id")
          .eq("package_id", jobPackageId)
          .eq("status", "running")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (activeAutofix) {
          // ── Delta-based stagnation detection ──
          // Check last 2-3 completed auto_gap_close rounds for score/progress delta
          const isOverMaxRounds = activeAutofix.current_round > (activeAutofix.max_rounds ?? 3);
          
          // Fetch last 3 completed gap-close results for delta analysis
          const { data: recentGapCloses } = await sb
            .from("job_queue")
            .select("result, completed_at")
            .eq("job_type", "auto_gap_close")
            .eq("package_id", jobPackageId)
            .eq("status", "completed")
            .order("completed_at", { ascending: false })
            .limit(3);
          
          const recentResults = (recentGapCloses ?? []).map((r: any) => r.result as Record<string, unknown> | null).filter(Boolean);
          const isFrozen = recentResults.some(r => r?.status === "frozen");
          
          // Delta stagnation: if last 2+ rounds show no score improvement
          let isDeltaStagnant = false;
          if (recentResults.length >= 2) {
            const scores = recentResults
              .map(r => typeof r?.score === "number" ? r.score : null)
              .filter((s): s is number => s !== null);
            if (scores.length >= 2) {
              const maxDelta = Math.max(...scores.slice(0, -1).map((s, i) => s - scores[i + 1]));
              isDeltaStagnant = maxDelta <= 0;
            }
          }

          if (isOverMaxRounds || isFrozen || isDeltaStagnant) {
            const stallReason = isFrozen
              ? `STAGNATION: score=${activeAutofix.last_score}, frozen after round ${activeAutofix.current_round}`
              : isDeltaStagnant
              ? `STAGNATION: no score delta across last ${recentResults.length} rounds (score=${activeAutofix.last_score})`
              : `Exceeded max_rounds: ${activeAutofix.current_round}/${activeAutofix.max_rounds}`;
            const reasonCode = (isFrozen || isDeltaStagnant) ? "STAGNATION" : "MAX_ROUNDS_EXCEEDED";
            
            console.warn(`[job-runner] 🛑 AUTO_PUBLISH_GATE: terminating stalled autofix ${activeAutofix.id.slice(0, 8)} — ${stallReason} (pkg ${jobPackageId.slice(0, 8)})`);
            
            await sb.from("autofix_runs").update({
              status: "failed",
              stop_reason: stallReason,
              stop_reason_code: reasonCode,
            }).eq("id", activeAutofix.id);

            // Set package to quality_gate_failed so it's visible in ops
            await sb.from("course_packages").update({
              status: "quality_gate_failed",
            }).eq("id", jobPackageId);

            const gateReason = `AUTO_PUBLISH_BLOCKED: autofix stalled (${stallReason})`;
            await sb.from("job_queue").update({
              status: "cancelled",
              completed_at: tsNow,
              last_error: gateReason,
              meta: { ...(job.meta || {}), outcome: "blocked", blocked_reason: gateReason },
              ...lockRelease(tsNow),
            }).eq("id", job.id).eq("status", "processing");
            results.push({ id: job.id, status: "cancelled", reason: "autofix_stalled" });
            continue;
          }

          // Self-heal: if autofix is still progressing,
          // ensure there is at least one auto_gap_close self-check job alive.
          let healedGapClose = false;
          const { count: activeGapCloseCount } = await sb
            .from("job_queue")
            .select("id", { count: "exact", head: true })
            .eq("job_type", "auto_gap_close")
            .eq("package_id", jobPackageId)
            .in("status", ["pending", "processing"]);

          if ((activeGapCloseCount ?? 0) === 0) {
            try {
              const payload = {
                package_id: jobPackageId,
                course_id: activeAutofix.course_id ?? job.payload?.course_id ?? null,
                curriculum_id: activeAutofix.curriculum_id ?? job.payload?.curriculum_id ?? null,
                autofix_run_id: activeAutofix.id,
                target_score: activeAutofix.target_score ?? 85,
                max_rounds: activeAutofix.max_rounds ?? 3,
                budget_eur: activeAutofix.budget_eur ?? 2,
              };

              await enqueueJob(sb, {
                job_type: "auto_gap_close",
                payload,
                package_id: jobPackageId,
                max_attempts: 3,
                priority: 10,
                run_after: new Date(Date.now() + 15_000).toISOString(),
              });
              healedGapClose = true;
              console.warn(`[job-runner] 🔧 AUTO_PUBLISH_GATE self-heal: enqueued auto_gap_close for active autofix run ${activeAutofix.id.slice(0, 8)} (pkg ${jobPackageId.slice(0, 8)})`);
            } catch (healErr) {
              console.warn(`[job-runner] auto_gap_close self-heal enqueue failed for pkg ${jobPackageId.slice(0, 8)}: ${(healErr as Error).message}`);
            }
          }

          const gateReason = `AUTO_PUBLISH_GATE: integrity_passed=${pubGate?.integrity_passed ?? "null"} — autofix_active=${activeAutofix.id.slice(0, 8)}${healedGapClose ? ", self_heal=queued_auto_gap_close" : ""}`;
          console.log(`[job-runner] ${gateReason} (pkg ${jobPackageId.slice(0, 8)})`);
          // Long backoff (5 min) — integrity won't flip in seconds
          await requeueWithBackoff(sb, job.id, job.meta, 300_000, gateReason, tsNow);
          results.push({ id: job.id, status: "requeued", reason: healedGapClose ? "auto_publish_gate_self_heal" : "auto_publish_gate" });
          continue;
        }

        // No active autofix run and integrity still failing.
        // ── ROOT-CAUSE REQUEUE: Check if upstream steps need redispatch ──
        let rootCauseHealed = false;
        try {
          const { data: pkgRow } = await sb
            .from("course_packages")
            .select("curriculum_id")
            .eq("id", jobPackageId)
            .maybeSingle();
          const curriculumId = (pkgRow as any)?.curriculum_id ?? null;

          // 1) Check council sessions still open
          const { count: pendingCouncilCount } = await sb
            .from("council_sessions")
            .select("id", { count: "exact", head: true })
            .eq("package_id", jobPackageId)
            .not("status", "in", "(completed,cancelled,skipped)");

          if ((pendingCouncilCount ?? 0) > 0) {
            const { data: councilStep } = await sb
              .from("package_steps")
              .select("status, meta")
              .eq("package_id", jobPackageId)
              .eq("step_key", "quality_council")
              .maybeSingle();

            if (councilStep?.status === "done") {
              // SSOT mismatch: done but sessions still pending — reset step
              await sb.from("package_steps").update({
                status: "queued",
                started_at: null,
                finished_at: null,
                last_error: null,
                meta: {
                  ...((councilStep.meta as any) || {}),
                  root_cause_heal: "council_done_but_sessions_pending",
                  healed_at_v2: tsNow,
                },
              }).eq("package_id", jobPackageId).eq("step_key", "quality_council");
              console.warn(`[job-runner] 🔧 ROOT-CAUSE HEAL: reset quality_council to queued; ${pendingCouncilCount} sessions still open (pkg ${jobPackageId.slice(0, 8)})`);
              rootCauseHealed = true;
            } else {
              // Council step queued/failed — ensure a job is dispatched
              const { count: councilJobCount } = await sb
                .from("job_queue")
                .select("id", { count: "exact", head: true })
                .eq("package_id", jobPackageId)
                .eq("job_type", "package_quality_council")
                .in("status", ["pending", "queued", "processing"]);

              if ((councilJobCount ?? 0) === 0) {
                await enqueueJob(sb, {
                  job_type: "package_quality_council",
                  package_id: jobPackageId,
                  payload: { package_id: jobPackageId, curriculum_id: curriculumId, triggered_by: "auto_publish_root_cause_heal" },
                  max_attempts: 5,
                  priority: 10,
                });
                console.warn(`[job-runner] 🔧 ROOT-CAUSE HEAL: enqueued package_quality_council (pkg ${jobPackageId.slice(0, 8)})`);
                rootCauseHealed = true;
              }
            }
          } else {
            // 2) Council sessions all done — check integrity freshness
            const { data: integrityStep } = await sb
              .from("package_steps")
              .select("status, updated_at, meta")
              .eq("package_id", jobPackageId)
              .eq("step_key", "run_integrity_check")
              .maybeSingle();

            const integrityUpdatedAt = integrityStep?.updated_at
              ? new Date(integrityStep.updated_at).getTime() : 0;

            // Check if council activity is newer than integrity check
            // Use max() over all sessions — a later-decided older session could be missed by order-by created_at
            const { data: councilRows } = await sb
              .from("council_sessions")
              .select("decided_at, created_at")
              .eq("package_id", jobPackageId)
              .limit(50);

            const newestCouncilTs = Array.isArray(councilRows)
              ? councilRows.reduce((max, row: any) => {
                  const ts = new Date(row.decided_at || row.created_at).getTime();
                  return Math.max(max, Number.isFinite(ts) ? ts : 0);
                }, 0)
              : 0;

            const integrityStale = newestCouncilTs > 0 && integrityUpdatedAt > 0 && newestCouncilTs > integrityUpdatedAt;
            const needsIntegrityRedispatch = !integrityStep || integrityStep.status !== "done" || integrityStale;

            if (needsIntegrityRedispatch) {
              const { count: intJobCount } = await sb
                .from("job_queue")
                .select("id", { count: "exact", head: true })
                .eq("package_id", jobPackageId)
                .eq("job_type", "package_run_integrity_check")
                .in("status", ["pending", "queued", "processing"]);

              if ((intJobCount ?? 0) === 0) {
                // If integrity is done but stale, reset the step first
                if (integrityStep?.status === "done" && integrityStale) {
                  await sb.from("package_steps").update({
                    status: "queued",
                    started_at: null,
                    finished_at: null,
                    last_error: null,
                    meta: {
                      ...((integrityStep.meta as any) || {}),
                      root_cause_heal: "integrity_stale_after_council_change",
                      healed_at_v2: tsNow,
                    },
                  }).eq("package_id", jobPackageId).eq("step_key", "run_integrity_check");
                }

                await enqueueJob(sb, {
                  job_type: "package_run_integrity_check",
                  package_id: jobPackageId,
                  payload: { package_id: jobPackageId, curriculum_id: curriculumId, triggered_by: "auto_publish_root_cause_heal" },
                  max_attempts: 3,
                  priority: 10,
                });
                console.warn(`[job-runner] 🔧 ROOT-CAUSE HEAL: enqueued package_run_integrity_check${integrityStale ? " (stale after council)" : ""} (pkg ${jobPackageId.slice(0, 8)})`);
                rootCauseHealed = true;
              }
            }
          }
        } catch (rootCauseErr) {
          console.warn(`[job-runner] root-cause heal check failed: ${(rootCauseErr as Error).message}`);
        }

        if (rootCauseHealed) {
          await sb.from("job_queue").update({
            status: "cancelled",
            completed_at: tsNow,
            last_error: "ROOT_CAUSE_HEALED: upstream step redispatched, auto_publish will retry later",
            meta: { ...(job.meta || {}), outcome: "root_cause_healed" },
            ...lockRelease(tsNow),
          }).eq("id", job.id).eq("status", "processing");

          await sb.from("auto_heal_log").insert({
            action_type: "auto_publish_root_cause_heal",
            trigger_source: "job_runner",
            target_type: "package",
            target_id: jobPackageId,
            result_status: "success",
            result_detail: "Detected upstream root cause and redispatched prerequisite instead of hard loop-block",
            metadata: { package_id: jobPackageId, source_job_id: job.id },
          });

          results.push({ id: job.id, status: "cancelled", reason: "auto_publish_root_cause_healed" });
          continue;
        }

        // No root cause found — fall through to deterministic block logic
        // ── LOOP GUARD: Count recent deterministic cancels to prevent spam ──
        const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { count: recentCancelCount } = await sb
          .from("job_queue")
          .select("id", { count: "exact", head: true })
          .eq("job_type", "package_auto_publish")
          .eq("package_id", jobPackageId)
          .eq("status", "cancelled")
          .gte("completed_at", TWO_HOURS_AGO);

        const cancelCount = (recentCancelCount ?? 0) + 1; // +1 for current
        const AUTO_PUBLISH_MAX_DETERMINISTIC_CANCELS = 3;
        const shouldBlockStep = cancelCount >= AUTO_PUBLISH_MAX_DETERMINISTIC_CANCELS;

        const gateReason = `AUTO_PUBLISH_BLOCKED: integrity_passed=${pubGate?.integrity_passed ?? "null"} and no active autofix run (cancel ${cancelCount}/${AUTO_PUBLISH_MAX_DETERMINISTIC_CANCELS})`;
        console.warn(`[job-runner] ${gateReason} (pkg ${jobPackageId.slice(0, 8)})`);

        // Cancel the job
        await sb.from("job_queue").update({
          status: "cancelled",
          completed_at: tsNow,
          last_error: gateReason,
          meta: { ...(job.meta || {}), outcome: "blocked", blocked_reason: gateReason },
          ...lockRelease(tsNow),
        }).eq("id", job.id).eq("status", "processing");

        if (shouldBlockStep) {
          // ── TERMINAL BLOCK: Step + Package become blocked ──
          const blockReason = `AUTO_PUBLISH_GATE_BLOCKED: ${cancelCount} deterministic failures in 2h. integrity_passed=false, no active autofix.`;
          console.warn(`[job-runner] 🛑 LOOP GUARD: blocking auto_publish step + package (pkg ${jobPackageId.slice(0, 8)})`);

          // Block the step so pipeline-process won't re-enqueue
          await sb.from("package_steps").update({
            status: "blocked",
            last_error: blockReason,
            meta: {
              auto_publish_block_reason: "deterministic_publish_gate_failure",
              auto_publish_cancel_count: cancelCount,
              blocked_at: tsNow,
              last_gate_state: {
                integrity_passed: pubGate?.integrity_passed ?? null,
                report_version: Number((pubGate as any)?.integrity_report_version_num) || 0,
              },
            },
          }).eq("package_id", jobPackageId).eq("step_key", "auto_publish");

          // Mark package with visible blocker (keep building status for ops visibility)
          await sb.from("course_packages").update({
            blocked_reason: blockReason,
          }).eq("id", jobPackageId);

          // Cancel any remaining pending auto_publish jobs for this package
          await sb.from("job_queue").update({
            status: "cancelled",
            completed_at: tsNow,
            last_error: "LOOP_GUARD: step blocked after repeated deterministic failures",
            ...lockRelease(tsNow),
          }).eq("job_type", "package_auto_publish")
            .eq("package_id", jobPackageId)
            .in("status", ["pending"]);

          // Notify ops
          try {
            await sb.from("admin_notifications").insert({
              title: "🛑 Auto-Publish Loop Guard triggered",
              body: `Package "${(job.payload as any)?.title ?? jobPackageId.slice(0, 8)}" blocked after ${cancelCount} deterministic auto_publish failures. Root cause: integrity_passed=false, no active autofix. Manual intervention required.`,
              category: "pipeline",
              severity: "critical",
              entity_type: "auto_publish_loop_guard",
              entity_id: jobPackageId,
            });
          } catch (_) { /* non-critical */ }

          // Log to auto_heal_log
          await sb.from("auto_heal_log").insert({
            action_type: "auto_publish_loop_guard_block",
            trigger_source: "job_runner",
            target_type: "package",
            target_id: jobPackageId,
            result_status: "blocked",
            result_detail: blockReason,
            metadata: {
              cancel_count: cancelCount,
              integrity_passed: pubGate?.integrity_passed ?? null,
              report_version: Number((pubGate as any)?.integrity_report_version_num) || 0,
            },
          });
        }

        results.push({ id: job.id, status: "cancelled", reason: shouldBlockStep ? "auto_publish_loop_guard_blocked" : "auto_publish_blocked_no_autofix" });
        continue;
      }
    }

    // ── Prereq guard (track-aware) ─────────────────────────────────────
    const currentStepKey = Object.entries(STEP_TO_JOB_TYPE).find(([, jt]) => jt === job.job_type)?.[0];
    const prereqCandidates = PIPELINE_PREREQS[job.job_type];
    if (prereqCandidates && job.payload?.package_id) {
      // Load all steps for this package to find which prereq actually exists
      const { data: allSteps } = await sb
        .from("package_steps")
        .select("step_key, status")
        .eq("package_id", job.payload.package_id);

      const stepMap = new Map((allSteps || []).map((s: any) => [s.step_key, { status: s.status, exception_approved: s.exception_approved }]));

      // Find the first prereq that actually exists as a step in this package
      const prereqStep = prereqCandidates.find(p => stepMap.has(p));

      if (prereqStep) {
        const prereqInfo = stepMap.get(prereqStep);
        const prereqStatus = prereqInfo?.status;
        // "skipped" counts as fulfilled — the step was intentionally bypassed by track logic
        // exception_approved also counts as fulfilled — admin override
        if (prereqStatus !== "done" && prereqStatus !== "skipped" && !prereqInfo?.exception_approved) {
          const prereqJobType = STEP_TO_JOB_TYPE[prereqStep as keyof typeof STEP_TO_JOB_TYPE] ?? null;
          const staleLikeStatus = prereqStatus === "queued" || prereqStatus === "enqueued";
          let activePrereqJobCount = 0;
          let boostedPrereqJob = false;

          if (prereqJobType) {
            const boostResult = await boostPendingPrereqJob(sb, {
              packageId: job.payload.package_id as string,
              prereqJobType,
              prereqStep,
              blockerJobType: job.job_type,
              tsNow,
            });
            activePrereqJobCount = boostResult.activeCount;
            boostedPrereqJob = boostResult.boosted;
          }

          if (staleLikeStatus && activePrereqJobCount === 0 && currentStepKey) {
            const currentArtifactCheck = await checkArtifacts(sb, job.payload.package_id, currentStepKey);
            if (currentArtifactCheck.ready) {
              console.warn(`[job-runner] Stale prereq bypass: ${job.job_type} continues although ${prereqStep} is '${prereqStatus}' (pkg ${(job.payload.package_id as string).slice(0, 8)}) because current artifacts are already ready`);
            } else {
              console.warn(`[job-runner] Stale prereq detected: ${job.job_type} sees ${prereqStep}='${prereqStatus}' with no active producer job (pkg ${(job.payload.package_id as string).slice(0, 8)}) — delegating to artifact resolver`);
              // Let the artifact resolver below decide whether to requeue or re-enqueue the producer.
            }

            if (currentArtifactCheck.ready || !currentArtifactCheck.ready) {
              // Skip hard prereq requeue for stale queued/enqueued states without an active producer job.
            } else {
              // unreachable
            }
          } else {
          // Adaptive backoff: if prereq is already enqueued/running, wait longer to avoid hot requeue loops
          const prereqDelayMs = boostedPrereqJob
            ? 45_000
            : (prereqStatus === "enqueued" || prereqStatus === "running")
            ? 90_000
            : BACKOFF_PREREQ_MS;

          console.warn(`[job-runner] Prereq guard: ${job.job_type} requeued — ${prereqStep} is '${prereqStatus ?? 'missing'}' (pkg ${(job.payload.package_id as string).slice(0, 8)}, backoff=${prereqDelayMs}ms${boostedPrereqJob ? ', producer_boosted=true' : ''})`);
          await requeueWithBackoff(
            sb,
            job.id,
            job.meta,
            prereqDelayMs,
            `Prereq guard: ${prereqStep} not done (${prereqStatus ?? 'missing'})${boostedPrereqJob ? ' — producer boosted' : ''}`,
            tsNow,
          );
          results.push({ id: job.id, status: "requeued", reason: "prereq_not_done" });
          continue;
          }
        }
      }

      // ── Artifact resolver (additive intelligence layer) ────────────────
      // Checks if required artifacts actually exist in DB, not just step status.
      // This catches data-loss scenarios where step is "done" but data is missing.
      if (job.payload?.package_id) {
        // Reverse-lookup: job_type → step_key
        if (currentStepKey) {
          const artifactCheck = await checkArtifacts(sb, job.payload.package_id, currentStepKey);
          if (!artifactCheck.ready) {
            const blockCount = (job.meta?.artifact_block_count ?? 0) as number;
            const missing = artifactCheck.missingArtifact ?? "unknown";
            const producerStep = artifactCheck.producerStep ?? null;

            // ── SSOT CONTRACT VIOLATION DETECTION ──
            // If PIPELINE_PREREQS passed (no requeue above) but artifact-resolver blocks,
            // it means the two definitions disagree — log as structural drift.
            const prereqPassed = prereqCandidates ? true : false; // we got here = prereq guard passed
            if (prereqPassed && blockCount === 0) {
              console.error(`[job-runner] ⚠️ SSOT_CONTRACT_VIOLATION: ${job.job_type} passed PIPELINE_PREREQS but artifact-resolver blocks on "${missing}" (producer: ${producerStep}). PIPELINE_PREREQS and PIPELINE_GRAPH.requires are out of sync! (pkg ${(job.payload.package_id as string).slice(0, 8)})`);
            }

            // Phase 3: Progressive backoff — only enter blocked-mode at retry >= 3
            const backoffMs =
              blockCount < 1 ? 20_000 :
              blockCount < 2 ? 60_000 :
              blockCount < 3 ? 180_000 :
              blockCount < 5 ? 900_000 :
              3_600_000; // cap at 60min

            const isBlockedMode = blockCount >= 3;
            // Only initialize blocked_since once (when entering blocked mode)
            const blockedSince = isBlockedMode
              ? (job.meta?.artifact_blocked_since as string | undefined) ?? tsNow
              : null;

            const reason = isBlockedMode ? "artifact_blocked" : "artifact_missing";

            console.warn(`[job-runner] ARTIFACT${isBlockedMode ? "_BLOCKED" : ""}: ${job.job_type} missing ${missing} (producer: ${producerStep}) [retry=${blockCount + 1}${isBlockedMode ? ` — blocked-mode, backoff=${Math.round(backoffMs / 1000)}s` : `/${3}`}]`);

            // Phase 6: Enqueue producer with priority bump (idempotent — DB dedup handles duplicates)
            if (producerStep && job.payload?.package_id) {
              const producerJobType = STEP_TO_JOB_TYPE[producerStep as keyof typeof STEP_TO_JOB_TYPE] ?? null;
              if (producerJobType) {
                const bump = getArtifactPriorityBump(producerStep);
                // Idempotent enqueue: only insert if no pending/processing job of same type+package exists
                const { count: existingCount } = await sb.from("job_queue")
                  .select("id", { count: "exact", head: true })
                  .eq("job_type", producerJobType)
                  .eq("package_id", job.payload.package_id)
                  .in("status", ["pending", "processing"]);

                if ((existingCount ?? 0) === 0) {
                  try {
                    await enqueueJob(sb, {
                      job_type: producerJobType,
                      package_id: job.payload.package_id as string,
                      payload: { package_id: job.payload.package_id },
                      priority: 10 + bump,
                      run_after: null,
                    });
                    console.log(`[job-runner] PHASE6: Enqueued producer ${producerJobType} with priority ${10 + bump} for pkg ${(job.payload.package_id as string).slice(0, 8)}`);
                  } catch (_enqErr) {
                    // Idempotency or non-executable package guard → safe to ignore
                    console.log(`[job-runner] PHASE6: Producer ${producerJobType} not enqueued (idempotent/non-executable)`);
                  }
                }
              }
            }

            await sb.from("job_queue").update({
              status: "pending",
              run_after: new Date(Date.now() + backoffMs).toISOString(),
              last_error: `Artifact missing: ${missing}${producerStep ? ` (producer: ${producerStep})` : ""}`,
              meta: {
                ...(job.meta || {}),
                artifact_block_count: blockCount + 1,
                last_missing_artifact: missing,
                last_missing_artifact_at: tsNow,
                last_artifact_check: tsNow,
                // Phase 3: blocked-mode only at threshold
                artifact_blocked: isBlockedMode,
                artifact_blocked_since: blockedSince,
                artifact_blocked_backoff_ms: backoffMs,
                blocked_by_artifact: missing,
                blocked_by_producer: producerStep,
                artifact_storm: isBlockedMode,
              },
              ...lockRelease(tsNow),
            }).eq("id", job.id);
            results.push({ id: job.id, status: "requeued", reason, artifact: missing });
            continue;
          } else {
            // Artifact resolved — clear ALL block metadata cleanly
            if (job.meta?.artifact_blocked || job.meta?.artifact_block_count) {
              await sb.from("job_queue").update({
                meta: {
                  ...(job.meta || {}),
                  artifact_blocked: false,
                  artifact_block_count: 0,
                  artifact_storm: false,
                  blocked_by_artifact: null,
                  blocked_by_producer: null,
                  artifact_blocked_since: null,
                  artifact_blocked_backoff_ms: null,
                  last_missing_artifact: null,
                },
              }).eq("id", job.id);
            }
          }
        }
      }
    }
    // ── Pre-execution lease guard ──────────────────────────────────
    // If a package has an active lease, honour it. If NO lease row exists
    // at all but the package is in 'building' status, proceed — the lease
    // subsystem may not have been initialised for this package yet.
    const execPackageId = job.package_id ?? job.payload?.package_id;
    if (execPackageId) {
      const { data: leaseRow } = await sb
        .from("package_leases")
        .select("lease_until")
        .eq("package_id", execPackageId)
        .maybeSingle();

      const leaseActive = leaseRow && new Date(leaseRow.lease_until) > new Date();
      const leaseExists = !!leaseRow;

      if (!leaseActive) {
        // Check if the package is still in 'building' — if so, allow execution
        // even without a lease (lease subsystem may not be initialised).
        const { data: cpRow } = await sb
          .from("course_packages")
          .select("status")
          .eq("id", execPackageId)
          .maybeSingle();

        const pkgIsBuilding = cpRow?.status === "building";

        if (leaseExists && !pkgIsBuilding) {
          // Lease existed but expired AND package is not building → block
          console.warn(`[job-runner] Lease expired before execution for job ${job.id} (pkg ${String(execPackageId).slice(0, 8)})`);
          await requeueWithBackoff(sb, job.id, job.meta, 60_000, "Lease expired pre-execution", tsNow);
          results.push({ id: job.id, status: "requeued", reason: "lease_expired" });
          continue;
        }
        // No lease row at all + building → proceed (lease not initialised)
        // Expired lease + building → proceed (lease renewal may be pending)
        if (!leaseExists && pkgIsBuilding) {
          console.log(`[job-runner] No lease for building pkg ${String(execPackageId).slice(0, 8)}, proceeding without lease`);
        }
      }
    }

    const startMs = Date.now();

    // ── Progress heartbeat: update last_progress_at so UI doesn't show "stuck" ──
    if (execPackageId) {
      await sb.from("course_packages")
        .update({ last_progress_at: new Date().toISOString() })
        .eq("id", execPackageId);
    }

    // ── Single-exit state for guaranteed lock release ─────────────
    type FinalState = {
      status: "completed" | "pending" | "failed" | "cancelled";
      patch: Record<string, unknown>;
      metricsAction?: "completed" | "timeout" | "rateLimit" | "dlq";
      requeue?: boolean;
    };

    let finalState: FinalState | null = null;

    // ── 2. Invoke target Edge Function ───────────────────────────────
    console.log(`[job-runner] DISPATCH job=${job.id.slice(0,8)} type=${job.job_type} lf=${job.payload?.learning_field_filter?.slice(0,8) ?? '__root__'}`);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS);

      const payload = {
        ...(job.payload || {}),
        ...(job.batch_cursor ? { _batch_cursor: job.batch_cursor, batch_cursor: job.batch_cursor } : {}),
        _job_id: job.id,
        _job_type: job.job_type,
      };

      // Rework functions use dedicated cron secret, not Bearer service key
      const isReworkFn = REWORK_SECRET_FUNCTIONS.has(fnName);
      const reworkSecret = isReworkFn ? Deno.env.get("REWORK_CRON_SECRET") : undefined;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        apikey: SERVICE_ROLE_KEY,
      };
      if (isReworkFn && reworkSecret) {
        headers["x-rework-secret"] = reworkSecret;
      } else {
        headers["authorization"] = `Bearer ${SERVICE_ROLE_KEY}`;
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const elapsedMs = Date.now() - startMs;

      const text = await res.text().catch(() => "");
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = text; }

      if (!res.ok) {
        // ── 422 Permanent SSOT/Guard failure (NO RETRY) ──────────────
        // Edge functions return 422 for permanent DB/SSOT guard violations
        // (CHECK/NOT NULL/FK/RLS). These MUST NOT be requeued.
        if (res.status === 422) {
          const maxAttempts = job.max_attempts || 3;
          const errStr =
            typeof parsed === "string"
              ? parsed.slice(0, 500)
              : JSON.stringify(parsed).slice(0, 500);

          const isPermanent =
            (typeof parsed === "object" && parsed && (parsed as any).permanent === true) ||
            (typeof parsed === "object" && parsed && String((parsed as any).error || "").toLowerCase().includes("ssot")) ||
            (typeof parsed === "object" && parsed && String((parsed as any).message || "").toLowerCase().includes("ssot_guard_permanent"));

          // Check if response explicitly says retry:false — this is a deterministic block
          const isNoRetry = typeof parsed === "object" && parsed && (parsed as any).retry === false;

          if (isPermanent || isNoRetry) {
            const label = isPermanent ? "PERMANENT" : "BLOCKED";
            console.warn(`[job-runner] ${fnName} 422 ${label} → terminal (no retry)`);
            finalState = {
              status: "cancelled",
              patch: {
                error: `HTTP 422 ${label}: ${errStr}`,
                completed_at: tsNow,
                last_error: `HTTP 422 ${label}: ${errStr}`,
                meta: { ...(job.meta || {}), outcome: label.toLowerCase(), blocked_reason: errStr },
                result: typeof parsed === "object" ? parsed : { raw: parsed },
              },
            };
            tickMetrics.totalLatencyMs += elapsedMs;
            continue;
          }
          // If 422 but not marked permanent/blocked, fall through to standard hard-failure handling.
        }
        // ── 409 Conflict ─────────────────────────────────────────────
        if (res.status === 409) {
          const isIdempotent = parsed?.skipped === true || parsed?.ok === true || parsed?.retry === false;
          if (isIdempotent) {
            console.log(`[job-runner] ${fnName} 409 idempotent → completed`);
            finalState = {
              status: "completed",
              patch: {
                result: { ...(typeof parsed === "object" ? parsed : {}), _409_idempotent: true },
                completed_at: tsNow,
              },
              metricsAction: "completed",
            };
          } else {
            // ── PREREQ_BURN_GUARD: track consecutive prereq retries ──
            const prereqRetries = Number((job.meta as any)?.prereq_retries ?? 0) + 1;
            const MAX_PREREQ_RETRIES = 8;

            // ── Auto-heal: check if prereq has become done since last attempt ──
            let prereqNowDone = false;
            if (prereqRetries >= 3 && job.payload?.package_id) {
              const stepKey = Object.entries(STEP_TO_JOB_TYPE).find(([, jt]) => jt === job.job_type)?.[0];
              const prereqSteps = PIPELINE_PREREQS[job.job_type];
              if (stepKey && prereqSteps) {
                const { data: freshSteps } = await sb
                  .from("package_steps")
                  .select("step_key, status")
                  .eq("package_id", job.payload.package_id)
                  .in("step_key", prereqSteps);
                const prereqStep = prereqSteps.find((p: string) => freshSteps?.some((s: any) => s.step_key === p));
                if (prereqStep) {
                  const freshStatus = freshSteps?.find((s: any) => s.step_key === prereqStep)?.status;
                  if (freshStatus === "done" || freshStatus === "skipped") {
                    prereqNowDone = true;
                    console.log(`[job-runner] PREREQ_AUTO_HEAL: ${job.job_type} prereq ${prereqStep} is now '${freshStatus}' — resetting retry counter (was ${prereqRetries})`);
                  }
                }
              }
            }

            if (prereqNowDone) {
              // Prereq resolved — requeue immediately with reset counter
              finalState = {
                status: "pending",
                patch: {
                  run_after: null,
                  error: null,
                  meta: { ...(job.meta || {}), last_retry: tsNow, prereq_retries: 0, prereq_auto_healed_at: tsNow },
                },
              };
            } else if (prereqRetries >= MAX_PREREQ_RETRIES) {
              // ── Also heal the step if it was failed due to burn guard ──
              if (job.payload?.package_id) {
                const stepKey = Object.entries(STEP_TO_JOB_TYPE).find(([, jt]) => jt === job.job_type)?.[0];
                if (stepKey) {
                  await sb.from("package_steps").update({
                    status: "failed",
                    last_error: `PREREQ_BURN_GUARD: ${prereqRetries} retries exhausted`,
                    finished_at: tsNow,
                  }).eq("package_id", job.payload.package_id).eq("step_key", stepKey);
                }
              }
              console.error(`[job-runner] ${fnName} PREREQ_BURN_GUARD: ${prereqRetries} consecutive 409 prereq retries → blocked (pkg ${(job.payload?.package_id as string || '?').slice(0, 8)})`);
              finalState = {
                status: "failed",
                patch: {
                  error: `PREREQ_BURN_GUARD: ${prereqRetries} retries exhausted waiting for prereq. Last: ${parsed?.error || parsed?.reason || 'unknown'}`,
                  completed_at: tsNow,
                  attempts: (job.attempts || 0) + 1,
                  meta: { ...(job.meta || {}), prereq_retries: prereqRetries, prereq_burned: true },
                },
              };
            } else {
              // Adaptive backoff: longer waits as retries increase
              const prereqBackoff = Math.min(BACKOFF_409_MS * Math.pow(1.5, prereqRetries - 1), 300_000);
              console.warn(`[job-runner] ${fnName} 409 retry → requeue +${prereqBackoff}ms (prereq_retry=${prereqRetries}/${MAX_PREREQ_RETRIES})`);
              finalState = {
                status: "pending",
                patch: {
                  run_after: new Date(Date.now() + prereqBackoff).toISOString(),
                  error: `HTTP 409 — prereq not ready (retry ${prereqRetries}/${MAX_PREREQ_RETRIES})`,
                  meta: { ...(job.meta || {}), last_retry: tsNow, prereq_retries: prereqRetries },
                },
              };
            }
          }
        }
        // ── Rate-limited / transient (503, 429) ─────────────────────
        else if (res.status === 429 || res.status === 503) {
          const ta = Number((job.meta as any)?.transient_attempts ?? 0) + 1;
          const transientFirstAt = (job.meta as any)?.transient_first_at ?? tsNow;
          const windowElapsed = Date.now() - new Date(transientFirstAt).getTime();

          // Transient exhaustion gate: too many transient retries → escalate
          if (ta >= MAX_TRANSIENT_ATTEMPTS && windowElapsed < TRANSIENT_WINDOW_MS) {
            console.error(`[job-runner] ${fnName} TRANSIENT_EXHAUSTED: ${ta} transient retries in ${Math.round(windowElapsed / 1000)}s → failed`);
            finalState = {
              status: "failed",
              patch: {
                error: `TRANSIENT_EXHAUSTED: ${ta} retries (${res.status}) in ${Math.round(windowElapsed / 60000)}min`,
                completed_at: tsNow,
                attempts: (job.attempts || 0) + 1,
                meta: { ...(job.meta || {}), transient_attempts: ta, transient_exhausted: true, transient_first_at: transientFirstAt },
              },
              metricsAction: "dlq",
            };
          } else {
            // Reset window if expired
            const effectiveFirstAt = windowElapsed >= TRANSIENT_WINDOW_MS ? tsNow : transientFirstAt;
            const effectiveTa = windowElapsed >= TRANSIENT_WINDOW_MS ? 1 : ta;

            console.warn(`[job-runner] ${fnName} ${res.status} → requeue +${BACKOFF_429_MS}ms (ta=${effectiveTa}/${MAX_TRANSIENT_ATTEMPTS})`);
            finalState = {
              status: "pending",
              patch: {
                run_after: new Date(Date.now() + BACKOFF_429_MS).toISOString(),
                error: `HTTP ${res.status} — transient retry ${effectiveTa}/${MAX_TRANSIENT_ATTEMPTS}`,
                meta: {
                  ...(job.meta || {}),
                  last_retry: tsNow,
                  transient_attempts: effectiveTa,
                  transient_first_at: effectiveFirstAt,
                  last_transient_error: `HTTP ${res.status}`,
                  last_transient_at: tsNow,
                },
              },
              metricsAction: "rateLimit",
            };
          }
        }
        // ── Hard failure ─────────────────────────────────────────────
        else {
          const maxAttempts = job.max_attempts || 3;
          const errStr = typeof parsed === "string" ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500);

          // v5.10: Transient-aware — if response body indicates transient error,
          // do NOT burn attempt budget (same policy as 503 handler)
          const bodyLooksTransient = typeof parsed === "object" && parsed && (
            (parsed as any).transient === true ||
            (parsed as any).retry === true ||
            String((parsed as any).error || "").toLowerCase().includes("all providers failed") ||
            String((parsed as any).error || "").toLowerCase().includes("timed out") ||
            String((parsed as any).error || "").toLowerCase().includes("timeout")
          );

          if (bodyLooksTransient) {
            const ta = Number((job.meta as any)?.transient_attempts ?? 0) + 1;
            const transientFirstAt = (job.meta as any)?.transient_first_at ?? tsNow;
            const windowElapsed = Date.now() - new Date(transientFirstAt).getTime();

            if (ta >= MAX_TRANSIENT_ATTEMPTS && windowElapsed < TRANSIENT_WINDOW_MS) {
              console.error(`[job-runner] ${fnName} TRANSIENT_EXHAUSTED (body): ${ta} retries in ${Math.round(windowElapsed / 1000)}s → failed`);
              finalState = {
                status: "failed",
                patch: {
                  error: `TRANSIENT_EXHAUSTED: ${ta} retries (HTTP ${res.status} body-transient) in ${Math.round(windowElapsed / 60000)}min`,
                  completed_at: tsNow,
                  attempts: (job.attempts || 0) + 1,
                  meta: { ...(job.meta || {}), transient_attempts: ta, transient_exhausted: true, transient_first_at: transientFirstAt },
                },
                metricsAction: "dlq",
              };
            } else {
              const effectiveFirstAt = windowElapsed >= TRANSIENT_WINDOW_MS ? tsNow : transientFirstAt;
              const effectiveTa = windowElapsed >= TRANSIENT_WINDOW_MS ? 1 : ta;

              console.warn(`[job-runner] ${fnName} HTTP ${res.status} body=transient → requeue WITHOUT attempt++ (ta=${effectiveTa}/${MAX_TRANSIENT_ATTEMPTS}, +${BACKOFF_429_MS}ms)`);
              finalState = {
                status: "pending",
                patch: {
                  run_after: new Date(Date.now() + BACKOFF_429_MS).toISOString(),
                  error: `HTTP ${res.status} transient: ${errStr.slice(0, 200)}`,
                  meta: {
                    ...(job.meta || {}),
                    last_retry: tsNow,
                    transient_attempts: effectiveTa,
                    transient_first_at: effectiveFirstAt,
                    last_transient_error: errStr.slice(0, 200),
                    last_transient_at: tsNow,
                  },
                },
                metricsAction: "rateLimit",
              };
            }
          } else {
            const newAttempts = (job.attempts || 0) + 1;
            if (newAttempts >= maxAttempts) {
              finalState = {
                status: "failed",
                patch: { error: `HTTP ${res.status}: ${errStr}`, completed_at: tsNow, attempts: newAttempts },
                metricsAction: (job.job_type === "package_generate_exam_pool" || job.job_type === "generate_questions") ? "dlq" : undefined,
              };
            } else {
              finalState = {
                status: "pending",
                patch: {
                  run_after: new Date(Date.now() + computeErrorBackoffMs(newAttempts)).toISOString(),
                  error: `HTTP ${res.status} — attempt ${newAttempts}/${maxAttempts}`,
                  attempts: newAttempts,
                  meta: { ...(job.meta || {}), last_retry: tsNow },
                },
              };
            }
          }
        }

        // Collect metrics
        if (finalState?.metricsAction === "completed") {
          tickMetrics.completed++;
          tickMetrics.totalLatencyMs += elapsedMs;
        } else if (finalState?.metricsAction === "rateLimit") {
          tickMetrics.rateLimits++;
        }
      }
      // ── 3. Batch incomplete → adaptive requeue ─────────────────────
      else if (parsed && parsed.batch_complete === false) {
        // ── Dispatcher-aware adaptive delay ──
        // Avoids 3s spam-requeue; gives lesson jobs time to complete
        const gate = parsed?.completion_gate ?? {};
        const activeJobs = Number(gate?.active_jobs ?? parsed?.active_lesson_jobs ?? 0);
        const missingCount = Number(gate?.missing ?? parsed?.total_missing ?? 1);

        // Adaptive delay: 30s if jobs running, 10s if need to fan-out more, 20s fallback
        const dispatcherDelayMs =
          activeJobs > 0 ? 30_000 :
          missingCount > 0 ? 10_000 :
          20_000;

        console.log(`[job-runner] ${fnName} batch incomplete → requeue +${dispatcherDelayMs}ms (active=${activeJobs}, missing=${missingCount})`);
        // Preserve poison_pills across requeue cycles so content generator can skip persistently-failing lessons
        const poisonPills = parsed._poison_pills || {};
        finalState = {
          status: "pending",
          patch: {
            run_after: new Date(Date.now() + dispatcherDelayMs).toISOString(),
            batch_cursor: parsed.batch_cursor ?? null,
            meta: {
              ...(job.meta || {}),
              last_batch: tsNow,
              poison_pills_count: Object.keys(poisonPills).length,
              dispatcher_gate: parsed?.completion_gate ?? null,
            },
            // Merge poison pills into payload for next invocation
            payload: { ...(job.payload || {}), _poison_pills: poisonPills },
          },
        };
      }
      // ── 4. Quality-Gate failure: ok=false + batch_complete=true ──
      else if (parsed && parsed.ok === false && parsed.batch_complete === true) {
        const summaryParts: string[] = [];
        if (Array.isArray(parsed?.issues) && parsed.issues.length > 0) {
          summaryParts.push(parsed.issues.join("; "));
        }
        if (typeof parsed?.message === "string" && parsed.message.trim()) {
          summaryParts.push(parsed.message.trim());
        }
        if (typeof parsed?.error === "string" && parsed.error.trim()) {
          summaryParts.push(parsed.error.trim());
        }
        const issuesSummary = (summaryParts.join(" | ").slice(0, 400) || "Validation failed");
        console.warn(`[job-runner] ${fnName} quality-gate FAILED: ${issuesSummary}`);

        const maxAttempts = job.max_attempts || 3;
        const newAttempts = (job.attempts || 0) + 1;

        // ── AUTO-HEAL: For validation steps, reset predecessor to trigger re-generation ──
        // This is CRITICAL: without this, the validator just requeues itself endlessly
        // while the predecessor (seeder) stays "done" and the missing content is never generated.
        const VALIDATION_PREDECESSOR: Record<string, string> = {
          package_validate_blueprints: "auto_seed_exam_blueprints",
          package_validate_exam_pool: "generate_exam_pool",
          package_validate_oral_exam: "generate_oral_exam",
          package_validate_learning_content: "generate_learning_content",
        };
        // FIX #1: SSOT step-key map — never derive via string replace
        const VALIDATION_STEP_KEY: Record<string, string> = {
          package_validate_blueprints: "validate_blueprints",
          package_validate_exam_pool: "validate_exam_pool",
          package_validate_oral_exam: "validate_oral_exam",
          package_validate_learning_content: "validate_learning_content",
        };
        const predecessorStep = VALIDATION_PREDECESSOR[job.job_type];
        const validationStepKey = VALIDATION_STEP_KEY[job.job_type];
        const packageId = job.payload?.package_id as string | undefined;
        // FIX #2: Robust missing_lf_ids extraction — check multiple field names
        const missingLfIds: string[] | undefined =
          Array.isArray((parsed as any).missing_lf_ids) ? (parsed as any).missing_lf_ids :
          Array.isArray((parsed as any).missing_learning_field_ids) ? (parsed as any).missing_learning_field_ids :
          undefined;

        // FIX #4: Deterministic reseed triggers (coverage gap / no-pending dead-end)
        const hasMissingCoverage =
          (Array.isArray(parsed?.issues) && parsed.issues.some((i: string) => typeof i === "string" && i.includes("MISSING_LF_COVERAGE"))) ||
          (typeof parsed?.message === "string" && parsed.message.includes("MISSING_LF_COVERAGE"));

        const shouldForceReseed =
          parsed?.reseed_required === true ||
          parsed?.no_pending_questions === true ||
          (typeof parsed?.error === "string" && parsed.error.includes("NO_QUESTIONS_TO_VALIDATE"));

        // ═══ DEADLOCK GUARD v2: Precise SSOT-based reseed decision ═══
        // The validator may report NO_PENDING_QUESTIONS due to lifecycle drift (questions
        // in draft/tier1_passed instead of review/pending). Resetting the generator
        // creates a circular dependency: validator needs step=done, healer destroys step=done.
        // Check SSOT before deciding to reseed — classify the actual state precisely.
        let hasActualPendingQuestions = false;
        let reseedDiagnosis: "true_zero" | "lifecycle_drift" | "compatible_unapproved" | "unknown" = "unknown";
        if ((shouldForceReseed || hasMissingCoverage) && packageId && validationStepKey === "validate_exam_pool") {
          try {
            const { data: pkgData } = await sb.from("course_packages")
              .select("curriculum_id").eq("id", packageId).maybeSingle();
            if (pkgData?.curriculum_id) {
              const currId = pkgData.curriculum_id;

              // Count validator-compatible questions (review + pending/approved)
              const { count: compatibleCount } = await sb.from("exam_questions")
                .select("id", { count: "exact", head: true })
                .eq("curriculum_id", currId)
                .in("status", ["review", "approved"])
                .in("qc_status", ["pending", "approved"]);

              // Count lifecycle-drifted questions (draft + tier1_passed — need promotion)
              const { count: driftedCount } = await sb.from("exam_questions")
                .select("id", { count: "exact", head: true })
                .eq("curriculum_id", currId)
                .eq("status", "draft")
                .eq("qc_status", "tier1_passed");

              // Count total non-rejected questions
              const { count: totalCount } = await sb.from("exam_questions")
                .select("id", { count: "exact", head: true })
                .eq("curriculum_id", currId)
                .not("status", "eq", "rejected");

              const compat = compatibleCount ?? 0;
              const drifted = driftedCount ?? 0;
              const total = totalCount ?? 0;

              // Classify the situation precisely
              if (total === 0) {
                reseedDiagnosis = "true_zero";
                // Genuine empty pool — reseed is correct
              } else if (compat >= 50) {
                reseedDiagnosis = "compatible_unapproved";
                hasActualPendingQuestions = true;
                // Questions exist AND are validator-compatible — reseed would be destructive
              } else if (drifted >= 50) {
                reseedDiagnosis = "lifecycle_drift";
                hasActualPendingQuestions = true;
                // Questions exist but stuck in wrong lifecycle — need promotion, NOT reseed
              } else if (total >= 50 && compat < 50 && drifted < 50) {
                reseedDiagnosis = "lifecycle_drift";
                hasActualPendingQuestions = true;
                // Questions exist in mixed states — still not a true zero
              }

              // Check recency: don't reseed if generator ran recently with artifacts
              let generatorIsRecent = false;
              if (!hasActualPendingQuestions && total > 0) {
                const { data: genStep } = await sb.from("package_steps")
                  .select("finished_at")
                  .eq("package_id", packageId)
                  .eq("step_key", "generate_exam_pool")
                  .maybeSingle();
                if (genStep?.finished_at) {
                  const ageHours = (Date.now() - new Date(genStep.finished_at).getTime()) / (1000 * 60 * 60);
                  if (ageHours < 6 && total >= 20) {
                    generatorIsRecent = true;
                    hasActualPendingQuestions = true;
                    reseedDiagnosis = "lifecycle_drift";
                  }
                }
              }

              console.log(`[job-runner] 🛡️ DEADLOCK_GUARD_v2: diagnosis=${reseedDiagnosis} compatible=${compat} drifted=${drifted} total=${total} recentGen=${generatorIsRecent ?? false} → ${hasActualPendingQuestions ? "BLOCK reseed" : "ALLOW reseed"}`);
            }
          } catch (_e) { /* best-effort SSOT check */ }
        }

        // ═══ P0.1 + P0.3: GATE-AWARE HEAL ROUTING ═══
        // If the validator returned gate_blocked=true with diagnosis codes,
        // route to targeted repair instead of blind reseed.
        const isGateBlocked = parsed?.gate_blocked === true;
        const gateDiagnosis: string[] = Array.isArray(parsed?.gate_diagnosis) ? parsed.gate_diagnosis : [];
        const needsRepairNotReseed = isGateBlocked && gateDiagnosis.some((d: string) => d.startsWith("REPAIR_NEEDED:"));
        const isTerminalEmpty = isGateBlocked && gateDiagnosis.includes("TERMINAL:POOL_EMPTY");

        // Only allow reseed for true_zero pools or terminal empty states.
        // For REPAIR_NEEDED diagnoses, route to repair_exam_pool_quality instead.
        const shouldHealNow = predecessorStep && packageId && !hasActualPendingQuestions && !needsRepairNotReseed && (hasMissingCoverage || shouldForceReseed || newAttempts >= maxAttempts);

        // P0.3: Route gate_blocked + REPAIR_NEEDED to targeted repair path
        if (needsRepairNotReseed && packageId && validationStepKey === "validate_exam_pool") {
          console.log(`[job-runner] 🎯 TARGETED_REPAIR: gate_blocked with diagnosis=${gateDiagnosis.join(",")} → checking eligibility before repair dispatch`);
          try {
            // P0 GUARD: Check eligibility before dispatching repair
            const eligibility = await isRepairActionEligible(sb, packageId, "repair_exam_pool_quality", "job-runner");
            if (!eligibility.eligible) {
              console.warn(`[job-runner] ❌ REPAIR INELIGIBLE: ${eligibility.reason} (pkg ${packageId.slice(0, 8)})`);
              await sb.from("auto_heal_log").insert({
                action_type: "gate_blocked_repair_ineligible",
                trigger_source: "job-runner",
                target_type: "package_step",
                target_id: packageId,
                result_status: "blocked",
                result_detail: `Repair ineligible: ${eligibility.reason}. Gate diagnosis: ${gateDiagnosis.join(", ")}`,
                metadata: { step: job.job_type, gate_diagnosis: gateDiagnosis, eligibility_reason: eligibility.reason },
              });
            } else {
              // Enqueue targeted repair job
              await enqueueJob(sb, {
                job_type: "package_repair_exam_pool_quality",
                package_id: packageId,
                payload: {
                  package_id: packageId,
                  curriculum_id: job.payload?.curriculum_id,
                  triggered_by: "gate_blocked_targeted_repair",
                  gate_diagnosis: gateDiagnosis,
                  unresolved_count: parsed?.unresolved_count,
                  missing_lf_count: parsed?.missing_lf_ids?.length ?? 0,
                },
                max_attempts: 3,
                priority: 20,
              });

              // Set validate_exam_pool step to waiting_for_repair
              await sb.from("package_steps")
                .update({
                  status: "failed",
                  last_error: `GATE_BLOCKED: ${gateDiagnosis.join(", ")} → targeted repair dispatched`,
                  meta: {
                    ...((await sb.from("package_steps").select("meta").eq("package_id", packageId).eq("step_key", validationStepKey).maybeSingle()).data?.meta as Record<string, unknown> ?? {}),
                    gate_blocked: true,
                    gate_diagnosis: gateDiagnosis,
                    repair_dispatched_at: tsNow,
                    awaiting_repair: true,
                  },
                })
                .eq("package_id", packageId)
                .eq("step_key", validationStepKey);

              await sb.from("auto_heal_log").insert({
                action_type: "gate_blocked_targeted_repair",
                trigger_source: "job-runner",
                target_type: "package_step",
                target_id: packageId,
                result_status: "success",
                result_detail: `Gate blocked: ${gateDiagnosis.join(", ")} → dispatched repair_exam_pool_quality (no reseed)`,
                metadata: {
                  step: job.job_type,
                  step_key: validationStepKey,
                  gate_diagnosis: gateDiagnosis,
                  unresolved_count: parsed?.unresolved_count,
                  approved_count: parsed?.approved_count,
                },
              });
            }
          } catch (repairErr) {
            console.warn(`[job-runner] targeted repair dispatch failed: ${(repairErr as Error).message}`);
          }

          finalState = {
            status: "completed",
            patch: {
              result: typeof parsed === "object" ? parsed : { raw: parsed },
              completed_at: tsNow,
              attempts: newAttempts,
              error: `GATE_BLOCKED → targeted repair dispatched (no reseed)`,
            },
          };
        }
        // Log when deadlock guard blocks a reseed — precise diagnostics
        else if (hasActualPendingQuestions && (shouldForceReseed || hasMissingCoverage)) {
          try {
            await sb.from("auto_heal_log").insert({
              action_type: "deadlock_guard_blocked_reseed",
              trigger_source: "job-runner",
              target_type: "package_step",
              target_id: packageId,
              result_status: "blocked",
              result_detail: `DEADLOCK_GUARD_v2: blocked reseed of ${predecessorStep} — diagnosis: ${reseedDiagnosis}`,
              metadata: {
                step: job.job_type,
                step_key: validationStepKey,
                predecessor: predecessorStep,
                diagnosis: reseedDiagnosis,
                trigger: hasMissingCoverage ? "MISSING_LF_COVERAGE" : "RESEED_REQUIRED",
                no_pending_questions: parsed?.no_pending_questions === true,
              },
            });
          } catch (_e) { /* best-effort */ }
        }

        if (shouldHealNow) {
          // Trigger targeted re-seed via predecessor reset
          const MAX_HEAL_CYCLES = 7;

          // Check how many times we've already healed this step
          const { data: stepRow } = await sb
            .from("package_steps")
            .select("attempts, meta")
            .eq("package_id", packageId)
            .eq("step_key", predecessorStep)
            .maybeSingle();

          const healCycles = (stepRow?.meta as any)?.heal_cycles ?? 0;

          // ═══ STALE-SAFE: Before kill-switch, verify current SSOT state ═══
          // If the pool is actually healthy NOW (enough approved questions),
          // don't kill — the error is stale/historical.
          let poolActuallyHealthy = false;
          if (healCycles >= MAX_HEAL_CYCLES && validationStepKey === "validate_exam_pool") {
            try {
              const { data: pkgData } = await sb.from("course_packages")
                .select("curriculum_id").eq("id", packageId).maybeSingle();
              if (pkgData?.curriculum_id) {
                const { count: approvedCount } = await sb.from("exam_questions")
                  .select("id", { count: "exact", head: true })
                  .eq("curriculum_id", pkgData.curriculum_id)
                  .eq("status", "approved");
                // If we have 500+ approved questions, the pool is healthy regardless of historical flags
                if ((approvedCount ?? 0) >= 500) {
                  poolActuallyHealthy = true;
                  console.log(`[job-runner] ✅ STALE_SAFE: Pool has ${approvedCount} approved questions — skipping kill-switch despite ${healCycles} heal cycles`);
                }
              }
            } catch (_e) { /* best-effort SSOT check */ }
          }

          if (healCycles >= MAX_HEAL_CYCLES && !poolActuallyHealthy) {
            console.error(`[job-runner] 🛑 Kill-switch: ${predecessorStep} healed ${healCycles}x — BLOCKING PACKAGE`);
            if (validationStepKey) {
              await sb.from("package_steps")
                .update({
                  status: "failed",
                  attempts: 99,
                  last_error: `Kill-switch: ${MAX_HEAL_CYCLES} heal cycles exhausted. ${issuesSummary}`,
                  meta: { terminal_escalation: true, kill_switch_at: tsNow, heal_cycles_exhausted: healCycles },
                })
                .eq("package_id", packageId)
                .eq("step_key", validationStepKey);
            }
            await sb.from("course_packages")
              .update({
                status: "blocked",
                blocked_reason: `kill_switch: ${validationStepKey} failed after ${healCycles} heal cycles`,
                last_error: `Kill-switch: ${validationStepKey} exhausted ${healCycles} heal cycles. ${issuesSummary.slice(0, 300)}`,
              })
              .eq("id", packageId);
            try {
              const cancelTypes = [jobType, STEP_TO_JOB_TYPE[predecessorStep as keyof typeof STEP_TO_JOB_TYPE]].filter(Boolean);
              for (const ct of cancelTypes) {
                await sb.rpc("cancel_jobs_for_package" as any, {
                  p_package_id: packageId, p_job_type: ct, p_statuses: ["pending", "processing"],
                  p_reason: `kill_switch_escalation: ${validationStepKey}`,
                });
              }
            } catch (_cancelErr) { /* best-effort */ }
            try {
              await sb.from("auto_heal_log").insert({
                action_type: "qg_heal_kill_switch",
                trigger_source: "job-runner",
                target_type: "package_step",
                target_id: packageId,
                result_status: "escalated",
                result_detail: `${job.job_type} failed ${healCycles}x heal cycles — package BLOCKED`,
                metadata: { step: job.job_type, step_key: validationStepKey, predecessor: predecessorStep, heal_cycles: healCycles, missing_lf_ids: missingLfIds, issues: parsed.issues?.slice(0, 5) },
              });
            } catch (_e) { /* best-effort */ }
            finalState = {
              status: "failed",
              patch: {
                error: `QG FAIL ESCALATED (${healCycles} heal cycles): ${issuesSummary}`,
                result: typeof parsed === "object" ? parsed : { raw: parsed },
                completed_at: tsNow,
                attempts: newAttempts,
              },
            };
          } else if (poolActuallyHealthy) {
            // Pool is healthy despite heal cycle exhaustion — reset cycles and mark step done
            console.log(`[job-runner] ✅ STALE_SAFE_PASS: ${validationStepKey} pool healthy (${healCycles} stale cycles cleared)`);
            await sb.from("package_steps")
              .update({
                status: "done",
                meta: { stale_safe_passed: true, cleared_heal_cycles: healCycles, passed_at: tsNow },
                last_error: null,
              })
              .eq("package_id", packageId)
              .eq("step_key", validationStepKey);
            // Also reset predecessor heal_cycles
            await sb.from("package_steps")
              .update({
                meta: { ...(stepRow?.meta as Record<string, unknown> ?? {}), heal_cycles: 0, heal_reason: null },
              })
              .eq("package_id", packageId)
              .eq("step_key", predecessorStep);
            finalState = {
              status: "completed",
              patch: {
                result: { stale_safe_pass: true, approved_pool_healthy: true },
                completed_at: tsNow,
                attempts: newAttempts,
              },
            };
          } else {
            // Reset predecessor step to queued with targeted LF info
            console.log(`[job-runner] 🔄 Auto-heal: resetting ${predecessorStep} for targeted re-seed (cycle ${healCycles + 1}/${MAX_HEAL_CYCLES})${missingLfIds ? ` [${missingLfIds.length} missing LFs]` : ""}`);

            const predecessorUpdate: Record<string, unknown> = {
              status: "queued",
              job_id: null,
              runner_id: null,
              started_at: null,
              last_error: `Auto-heal: QG failed → re-seed cycle ${healCycles + 1}${missingLfIds ? ` for ${missingLfIds.length} LFs` : ""}`,
              meta: {
                ...(stepRow?.meta as Record<string, unknown> ?? {}),
                heal_cycles: healCycles + 1,
                ...(missingLfIds ? { target_lf_ids: missingLfIds } : {}),
              },
            };

            // FIX #5: Compare-and-set — only reset if not currently running
            await sb.from("package_steps")
              .update(predecessorUpdate)
              .eq("package_id", packageId)
              .eq("step_key", predecessorStep)
              .in("status", ["done", "failed", "queued"]);

            // Also reset the validation step itself to queued (will re-run after predecessor)
            // FIX #3: Use SSOT step_key
            if (validationStepKey) {
              await sb.from("package_steps")
                .update({
                  status: "queued",
                  job_id: null,
                  runner_id: null,
                  started_at: null,
                  last_error: `Waiting for ${predecessorStep} re-seed (cycle ${healCycles + 1})`,
                })
                .eq("package_id", packageId)
                .eq("step_key", validationStepKey)
                .in("status", ["done", "failed", "queued", "enqueued"]);
            }

            try {
              await sb.from("auto_heal_log").insert({
                action_type: "qg_auto_heal_reseed",
                trigger_source: "job-runner",
                target_type: "package_step",
                target_id: packageId,
                result_status: "ok",
                result_detail: `${job.job_type} QG fail → reset ${predecessorStep} (cycle ${healCycles + 1}) [diagnosis: ${reseedDiagnosis}]`,
                metadata: { step: job.job_type, step_key: validationStepKey, predecessor: predecessorStep, heal_cycles: healCycles + 1, missing_lf_ids: missingLfIds, trigger: hasMissingCoverage ? "MISSING_LF_COVERAGE" : shouldForceReseed ? "RESEED_REQUIRED" : "max_attempts", issues: parsed.issues?.slice(0, 5), no_pending_questions: parsed?.no_pending_questions === true, diagnosis: reseedDiagnosis },
              });
            } catch (_e) { /* best-effort */ }

            // Complete the job (not requeue) — the step system handles the rest
            finalState = {
              status: "completed",
              patch: {
                result: typeof parsed === "object" ? parsed : { raw: parsed },
                completed_at: tsNow,
                attempts: newAttempts,
                error: `QG FAIL → triggered re-seed cycle ${healCycles + 1}`,
              },
            };
          }
        } else if (newAttempts >= maxAttempts) {
          // Terminal failure for non-validation jobs
          finalState = {
            status: "failed",
            patch: {
              error: `QG FAIL (${newAttempts}/${maxAttempts}): ${issuesSummary}`,
              result: typeof parsed === "object" ? parsed : { raw: parsed },
              completed_at: tsNow,
              attempts: newAttempts,
            },
          };
        } else {
          // Requeue with backoff (for jobs that haven't exhausted attempts yet)
          finalState = {
            status: "pending",
            patch: {
              run_after: new Date(Date.now() + 60_000).toISOString(),
              error: `QG FAIL attempt ${newAttempts}/${maxAttempts}: ${issuesSummary}`,
              result: typeof parsed === "object" ? parsed : { raw: parsed },
              attempts: newAttempts,
              meta: { ...(job.meta || {}), last_qg_fail: tsNow },
            },
          };
        }
      }
      // ── 4b. Graceful skip/retry: ok=false WITHOUT batch_complete ──
      // Edge functions return ok=false with retry/skipped/permanent signals
      // for prereq-not-met, non-building status, backlog-gate, etc.
      // These MUST NOT fall through to the Completed path + MATERIALIZATION_GUARD.
      else if (parsed && parsed.ok === false && parsed.batch_complete === undefined) {
        if (parsed.skipped === true) {
          // Skipped (e.g. non-building package) — mark completed without artifact check
          console.log(`[job-runner] ${fnName} SKIPPED: ${parsed.reason || parsed.error || "no reason"}`);
          finalState = {
            status: "completed",
            patch: {
              result: typeof parsed === "object" ? parsed : { raw: parsed },
              completed_at: tsNow,
              meta: { ...(job.meta || {}), skipped: true, skip_reason: parsed.reason || parsed.error },
            },
          };
        } else if (parsed.retry === true || parsed.transient === true) {
          // Transient/prereq — requeue with backoff (don't burn attempt budget)
          const backoffMs = (parsed.backoff_seconds || 60) * 1000;
          console.log(`[job-runner] ${fnName} RETRY: ${parsed.error || "transient"} → requeue +${backoffMs}ms`);
          finalState = {
            status: "pending",
            patch: {
              run_after: new Date(Date.now() + backoffMs).toISOString(),
              error: parsed.error || "edge_function_retry",
              result: typeof parsed === "object" ? parsed : { raw: parsed },
              meta: { ...(job.meta || {}), last_retry: tsNow },
            },
          };
        } else if (parsed.permanent === true) {
          const permAttempts = (job.attempts || 0) + 1;
          console.warn(`[job-runner] ${fnName} PERMANENT: ${parsed.error || "permanent_error"} (attempt ${permAttempts}/${job.max_attempts || 25})`);
          finalState = {
            status: "failed",
            patch: {
              error: parsed.error || "permanent_error",
              completed_at: tsNow,
              attempts: permAttempts,
              result: typeof parsed === "object" ? parsed : { raw: parsed },
            },
          };
        } else {
          // Generic ok=false — attempt-based retry
          const newAttempts = (job.attempts || 0) + 1;
          const maxAttempts = job.max_attempts || 3;
          console.warn(`[job-runner] ${fnName} ok=false: ${parsed.error || "unknown"} (attempt ${newAttempts}/${maxAttempts})`);
          if (newAttempts >= maxAttempts) {
            finalState = {
              status: "failed",
              patch: {
                error: `${parsed.error || "edge_function_failed"} (${newAttempts}/${maxAttempts})`,
                completed_at: tsNow,
                attempts: newAttempts,
                result: typeof parsed === "object" ? parsed : { raw: parsed },
              },
            };
          } else {
            finalState = {
              status: "pending",
              patch: {
                run_after: new Date(Date.now() + computeErrorBackoffMs(newAttempts)).toISOString(),
                error: `${parsed.error || "edge_function_retry"} — attempt ${newAttempts}/${maxAttempts}`,
                attempts: newAttempts,
                result: typeof parsed === "object" ? parsed : { raw: parsed },
                meta: { ...(job.meta || {}), last_retry: tsNow },
              },
            };
          }
        }
      }
      // ── 5. Completed ───────────────────────────────────────────────
      else {
        // ── Auto-heal trigger: if content generation completed with poison pills, enqueue heal job ──
        if (job.job_type === "package_generate_learning_content" && parsed?.poison_pills_skipped > 0) {
          const poisonIds = Object.keys(parsed._poison_pills || {});
          if (poisonIds.length > 0) {
            console.log(`[job-runner] Content gen completed with ${poisonIds.length} poison pills → enqueueing heal job`);
            try {
              await enqueueJob(sb, {
                job_type: "heal_poison_lessons",
                package_id: job.payload?.package_id || job.package_id,
                max_attempts: 2,
                payload: {
                  package_id: job.payload?.package_id || job.package_id,
                  course_id: job.payload?.course_id,
                  curriculum_id: job.payload?.curriculum_id || job.payload?.certification_id,
                  poison_lesson_ids: poisonIds,
                },
              });
            } catch (healErr) {
              console.warn(`[job-runner] Failed to enqueue heal job:`, healErr);
            }
          }
        }

        // Clear transient metadata on successful completion
        const cleanedMeta = { ...(job.meta || {}) };
        delete cleanedMeta.transient_attempts;
        delete cleanedMeta.transient_first_at;
        delete cleanedMeta.transient_exhausted;
        delete cleanedMeta.last_transient_error;
        delete cleanedMeta.last_transient_at;

        // ── MATERIALIZATION GUARD: verify artifact exists before completing ──
        const artifactCheck = await verifyArtifact(sb, job);
        const auditMeta = buildVerifyAuditMeta(artifactCheck);

        if (!artifactCheck.ok) {
          console.warn(`[job-runner] MATERIALIZATION_GUARD: ${job.job_type} blocked — ${artifactCheck.reason} (count=${artifactCheck.count ?? "n/a"})`);
          if (artifactCheck.permanent) {
            finalState = {
              status: "failed",
              patch: {
                error: `MATERIALIZATION_GUARD: ${artifactCheck.reason}`,
                result: typeof parsed === "object" ? parsed : { raw: parsed },
                completed_at: tsNow,
                meta: { ...cleanedMeta, ...auditMeta },
              },
            };
          } else {
            const matRetries = ((job.meta?.materialization_retries ?? 0) as number) + 1;
            if (matRetries >= 3) {
              finalState = {
                status: "failed",
                patch: {
                  error: `MATERIALIZATION_GUARD: ${artifactCheck.reason} — exhausted after 3 retries`,
                  completed_at: tsNow,
                  meta: { ...cleanedMeta, ...auditMeta, materialization_retries: matRetries },
                },
              };
            } else {
              finalState = {
                status: "pending",
                patch: {
                  run_after: new Date(Date.now() + 90_000).toISOString(),
                  error: `MATERIALIZATION_GUARD: ${artifactCheck.reason} — retry ${matRetries}/3`,
                  result: typeof parsed === "object" ? parsed : { raw: parsed },
                  meta: { ...cleanedMeta, ...auditMeta, materialization_retries: matRetries },
                },
              };
            }
          }
        } else {
          finalState = {
            status: "completed",
            patch: {
              result: typeof parsed === "object" ? parsed : { raw: parsed },
              completed_at: tsNow,
              error: null,
              meta: { ...cleanedMeta, ...auditMeta },
            },
            metricsAction: "completed",
          };
          tickMetrics.completed++;
          tickMetrics.totalLatencyMs += elapsedMs;
        }
      }

    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      const isTimeout = msg.includes("abort") || msg.includes("timeout") || msg.includes("TIMEOUT");
      const isTransientCatch = isTimeout ||
        msg.includes("fetch failed") || msg.includes("connection") ||
        msg.includes("network") || msg.includes("ECONNRESET");
      console.error(`[job-runner] ${fnName} error (transient=${isTransientCatch}): ${msg}`);

      if (isTimeout) tickMetrics.timeouts++;

      // v5.10+: Transient catch errors (timeouts, network) do NOT burn attempt budget
      // v6.1: Transient exhaustion gate — cap at MAX_TRANSIENT_ATTEMPTS
      if (isTransientCatch) {
        const ta = Number((job.meta as any)?.transient_attempts ?? 0) + 1;
        const transientFirstAt = (job.meta as any)?.transient_first_at ?? tsNow;
        const windowElapsed = Date.now() - new Date(transientFirstAt).getTime();
        const delay = isTimeout ? BACKOFF_429_MS : computeErrorBackoffMs(ta);

        if (ta >= MAX_TRANSIENT_ATTEMPTS && windowElapsed < TRANSIENT_WINDOW_MS) {
          console.error(`[job-runner] ${fnName} TRANSIENT_EXHAUSTED (catch): ${ta} retries in ${Math.round(windowElapsed / 1000)}s → failed`);
          finalState = {
            status: "failed",
            patch: {
              error: `TRANSIENT_EXHAUSTED: ${ta} retries (catch: ${msg.slice(0, 100)}) in ${Math.round(windowElapsed / 60000)}min`,
              completed_at: tsNow,
              attempts: (job.attempts || 0) + 1,
              meta: { ...(job.meta || {}), transient_attempts: ta, transient_exhausted: true, transient_first_at: transientFirstAt },
            },
            metricsAction: "dlq",
          };
        } else {
          const effectiveFirstAt = windowElapsed >= TRANSIENT_WINDOW_MS ? tsNow : transientFirstAt;
          const effectiveTa = windowElapsed >= TRANSIENT_WINDOW_MS ? 1 : ta;

          console.warn(`[job-runner] ${fnName} transient catch → requeue WITHOUT attempt++ (ta=${effectiveTa}/${MAX_TRANSIENT_ATTEMPTS}, +${delay}ms)`);
          finalState = {
            status: "pending",
            patch: {
              run_after: new Date(Date.now() + delay).toISOString(),
              error: `Transient: ${msg.slice(0, 500)}`,
              meta: {
                ...(job.meta || {}),
                last_retry: tsNow,
                transient_attempts: effectiveTa,
                transient_first_at: effectiveFirstAt,
                last_transient_error: msg.slice(0, 200),
                last_transient_at: tsNow,
              },
            },
          };
        }
      } else {
        const maxAttempts = job.max_attempts || 3;
        const newAttempts = (job.attempts || 0) + 1;
        if (newAttempts >= maxAttempts) {
          finalState = {
            status: "failed",
            patch: {
              error: msg.slice(0, 1000),
              completed_at: tsNow,
              attempts: newAttempts,
            },
            metricsAction: (job.job_type === "package_generate_exam_pool" || job.job_type === "generate_questions") ? "dlq" : undefined,
          };
        } else {
          const delay = computeErrorBackoffMs(newAttempts);
          finalState = {
            status: "pending",
            patch: {
              run_after: new Date(Date.now() + delay).toISOString(),
              error: `Attempt ${newAttempts}/${maxAttempts} failed: ${msg.slice(0, 500)}`,
              attempts: newAttempts,
              meta: { ...(job.meta || {}), last_retry: tsNow },
            },
          };
        }
      }
    }

    // ── SINGLE EXIT: Guaranteed DB write with lock release ──────────
    if (finalState) {
      // Normalize: patch uses 'error' but DB column is 'last_error'
      const { error: patchError, ...restPatch } = finalState.patch;
      const dbPatch: Record<string, unknown> = {
        status: finalState.status,
        ...restPatch,
        ...lockRelease(tsNow),
      };
      if (patchError !== undefined) {
        dbPatch.last_error = patchError;
      }
      await sb.from("job_queue").update(dbPatch).eq("id", job.id);

      // ── STEP SYNC: Update package_steps on permanent/terminal failures ──
      // Without this, steps stay in 'enqueued'/'queued' and stuck-scan
      // re-creates failed jobs infinitely.
      if (finalState.status === "failed" && job.payload?.package_id) {
        const stepKey = job.job_type?.replace(/^package_/, "");
        if (stepKey) {
          const failError = String(patchError ?? "job_failed").slice(0, 2000);
          try {
            await sb.from("package_steps").update({
              status: "failed",
              last_error: `Job failed: ${failError}`,
              started_at: tsNow,
              updated_at: tsNow,
            }).eq("package_id", job.payload.package_id).eq("step_key", stepKey)
              .in("status", ["enqueued", "queued", "running"]);
          } catch (_stepErr) {
            console.warn(`[job-runner] Could not sync step ${stepKey} to failed: ${(_stepErr as Error)?.message}`);
          }
        }
      }

      // DLQ write for failed exam pool / question generation
      if (finalState.metricsAction === "dlq") {
        tickMetrics.dlqItems++;
        await writeToDLQ(sb, job, "hard_failure", String(finalState.patch.error ?? "").slice(0, 1000));
      }

      // Update last_progress_at on batch_incomplete to prevent false stuck alerts
      if (finalState.status === "pending" && finalState.patch.batch_cursor !== undefined && job.payload?.package_id) {
        try {
          await sb.from("course_packages").update({
            last_progress_at: tsNow,
          }).eq("id", job.payload.package_id);
        } catch (_e) { /* best-effort */ }
      }

      results.push({
        id: job.id,
        status: finalState.status === "pending" ? "requeued" : finalState.status,
        function: fnName,
      });
    }
  } // end for-each job

  // ── 5. Write concurrency snapshot ──────────────────────────────────
  const action = (tickMetrics.timeouts >= THROTTLE_TIMEOUT_THRESHOLD || tickMetrics.rateLimits >= THROTTLE_RATELIMIT_THRESHOLD)
    ? "throttle_down"
    : tickMetrics.dlqItems > 0 ? "degraded" : "stable";

  await writeSnapshot(sb, tickMetrics, adaptiveConcurrency, action);

  console.log(`[job-runner] Tick done [w=${WORKER_ID} c=${adaptiveConcurrency}]: ${JSON.stringify(results)}`);
  return json({
    ok: true,
    processed: results.length,
    concurrency: adaptiveConcurrency,
    worker: WORKER_ID,
    metrics: {
      completed: tickMetrics.completed,
      timeouts: tickMetrics.timeouts,
      rateLimits: tickMetrics.rateLimits,
      dlqItems: tickMetrics.dlqItems,
    },
    results,
  });
});
