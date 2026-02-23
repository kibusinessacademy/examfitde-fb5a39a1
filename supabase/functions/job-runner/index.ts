import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

const JOB_TYPE_MAP: Record<string, string> = {
  extract_curriculum: "extract-curriculum",
  generate_curriculum_content: "generate-curriculum-content",
  setup_course_package: "setup-course-package",
  generate_course: "generate-course",
  generate_course_batch: "generate-course-batch",
  seed_exam_questions: "generate-blueprint-questions",
  enrich_exam_solutions: "blooms-taxonomy",
  upgrade_minichecks_v1: "regenerate-minichecks",
  quality_gate_precheck: "run-quality-checks",
  curriculum_smoke: "run-quality-checks",
  qc_worker_full: "qc-worker",
  quality_gate_7: "quality-gate-check",
  seo_foundation: "generate-seo-slug",
  seo_audit: "ihk-quality-audit",
  seo_internal_links: "seo-internal-linker",
  seo_sitemap_refresh: "generate-sitemap",
  seo_generate: "seo-generate",
  seo_qc_check: "seo-qc-check",
  seo_publish: "seo-publish",
  seo_content_batch: "seo-generate",
  publish_product: "product-orchestrator",
  repair_lessons: "repair-lessons",
  improve_lesson: "improve-lesson",
  validate_content: "validate-content",
  upgrade_ihk: "course-upgrade-ihk",
  assessment_blueprint_propose: "assessment-council-run",
  assessment_blueprint_critique: "assessment-council-run",
  assessment_blueprint_verdict: "assessment-council-run",
  assessment_blueprint_approve: "assessment-council-run",
  assessment_questions_generate: "assessment-council-run",
  assessment_questions_critique: "assessment-council-run",
  assessment_questions_verdict: "assessment-council-run",
  assessment_questions_approve: "assessment-council-run",
  assessment_minicheck_assemble: "assessment-council-run",
  assessment_minicheck_critique: "assessment-council-run",
  assessment_minicheck_verdict: "assessment-council-run",
  assessment_minicheck_approve: "assessment-council-run",
  course_finalize: "course-finalizer",
  post_validation: "post-validation",
  council_run_step: "council-run-step",
  council_propose_step: "council-run-step",
  council_critique_step: "council-run-step",
  council_revise_step: "council-run-step",
  council_vote_and_verdict: "council-run-step",
  council_publish_step: "council-run-step",
  council_recompute_course_ready: "council-run-step",
  tech_scan_rls: "tech-council-run",
  tech_scan_edge: "tech-council-run",
  tech_scan_queue: "tech-council-run",
  tech_propose_patch: "tech-council-run",
  tech_validate_patch: "tech-council-run",
  tech_full_pipeline: "tech-council-run",
  marketing_seed_assets: "marketing-council-run",
  marketing_propose: "marketing-council-run",
  marketing_critique: "marketing-council-run",
  marketing_revise: "marketing-council-run",
  marketing_verdict: "marketing-council-run",
  marketing_publish: "marketing-council-run",
  marketing_full_pipeline: "marketing-council-run",
  tutor_seed_assets: "tutor-council-run",
  tutor_council_run_asset: "tutor-council-run",
  tutor_backfill_assets_for_course: "tutor-council-run",
  tutor_validate_runtime_templates: "tutor-council-run",
  tutor_oral_exam_propose: "tutor-council-run",
  tutor_oral_exam_critique: "tutor-council-run",
  tutor_oral_exam_verdict: "tutor-council-run",
  tutor_feedback_propose: "tutor-council-run",
  tutor_feedback_critique: "tutor-council-run",
  tutor_feedback_verdict: "tutor-council-run",
  compliance_scan: "compliance-council-scan",
  compliance_scan_pii: "compliance-council-scan",
  compliance_scan_rls: "compliance-council-scan",
  compliance_scan_retention: "compliance-council-scan",
  compliance_scan_ai_act: "compliance-council-scan",
  compliance_scan_azav: "compliance-council-scan",
  compliance_recompute_block: "compliance-council-scan",
  compliance_remediate: "compliance-council-remediate",
  compliance_report: "compliance-council-report",
  compliance_export_pdf: "compliance-council-export-pdf",
  growth_run: "growth-council-run",
  growth_actions_api: "growth-actions-api",
  finance_reconcile: "finance-council-reconcile",
  finance_export_csv: "finance-export-csv",
  finance_export_datev: "finance-export-datev",
  qa_smoke: "qa-council-smoke",
  qa_runtime_smoke: "qa-council-runtime-smoke",
  qa_h5p_smoke: "qa-council-h5p-smoke",
  qa_error_budget: "qa-council-error-budget",
  claim_license_secure: "claim-license-secure",
  security_gate_check: "security-gate-check",
  security_botnet_gate: "security-botnet-gate",
  package_queue_next: "package-queue-next",
  package_scaffold_learning_course: "package-scaffold-learning-course",
  package_generate_glossary: "package-generate-glossary",
  package_generate_learning_content: "package-generate-learning-content",
  package_auto_seed_exam_blueprints: "package-auto-seed-exam-blueprints",
  package_validate_blueprints: "package-validate-blueprints",
  package_generate_exam_pool: "package-generate-exam-pool",
  package_validate_exam_pool: "package-validate-exam-pool",
  package_generate_oral_exam: "package-generate-oral-exam",
  package_validate_oral_exam: "package-validate-oral-exam",
  package_build_ai_tutor_index: "package-build-ai-tutor-index",
  package_validate_tutor_index: "package-validate-tutor-index",
  package_generate_handbook: "package-generate-handbook",
  package_validate_handbook: "package-validate-handbook",
  package_run_integrity_check: "package-run-integrity-check",
  package_validate_learning_content: "package-validate-learning-content",
  package_auto_publish: "package-auto-publish",
  package_quality_council: "package-quality-council",
  auto_gap_close: "auto-gap-close",
  generate_image: "generate-image",
  daily_test_run: "daily-test-runner",
  generate_questions: "generate-questions",
  auto_map_topics_to_blueprint: "auto-map-topics-to-blueprint",
  blooms_classify: "blooms-taxonomy",
  package_curriculum_ingest: "package-curriculum-ingest",
  ingest_curriculum_document: "ingest-curriculum-document",
  generate_handbook: "package-generate-handbook",
  heal_poison_lessons: "heal-poison-lessons",
  rework_trap_retrofit: "pool-rework-trap-retrofit",
  pool_fill_lf_gaps: "pool-fill-lf-gaps",
};

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
const BACKOFF_BATCH_MS = 3_000;
const BACKOFF_ERROR_MS = 30_000;
const BACKOFF_PREREQ_MS = 20_000;

// ── Function versioning (for deployment forensics) ──────────────────
const FUNCTION_VERSION = "v5.2";
const DEPLOYED_AT = "2026-02-21T16:00:00Z";

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

  return current;
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

  await sb.from("concurrency_snapshots").insert({
    timeouts_5min: metrics.timeouts,
    rate_limits_5min: metrics.rateLimits,
    escalations_5min: metrics.escalations,
    dlq_count_5min: metrics.dlqItems,
    jobs_per_min: metrics.completed,
    median_latency_ms: medianLatency,
    active_concurrency: activeConcurrency,
    action_taken: action,
  }).then(() => {}, () => {});
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

  // ── 0. Adaptive Concurrency ──────────────────────────────────────
  const adaptiveConcurrency = await getAdaptiveConcurrency(sb).catch(() => BASE_CONCURRENCY);

  // ── 1. Claim jobs with proper locking (worker_id + lock timeout) ──
  // v5.3: Increased lock timeout from 10→20min to prevent STALE_LOCK kills
  // on long-running AI jobs (exam-pool with 58+ questions, glossary gen).
  const { data: jobs, error: claimErr } = await sb.rpc("claim_pending_jobs", {
    p_limit: adaptiveConcurrency,
    p_worker_id: WORKER_ID,
    p_lock_timeout_minutes: 20,
  });

  if (claimErr) {
    console.error("[job-runner] claim_pending_jobs error:", claimErr.message);
    return json({ ok: false, error: claimErr.message }, 500);
  }

  if (!jobs || jobs.length === 0) {
    return json({ ok: true, processed: 0, concurrency: adaptiveConcurrency, worker: WORKER_ID, message: "No pending jobs" });
  }

  console.log(`[job-runner] Claimed ${jobs.length} job(s) [concurrency=${adaptiveConcurrency}, worker=${WORKER_ID}, version=${FUNCTION_VERSION}]`);

  const results: Record<string, unknown>[] = [];
  const tickMetrics: TickMetrics = {
    timeouts: 0, rateLimits: 0, escalations: 0, dlqItems: 0,
    completed: 0, totalLatencyMs: 0,
  };

  // ── Pipeline prerequisite map ──────────────────────────────────────
  // Each entry lists prerequisite(s) in priority order.
  // The guard checks the FIRST prereq that actually exists as a step
  // in the package — this makes the chain track-aware so EXAM_FIRST
  // packages don't deadlock on missing handbook/learning steps.
  const PIPELINE_PREREQS: Record<string, string[]> = {
    package_generate_exam_pool: ["validate_blueprints"],
    package_validate_exam_pool: ["generate_exam_pool"],
    package_build_ai_tutor_index: ["validate_exam_pool"],
    package_validate_tutor_index: ["build_ai_tutor_index"],
    package_generate_oral_exam: ["validate_tutor_index"],
    package_validate_oral_exam: ["generate_oral_exam"],
    package_generate_handbook: ["validate_oral_exam"],
    package_validate_handbook: ["generate_handbook"],
    // Track-aware: integrity_check needs the LAST validation step that exists.
    // For EXAM_FIRST (no handbook): validate_oral_exam.
    // For AUSBILDUNG_VOLL: validate_handbook.
    package_run_integrity_check: ["validate_handbook", "validate_oral_exam", "validate_tutor_index"],
    package_quality_council: ["run_integrity_check"],
    package_auto_publish: ["quality_council"],
  };

  for (const job of jobs) {
    // ── Generate ONE timestamp per job transition ──────────────────
    const tsNow = new Date().toISOString();

    const fnName = JOB_TYPE_MAP[job.job_type];
    if (!fnName) {
      console.error(`[job-runner] ❌ Unknown job_type: ${job.job_type} — hard-failing (add to JOB_TYPE_MAP!)`);
      await sb.from("job_queue").update({
        status: "failed",
        error: `Unknown job_type: ${job.job_type}. Add mapping to JOB_TYPE_MAP in job-runner.`,
        completed_at: tsNow,
        max_attempts: 1,
        ...lockRelease(tsNow),
      }).eq("id", job.id);
      results.push({ id: job.id, status: "failed", reason: "unknown_type" });
      continue;
    }

    // ── Prereq guard (track-aware) ─────────────────────────────────────
    const prereqCandidates = PIPELINE_PREREQS[job.job_type];
    if (prereqCandidates && job.payload?.package_id) {
      // Load all steps for this package to find which prereq actually exists
      const { data: allSteps } = await sb
        .from("package_steps")
        .select("step_key, status")
        .eq("package_id", job.payload.package_id);

      const stepMap = new Map((allSteps || []).map((s: any) => [s.step_key, s.status]));

      // Find the first prereq that actually exists as a step in this package
      const prereqStep = prereqCandidates.find(p => stepMap.has(p));

      if (prereqStep) {
        const prereqStatus = stepMap.get(prereqStep);
        // "skipped" counts as fulfilled — the step was intentionally bypassed by track logic
        if (prereqStatus !== "done" && prereqStatus !== "skipped") {
          // FIX v5.2: Requeue instead of cancel — prereq may finish soon, cancelling causes zombie steps
          console.warn(`[job-runner] Prereq guard: ${job.job_type} requeued — ${prereqStep} is '${prereqStatus ?? 'missing'}' (pkg ${(job.payload.package_id as string).slice(0, 8)})`);
          await requeueWithBackoff(sb, job.id, job.meta, BACKOFF_PREREQ_MS,
            `Prereq guard: ${prereqStep} not done (${prereqStatus ?? 'missing'})`, tsNow);
          results.push({ id: job.id, status: "requeued", reason: "prereq_not_done" });
          continue;
        }
      }
    }

    // ── Pre-execution lease guard ──────────────────────────────────
    const jobPackageId = job.package_id ?? job.payload?.package_id;
    if (jobPackageId) {
      const { data: leaseRow } = await sb
        .from("package_leases")
        .select("lease_until")
        .eq("package_id", jobPackageId)
        .gt("lease_until", new Date().toISOString())
        .maybeSingle();

      if (!leaseRow) {
        console.warn(`[job-runner] Lease expired before execution for job ${job.id} (pkg ${String(jobPackageId).slice(0, 8)})`);
        await requeueWithBackoff(sb, job.id, job.meta, 60_000, "Lease expired pre-execution", tsNow);
        results.push({ id: job.id, status: "requeued", reason: "lease_expired" });
        continue;
      }
    }

    const startMs = Date.now();

    // ── Single-exit state for guaranteed lock release ─────────────
    type FinalState = {
      status: "completed" | "pending" | "failed" | "cancelled";
      patch: Record<string, unknown>;
      metricsAction?: "completed" | "timeout" | "rateLimit" | "dlq";
      requeue?: boolean;
    };

    let finalState: FinalState | null = null;

    // ── 2. Invoke target Edge Function ───────────────────────────────
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
            console.warn(`[job-runner] ${fnName} 409 retry → requeue +${BACKOFF_409_MS}ms`);
            finalState = {
              status: "pending",
              patch: {
                run_after: new Date(Date.now() + BACKOFF_409_MS).toISOString(),
                error: "HTTP 409 — prereq not ready, will retry",
                meta: { ...(job.meta || {}), last_retry: tsNow },
              },
            };
          }
        }
        // ── Rate-limited / transient ─────────────────────────────────
        else if (res.status === 429 || res.status === 503) {
          console.warn(`[job-runner] ${fnName} ${res.status} → requeue +${BACKOFF_429_MS}ms`);
          finalState = {
            status: "pending",
            patch: {
              run_after: new Date(Date.now() + BACKOFF_429_MS).toISOString(),
              error: `HTTP ${res.status} — will retry`,
              meta: { ...(job.meta || {}), last_retry: tsNow },
            },
            metricsAction: "rateLimit",
          };
        }
        // ── Hard failure ─────────────────────────────────────────────
        else {
          const maxAttempts = job.max_attempts || 3;
          const newAttempts = (job.attempts || 0) + 1;
          const errStr = typeof parsed === "string" ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500);
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
                run_after: new Date(Date.now() + BACKOFF_ERROR_MS).toISOString(),
                error: `HTTP ${res.status} — attempt ${newAttempts}/${maxAttempts}`,
                attempts: newAttempts,
                meta: { ...(job.meta || {}), last_retry: tsNow },
              },
            };
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
      // ── 3. Batch incomplete → requeue ──────────────────────────────
      else if (parsed && parsed.batch_complete === false) {
        console.log(`[job-runner] ${fnName} batch incomplete → requeue +${BACKOFF_BATCH_MS}ms (remaining=${parsed.actionable_remaining ?? parsed.remaining ?? '?'})`);
        // Preserve poison_pills across requeue cycles so content generator can skip persistently-failing lessons
        const poisonPills = parsed._poison_pills || {};
        finalState = {
          status: "pending",
          patch: {
            run_after: new Date(Date.now() + BACKOFF_BATCH_MS).toISOString(),
            batch_cursor: parsed.batch_cursor ?? null,
            meta: { ...(job.meta || {}), last_batch: tsNow, poison_pills_count: Object.keys(poisonPills).length },
            // Merge poison pills into payload for next invocation
            payload: { ...(job.payload || {}), _poison_pills: poisonPills },
          },
        };
      }
      // ── 4. Completed ───────────────────────────────────────────────
      else {
        // ── Auto-heal trigger: if content generation completed with poison pills, enqueue heal job ──
        if (job.job_type === "package_generate_learning_content" && parsed?.poison_pills_skipped > 0) {
          const poisonIds = Object.keys(parsed._poison_pills || {});
          if (poisonIds.length > 0) {
            console.log(`[job-runner] Content gen completed with ${poisonIds.length} poison pills → enqueueing heal job`);
            try {
              await sb.from("job_queue").insert({
                job_type: "heal_poison_lessons",
                status: "pending",
                payload: {
                  package_id: job.payload?.package_id || job.package_id,
                  course_id: job.payload?.course_id,
                  curriculum_id: job.payload?.curriculum_id || job.payload?.certification_id,
                  poison_lesson_ids: poisonIds,
                },
                package_id: job.payload?.package_id || job.package_id,
                max_attempts: 2,
              });
            } catch (healErr) {
              console.warn(`[job-runner] Failed to enqueue heal job:`, healErr);
            }
          }
        }

        finalState = {
          status: "completed",
          patch: {
            result: typeof parsed === "object" ? parsed : { raw: parsed },
            completed_at: tsNow,
          },
          metricsAction: "completed",
        };
        tickMetrics.completed++;
        tickMetrics.totalLatencyMs += elapsedMs;
      }

    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      const isTimeout = msg.includes("abort");
      console.error(`[job-runner] ${fnName} error: ${msg}`);

      if (isTimeout) tickMetrics.timeouts++;

      const maxAttempts = job.max_attempts || 3;
      const newAttempts = (job.attempts || 0) + 1;
      if (newAttempts >= maxAttempts) {
        finalState = {
          status: "failed",
          patch: {
            error: isTimeout ? `Edge Function timeout (attempt ${newAttempts}/${maxAttempts})` : msg.slice(0, 1000),
            completed_at: tsNow,
            attempts: newAttempts,
          },
          metricsAction: (job.job_type === "package_generate_exam_pool" || job.job_type === "generate_questions") ? "dlq" : undefined,
        };
      } else {
        const delay = isTimeout ? BACKOFF_429_MS : BACKOFF_ERROR_MS;
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

    // ── SINGLE EXIT: Guaranteed DB write with lock release ──────────
    if (finalState) {
      await sb.from("job_queue").update({
        status: finalState.status,
        ...finalState.patch,
        ...lockRelease(tsNow),
      }).eq("id", job.id);

      // DLQ write for failed exam pool / question generation
      if (finalState.metricsAction === "dlq") {
        tickMetrics.dlqItems++;
        await writeToDLQ(sb, job, "hard_failure", String(finalState.patch.error ?? "").slice(0, 1000));
      }

      // Update last_progress_at on batch_incomplete to prevent false stuck alerts
      if (finalState.status === "pending" && finalState.patch.batch_cursor !== undefined && job.payload?.package_id) {
        await sb.from("course_packages").update({
          last_progress_at: tsNow,
        }).eq("id", job.payload.package_id).then(() => {}, () => {});
      }

      results.push({
        id: job.id,
        status: finalState.status === "pending" ? "requeued" : finalState.status,
        function: fnName,
      });
    }
  }

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
