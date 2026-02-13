import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const RUNNER_ID = crypto.randomUUID().slice(0, 8);
const LOCK_TIMEOUT_SECONDS = 300;
const BATCH_SIZE = 5;

// ─── JOB TYPE → EDGE FUNCTION MAPPING ───────────────────────────────
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
  package_generate_exam_pool: "package-generate-exam-pool",
  package_generate_oral_exam: "package-generate-oral-exam",
  package_build_ai_tutor_index: "package-build-ai-tutor-index",
  package_generate_handbook: "package-generate-handbook",
  package_run_integrity_check: "package-run-integrity-check",
  package_auto_publish: "package-auto-publish",
  auto_gap_close: "auto-gap-close",
  daily_test_run: "daily-test-runner",
};

// ─── LLM-INTENSIVE JOB TYPES (need concurrency control) ─────────────
const LLM_JOB_TYPES: Set<string> = new Set([
  "generate_curriculum_content",
  "generate_course",
  "generate_course_batch",
  "seed_exam_questions",
  "enrich_exam_solutions",
  "package_generate_exam_pool",
  "package_generate_oral_exam",
  "package_build_ai_tutor_index",
  "package_generate_handbook",
  "improve_lesson",
  "repair_lessons",
  "seo_generate",
  "seo_content_batch",
  "auto_gap_close",
  "assessment_questions_generate",
  "council_propose_step",
  "council_critique_step",
  "council_revise_step",
]);

// Default provider for LLM jobs (if not set in job)
const DEFAULT_LLM_PROVIDER = "openai";

// ─── ERROR CLASSIFICATION ────────────────────────────────────────────
const PERMANENT_FAILURE_PATTERNS = [
  "SSOT_VIOLATION", "INVALID_PAYLOAD", "Missing curriculum_id",
  "Invalid curriculum_id", "not found", "SSOT Guard",
  "BUDGET_STOP", "INTEGRITY_BELOW_THRESHOLD",
];

const TRANSIENT_ERROR_PATTERNS = [
  "rate limit", "too many requests", "429", "timeout",
  "ECONNRESET", "socket hang up", "fetch failed",
];

function isTransientError(error: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some((p) =>
    error.toUpperCase().includes(p.toUpperCase())
  );
}

function isPermanentFailure(error: string): boolean {
  return PERMANENT_FAILURE_PATTERNS.some((p) =>
    error.toUpperCase().includes(p.toUpperCase())
  );
}

function isRateLimitError(error: string): boolean {
  return ["rate limit", "too many requests", "429"].some((p) =>
    error.toUpperCase().includes(p.toUpperCase())
  );
}

// ─── TYPES ───────────────────────────────────────────────────────────
interface JobRecord {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  priority: number;
  provider: string | null;
  scheduled_at: string | null;
  batch_cursor: Record<string, unknown> | null;
}

interface RateLimit {
  provider: string;
  max_concurrent: number;
  cooldown_seconds: number;
  is_paused: boolean;
}

// ─── CONCURRENCY GUARD ──────────────────────────────────────────────
async function canRunLLMJob(
  admin: ReturnType<typeof createClient>,
  provider: string,
  rateLimits: RateLimit[]
): Promise<{ allowed: boolean; cooldown?: number }> {
  const limit = rateLimits.find((r) => r.provider === provider);

  // If provider is paused, delay
  if (limit?.is_paused) {
    return { allowed: false, cooldown: 60 };
  }

  const maxConcurrent = limit?.max_concurrent ?? 2;
  const cooldownSeconds = limit?.cooldown_seconds ?? 120;

  // Count currently processing LLM jobs for this provider
  const { count, error } = await admin
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .eq("provider", provider);

  if (error) {
    console.warn(`[Runner] Error counting running jobs for ${provider}:`, error.message);
    return { allowed: true }; // fail open
  }

  if ((count ?? 0) >= maxConcurrent) {
    return { allowed: false, cooldown: 30 };
  }

  return { allowed: true };
}

// ─── BUDGET CHECK ───────────────────────────────────────────────────
async function checkBudget(
  admin: ReturnType<typeof createClient>
): Promise<{ ok: boolean; spent: number; budget: number }> {
  const month = new Date().toISOString().slice(0, 7);
  const { data } = await admin
    .from("llm_budget")
    .select("budget_eur, spent_eur, hard_stop")
    .eq("month", month)
    .maybeSingle();

  if (!data) return { ok: true, spent: 0, budget: 200 };
  if (data.hard_stop && data.spent_eur >= data.budget_eur) {
    return { ok: false, spent: data.spent_eur, budget: data.budget_eur };
  }
  return { ok: true, spent: data.spent_eur, budget: data.budget_eur };
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1) Clean stale locks
    const staleThreshold = new Date(
      Date.now() - LOCK_TIMEOUT_SECONDS * 1000
    ).toISOString();

    await admin
      .from("job_queue")
      .update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        last_error: "Lock timeout – returned to pending",
      })
      .eq("status", "processing")
      .lt("locked_at", staleThreshold);

    const now = new Date().toISOString();

    // 2) Load rate limits config (cached per invocation)
    const { data: rateLimits } = await admin
      .from("llm_rate_limits")
      .select("provider, max_concurrent, cooldown_seconds, is_paused");

    const rlConfig = (rateLimits ?? []) as RateLimit[];

    // 3) Fetch eligible pending jobs
    //    Respect scheduled_at: only pick jobs where scheduled_at is null or <= now
    const { data: pendingJobs, error: fetchErr } = await admin
      .from("job_queue")
      .select("id, job_type, payload, attempts, max_attempts, priority, provider, scheduled_at, batch_cursor")
      .eq("status", "pending")
      .lte("run_after", now)
      .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
      .is("locked_by", null)
      .order("priority", { ascending: true })
      .order("scheduled_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE * 2); // fetch extra to account for skipped LLM jobs

    if (fetchErr) {
      console.error("[Runner] Fetch error:", fetchErr.message);
      return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers });
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending jobs", runner: RUNNER_ID }),
        { status: 200, headers }
      );
    }

    // 4) Claim jobs with concurrency guard
    const claimed: JobRecord[] = [];
    const skippedLLM: string[] = [];

    for (const job of pendingJobs as JobRecord[]) {
      if (claimed.length >= BATCH_SIZE) break;

      const isLLM = LLM_JOB_TYPES.has(job.job_type);
      const provider = job.provider || (isLLM ? DEFAULT_LLM_PROVIDER : null);

      // LLM concurrency check
      if (isLLM && provider) {
        const { allowed, cooldown } = await canRunLLMJob(admin, provider, rlConfig);
        if (!allowed) {
          // Delay this job
          const delayUntil = new Date(Date.now() + (cooldown ?? 30) * 1000).toISOString();
          await admin
            .from("job_queue")
            .update({ scheduled_at: delayUntil, updated_at: now })
            .eq("id", job.id)
            .eq("status", "pending");
          skippedLLM.push(job.id.slice(0, 8));
          continue;
        }

        // Budget check for LLM jobs
        const budget = await checkBudget(admin);
        if (!budget.ok) {
          await admin
            .from("job_queue")
            .update({
              status: "failed",
              last_error: "BUDGET_STOP",
              last_error_code: "BUDGET_STOP",
              last_error_hint: `LLM budget exceeded: €${budget.spent}/€${budget.budget}`,
              completed_at: now,
              locked_at: null,
              locked_by: null,
              updated_at: now,
            })
            .eq("id", job.id);
          continue;
        }
      }

      // Atomic claim
      const { data: locked, error: lockErr } = await admin
        .from("job_queue")
        .update({
          status: "processing",
          locked_at: now,
          locked_by: RUNNER_ID,
          started_at: now,
          updated_at: now,
          provider: provider,
        })
        .eq("id", job.id)
        .eq("status", "pending")
        .is("locked_by", null)
        .select("id")
        .maybeSingle();

      if (!lockErr && locked) {
        claimed.push({ ...job, provider });
      }
    }

    if (skippedLLM.length > 0) {
      console.log(`[Runner:${RUNNER_ID}] Delayed ${skippedLLM.length} LLM jobs (concurrency limit)`);
    }

    if (claimed.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No jobs claimed",
          runner: RUNNER_ID,
          skipped_llm: skippedLLM.length,
        }),
        { status: 200, headers }
      );
    }

    console.log(
      `[Runner:${RUNNER_ID}] Claimed ${claimed.length} jobs: ${claimed.map((j) => j.job_type).join(", ")}`
    );

    const results: Array<{ id: string; job_type: string; outcome: string }> = [];

    // 5) Process each job
    for (const job of claimed) {
      const functionName = JOB_TYPE_MAP[job.job_type];

      if (!functionName) {
        await admin
          .from("job_queue")
          .update({
            status: "failed",
            error: `Unknown job_type: "${job.job_type}"`,
            last_error: `Unknown job_type: "${job.job_type}"`,
            last_error_code: "UNKNOWN_TYPE",
            completed_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        results.push({ id: job.id, job_type: job.job_type, outcome: "failed_unknown_type" });
        continue;
      }

      try {
        const functionUrl = `${SUPABASE_URL}/functions/v1/${functionName}`;
        console.log(`[Runner:${RUNNER_ID}] Executing ${job.id.slice(0, 8)} → ${functionName}`);

        // Normalize payload
        const normalized = { ...job.payload };
        if (normalized.courseId && !normalized.course_id) normalized.course_id = normalized.courseId;
        if (normalized.course_id && !normalized.courseId) normalized.courseId = normalized.course_id;
        if (normalized.curriculumId && !normalized.curriculum_id) normalized.curriculum_id = normalized.curriculumId;
        if (normalized.curriculum_id && !normalized.curriculumId) normalized.curriculumId = normalized.curriculum_id;

        // Include batch_cursor if present
        if (job.batch_cursor) {
          normalized._batch_cursor = job.batch_cursor;
        }

        const response = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "x-job-runner-key": SUPABASE_SERVICE_KEY,
          },
          body: JSON.stringify({
            ...normalized,
            _job_id: job.id,
            _job_type: job.job_type,
            _runner_id: RUNNER_ID,
          }),
        });

        const responseText = await response.text();
        let responseData: unknown;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = { raw: responseText.slice(0, 500) };
        }

        if (response.ok) {
          // Check if response contains batch_cursor (chunked job, not finished yet)
          const rd = responseData as Record<string, unknown>;
          if (rd?.batch_cursor && rd?.batch_complete === false) {
            // Re-queue for next chunk
            const nextScheduled = new Date(Date.now() + 15_000).toISOString();
            await admin
              .from("job_queue")
              .update({
                status: "pending",
                batch_cursor: rd.batch_cursor as Record<string, unknown>,
                scheduled_at: nextScheduled,
                attempts: job.attempts + 1,
                locked_at: null,
                locked_by: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.push({ id: job.id, job_type: job.job_type, outcome: "batch_continue" });
          } else {
            // Full success
            await admin
              .from("job_queue")
              .update({
                status: "completed",
                result: responseData as Record<string, unknown>,
                completed_at: new Date().toISOString(),
                attempts: job.attempts + 1,
                locked_at: null,
                locked_by: null,
                error: null,
                last_error_code: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.push({ id: job.id, job_type: job.job_type, outcome: "completed" });
          }
        } else if (
          response.status === 409 &&
          typeof responseData === "object" && responseData !== null &&
          (responseData as Record<string, unknown>).retry === true
        ) {
          // Prereq not done – soft retry
          const MAX_PREREQ_RETRIES = 20;
          const newRetryAttempts = job.attempts + 1;

          if (newRetryAttempts >= MAX_PREREQ_RETRIES) {
            console.warn(`[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} prereq cap reached`);
            await admin
              .from("job_queue")
              .update({
                status: "failed",
                error: `Prereq retry cap reached after ${newRetryAttempts} attempts`,
                last_error: "PREREQ_RETRY_CAP_REACHED",
                last_error_code: "PREREQ_CAP",
                attempts: newRetryAttempts,
                completed_at: new Date().toISOString(),
                locked_at: null,
                locked_by: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.push({ id: job.id, job_type: job.job_type, outcome: "failed_prereq_cap" });
          } else {
            const retryAfter = new Date(Date.now() + 15_000).toISOString();
            await admin
              .from("job_queue")
              .update({
                status: "pending",
                last_error: typeof responseData === "object" && responseData !== null && "error" in responseData
                  ? String((responseData as { error: unknown }).error).slice(0, 500)
                  : "PREREQ_NOT_DONE",
                attempts: newRetryAttempts,
                run_after: retryAfter,
                scheduled_at: retryAfter,
                locked_at: null,
                locked_by: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.push({ id: job.id, job_type: job.job_type, outcome: "retry_prereq" });
          }
        } else {
          // Error response
          const errorMsg = typeof responseData === "object" && responseData !== null && "error" in responseData
            ? String((responseData as { error: unknown }).error)
            : `HTTP ${response.status}: ${responseText.slice(0, 200)}`;

          await handleJobFailure(admin, job, errorMsg, response.status, rlConfig);
          results.push({
            id: job.id,
            job_type: job.job_type,
            outcome: isPermanentFailure(errorMsg) ? "failed_permanent" : "failed_retry",
          });
        }
      } catch (execErr: unknown) {
        const errorMsg = execErr instanceof Error ? execErr.message : String(execErr);
        await handleJobFailure(admin, job, `Runtime: ${errorMsg}`, 0, rlConfig);
        results.push({ id: job.id, job_type: job.job_type, outcome: "failed_runtime" });
      }
    }

    return new Response(
      JSON.stringify({ runner: RUNNER_ID, processed: results.length, results }),
      { status: 200, headers }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Runner] Fatal error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
  }
});

// ─── FAILURE HANDLER ─────────────────────────────────────────────────
async function handleJobFailure(
  admin: ReturnType<typeof createClient>,
  job: JobRecord,
  errorMsg: string,
  httpStatus: number,
  rateLimits: RateLimit[]
) {
  const newAttempts = job.attempts + 1;
  const provider = job.provider || DEFAULT_LLM_PROVIDER;
  const rlConfig = rateLimits.find((r) => r.provider === provider);
  const cooldownSeconds = rlConfig?.cooldown_seconds ?? 120;

  // Rate limit: use scheduled backoff with jitter
  if (isRateLimitError(errorMsg)) {
    const jitter = Math.floor(Math.random() * 30);
    const backoffMs = (cooldownSeconds + jitter) * 1000;
    const rateLimitedUntil = new Date(Date.now() + backoffMs).toISOString();

    // Rate-limited jobs get more retries (up to 12)
    const maxForRateLimit = Math.max(job.max_attempts, 12);
    if (newAttempts >= maxForRateLimit) {
      console.warn(`[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} rate-limit cap reached (${newAttempts}/${maxForRateLimit})`);
      await admin
        .from("job_queue")
        .update({
          status: "failed",
          error: errorMsg.slice(0, 2000),
          last_error: errorMsg.slice(0, 500),
          last_error_code: "RATE_LIMIT_EXHAUSTED",
          last_error_hint: `Exceeded ${maxForRateLimit} attempts with rate limiting`,
          last_http_status: httpStatus || 429,
          attempts: newAttempts,
          completed_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return;
    }

    console.log(
      `[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} rate-limited, retry #${newAttempts} in ${cooldownSeconds + jitter}s`
    );
    await admin
      .from("job_queue")
      .update({
        status: "pending",
        last_error: errorMsg.slice(0, 500),
        last_error_code: "RATE_LIMIT",
        last_error_hint: "Backoff applied with jitter",
        last_http_status: httpStatus || 429,
        rate_limited_until: rateLimitedUntil,
        scheduled_at: rateLimitedUntil,
        attempts: newAttempts,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return;
  }

  // Permanent failure
  const permanent = isPermanentFailure(errorMsg) ||
    newAttempts >= (isTransientError(errorMsg) ? Math.max(job.max_attempts, 8) : job.max_attempts);

  if (permanent) {
    console.warn(`[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} PERMANENTLY FAILED: ${errorMsg.slice(0, 100)}`);
    await admin
      .from("job_queue")
      .update({
        status: "failed",
        error: errorMsg.slice(0, 2000),
        last_error: errorMsg.slice(0, 500),
        last_error_code: isPermanentFailure(errorMsg) ? "PERMANENT" : "MAX_ATTEMPTS",
        last_http_status: httpStatus || null,
        attempts: newAttempts,
        completed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  } else {
    // Exponential backoff: 30s, 60s, 120s...
    const backoffSeconds = 30 * Math.pow(2, newAttempts - 1);
    const runAfter = new Date(Date.now() + backoffSeconds * 1000).toISOString();

    console.log(`[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} retry #${newAttempts} in ${backoffSeconds}s`);
    await admin
      .from("job_queue")
      .update({
        status: "pending",
        last_error: errorMsg.slice(0, 500),
        last_error_code: "TRANSIENT",
        last_http_status: httpStatus || null,
        attempts: newAttempts,
        run_after: runAfter,
        scheduled_at: runAfter,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  }
}
