import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * job-runner — Atomically claims pending jobs via claim_pending_jobs RPC
 * (FOR UPDATE SKIP LOCKED), dispatches to Edge Functions, writes back
 * completed / failed / pending+run_after (backoff).
 *
 * v4: Adaptive Concurrency Controller + Dead-Letter Queue
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
  council_propose_step: "council-worker",
  council_critique_step: "council-worker",
  council_revise_step: "council-worker",
  council_vote_and_verdict: "council-worker",
  council_publish_step: "council-worker",
  council_recompute_course_ready: "council-worker",
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
  package_auto_seed_exam_blueprints: "package-auto-seed-exam-blueprints",
  package_generate_exam_pool: "package-generate-exam-pool",
  package_generate_oral_exam: "package-generate-oral-exam",
  package_build_ai_tutor_index: "package-build-ai-tutor-index",
  package_generate_handbook: "package-generate-handbook",
  package_run_integrity_check: "package-run-integrity-check",
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
};

// ── Adaptive Concurrency Constants ──────────────────────────────────
const BASE_CONCURRENCY = 12;
const MIN_CONCURRENCY = 6;
const MAX_CONCURRENCY = 18;
const JOB_TIMEOUT_MS = 140_000;

// Backoff delays (ms) for requeue scenarios
const BACKOFF_409_MS = 30_000;
const BACKOFF_429_MS = 60_000;
const BACKOFF_BATCH_MS = 3_000;
const BACKOFF_ERROR_MS = 30_000;

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

/** Requeue a job as pending with a run_after backoff */
async function requeueWithBackoff(
  sb: ReturnType<typeof createClient>,
  jobId: string,
  meta: Record<string, unknown> | null,
  delayMs: number,
  errorMsg: string,
) {
  await sb.from("job_queue").update({
    status: "pending",
    run_after: new Date(Date.now() + delayMs).toISOString(),
    error: errorMsg,
    meta: { ...(meta || {}), last_retry: new Date().toISOString() },
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
  // Read last snapshot to get current concurrency level
  const { data: lastSnapshot } = await sb.from("concurrency_snapshots")
    .select("active_concurrency, snapshot_at, action_taken")
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastSnapshot) return BASE_CONCURRENCY;

  const current = lastSnapshot.active_concurrency ?? BASE_CONCURRENCY;

  // Read rolling 5-min failure metrics from job_queue
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

  // Decision logic
  if (timeouts >= THROTTLE_TIMEOUT_THRESHOLD || rateLimits >= THROTTLE_RATELIMIT_THRESHOLD) {
    // Throttle down
    const newConcurrency = Math.max(MIN_CONCURRENCY, current - 3);
    console.log(`[Adaptive] THROTTLE: timeouts=${timeouts} rateLimits=${rateLimits} → ${current}→${newConcurrency}`);
    return newConcurrency;
  }

  // Check if stable for ramp-up (last N snapshots all "stable")
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
    jobs_per_min: metrics.completed, // approximation per tick
    median_latency_ms: medianLatency,
    active_concurrency: activeConcurrency,
    action_taken: action,
  }).then(() => {}, () => {}); // fire-and-forget
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

  // ── 0. Adaptive Concurrency: determine current tick size ──────────
  const adaptiveConcurrency = await getAdaptiveConcurrency(sb).catch(() => BASE_CONCURRENCY);

  // ── 1. Atomically claim pending jobs (SKIP LOCKED + run_after) ──
  const { data: jobs, error: claimErr } = await sb.rpc("claim_pending_jobs", {
    p_limit: adaptiveConcurrency,
  });

  if (claimErr) {
    console.error("[job-runner] claim_pending_jobs error:", claimErr.message);
    return json({ ok: false, error: claimErr.message }, 500);
  }

  if (!jobs || jobs.length === 0) {
    return json({ ok: true, processed: 0, concurrency: adaptiveConcurrency, message: "No pending jobs" });
  }

  console.log(`[job-runner] Claimed ${jobs.length} job(s) [concurrency=${adaptiveConcurrency}]`);

  const results: Record<string, unknown>[] = [];
  const tickMetrics: TickMetrics = {
    timeouts: 0, rateLimits: 0, escalations: 0, dlqItems: 0,
    completed: 0, totalLatencyMs: 0,
  };

  for (const job of jobs) {
    const fnName = JOB_TYPE_MAP[job.job_type];
    if (!fnName) {
      console.warn(`[job-runner] Unknown job_type: ${job.job_type}, skipping`);
      await sb.from("job_queue").update({
        status: "failed",
        error: `Unknown job_type: ${job.job_type}`,
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);
      results.push({ id: job.id, status: "failed", reason: "unknown_type" });
      continue;
    }

    const startMs = Date.now();

    // ── 2. Invoke the target Edge Function ───────────────────────────
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS);

      const payload = {
        ...(job.payload || {}),
        ...(job.batch_cursor ? { _batch_cursor: job.batch_cursor, batch_cursor: job.batch_cursor } : {}),
        _job_id: job.id,
        _job_type: job.job_type,
      };

      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: SERVICE_ROLE_KEY,
          authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
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
          const isIdempotent = parsed?.skipped || parsed?.retry === false || parsed?.ok === true;
          if (isIdempotent || !parsed?.retry) {
            console.log(`[job-runner] ${fnName} 409 idempotent → completed`);
            await sb.from("job_queue").update({
              status: "completed",
              result: { ...(typeof parsed === "object" ? parsed : {}), _409_idempotent: true },
              completed_at: new Date().toISOString(),
            }).eq("id", job.id);
            tickMetrics.completed++;
            tickMetrics.totalLatencyMs += elapsedMs;
            results.push({ id: job.id, status: "completed", reason: "409_idempotent" });
            continue;
          }
          console.warn(`[job-runner] ${fnName} 409 retry=true → requeue +${BACKOFF_409_MS}ms`);
          await requeueWithBackoff(sb, job.id, job.meta, BACKOFF_409_MS,
            "HTTP 409 — prereq not ready, will retry");
          results.push({ id: job.id, status: "requeued", httpStatus: 409 });
          continue;
        }

        // ── Rate-limited or transient → requeue with delay ───────────
        if (res.status === 429 || res.status === 503) {
          tickMetrics.rateLimits++;
          console.warn(`[job-runner] ${fnName} ${res.status} → requeue +${BACKOFF_429_MS}ms`);
          await requeueWithBackoff(sb, job.id, job.meta, BACKOFF_429_MS,
            `HTTP ${res.status} — will retry`);
          results.push({ id: job.id, status: "requeued", httpStatus: res.status });
          continue;
        }

        // ── Hard failure ─────────────────────────────────────────────
        const maxAttempts = job.max_attempts || 3;
        const errStr = typeof parsed === "string" ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500);
        if ((job.attempts || 0) >= maxAttempts) {
          await sb.from("job_queue").update({
            status: "failed",
            error: `HTTP ${res.status}: ${errStr}`,
            completed_at: new Date().toISOString(),
          }).eq("id", job.id);

          // DLQ for exam-pool jobs
          if (job.job_type === "package_generate_exam_pool" || job.job_type === "generate_questions") {
            tickMetrics.dlqItems++;
            await writeToDLQ(sb, job, `http_${res.status}`, errStr);
          }

          results.push({ id: job.id, status: "failed", httpStatus: res.status });
        } else {
          await requeueWithBackoff(sb, job.id, job.meta, BACKOFF_ERROR_MS,
            `HTTP ${res.status} — attempt ${job.attempts || 1}`);
          results.push({ id: job.id, status: "requeued", httpStatus: res.status });
        }
        continue;
      }

      // ── 3. Handle batch_complete protocol ──────────────────────────
      if (parsed && parsed.batch_complete === false) {
        console.log(`[job-runner] ${fnName} batch incomplete → requeue +${BACKOFF_BATCH_MS}ms`);
        await sb.from("job_queue").update({
          status: "pending",
          run_after: new Date(Date.now() + BACKOFF_BATCH_MS).toISOString(),
          batch_cursor: parsed.batch_cursor ?? null,
          meta: { ...(job.meta || {}), last_batch: new Date().toISOString() },
        }).eq("id", job.id);
        results.push({ id: job.id, status: "requeued", reason: "batch_incomplete" });
        continue;
      }

      // ── 4. Completed ───────────────────────────────────────────────
      await sb.from("job_queue").update({
        status: "completed",
        result: typeof parsed === "object" ? parsed : { raw: parsed },
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);

      tickMetrics.completed++;
      tickMetrics.totalLatencyMs += elapsedMs;
      results.push({ id: job.id, status: "completed", function: fnName });

    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      const isTimeout = msg.includes("abort");
      const elapsedMs = Date.now() - startMs;
      console.error(`[job-runner] ${fnName} error: ${msg}`);

      if (isTimeout) tickMetrics.timeouts++;

      const maxAttempts = job.max_attempts || 3;
      if ((job.attempts || 0) >= maxAttempts) {
        await sb.from("job_queue").update({
          status: "failed",
          error: isTimeout ? "Edge Function timeout" : msg.slice(0, 1000),
          completed_at: new Date().toISOString(),
        }).eq("id", job.id);

        // DLQ for exam-pool jobs
        if (job.job_type === "package_generate_exam_pool" || job.job_type === "generate_questions") {
          tickMetrics.dlqItems++;
          await writeToDLQ(sb, job, isTimeout ? "timeout" : "hard_failure", msg.slice(0, 1000));
        }

        results.push({ id: job.id, status: "failed", reason: isTimeout ? "timeout" : "error" });
      } else {
        const delay = isTimeout ? BACKOFF_429_MS : BACKOFF_ERROR_MS;
        await requeueWithBackoff(sb, job.id, job.meta, delay,
          `Attempt ${job.attempts || 1} failed: ${msg.slice(0, 500)}`);
        results.push({ id: job.id, status: "requeued", reason: isTimeout ? "timeout" : "error" });
      }
    }
  }

  // ── 5. Write concurrency snapshot ──────────────────────────────────
  const action = (tickMetrics.timeouts >= THROTTLE_TIMEOUT_THRESHOLD || tickMetrics.rateLimits >= THROTTLE_RATELIMIT_THRESHOLD)
    ? "throttle_down"
    : tickMetrics.dlqItems > 0 ? "degraded" : "stable";

  await writeSnapshot(sb, tickMetrics, adaptiveConcurrency, action);

  console.log(`[job-runner] Tick done [c=${adaptiveConcurrency}]: ${JSON.stringify(results)}`);
  return json({
    ok: true,
    processed: results.length,
    concurrency: adaptiveConcurrency,
    metrics: {
      completed: tickMetrics.completed,
      timeouts: tickMetrics.timeouts,
      rateLimits: tickMetrics.rateLimits,
      dlqItems: tickMetrics.dlqItems,
    },
    results,
  });
});
