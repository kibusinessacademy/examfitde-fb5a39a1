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

const DEFAULT_LLM_PROVIDER = "openai";

// ─── TRIAGE POLICY (loaded once per invocation) ─────────────────────
interface TriagePolicy {
  classification: { error_code_map: Record<string, string> };
  actions: Record<string, {
    set_status: string;
    delay_seconds?: number;
    ensure_not_failed?: boolean;
    maybe_switch_provider?: boolean;
    decrement_concurrency?: boolean;
    severity?: string;
    block_package?: boolean;
    dead_letter?: boolean;
  }>;
  retry: {
    max_attempts_default: number;
    max_attempts_rate_limit: number;
    max_attempts_timeout: number;
    max_attempts_transient: number;
    backoff: { base_seconds: number; max_seconds: number; jitter_seconds_range: number[] };
  };
  routing: {
    default_provider_order: string[];
    fallback_strategy: { max_fallbacks_per_job: number; switch_provider_if_rate_limited_until_gt_seconds: number };
  };
  controls: {
    max_global_processing_jobs: number;
    max_parallel_jobs_per_package: number;
  };
}

let _cachedPolicy: TriagePolicy | null = null;

async function loadTriagePolicy(admin: ReturnType<typeof createClient>): Promise<TriagePolicy | null> {
  if (_cachedPolicy) return _cachedPolicy;
  const { data } = await admin
    .from("triage_policy")
    .select("policy_json")
    .eq("is_active", true)
    .maybeSingle();
  if (data?.policy_json) {
    _cachedPolicy = data.policy_json as unknown as TriagePolicy;
  }
  return _cachedPolicy;
}

// ─── ERROR CLASSIFICATION (policy-driven) ────────────────────────────
function classifyError(errorMsg: string, httpStatus: number, policy: TriagePolicy | null): string {
  const map = policy?.classification?.error_code_map ?? {};

  // Check HTTP status first
  if (httpStatus === 429 || map[String(httpStatus)] === "RATE_LIMIT") return "RATE_LIMIT";

  // Check error message against map keys
  const upper = errorMsg.toUpperCase();
  for (const [pattern, category] of Object.entries(map)) {
    if (upper.includes(pattern.toUpperCase())) return category;
  }

  // Fallback heuristics
  if (["RATE LIMIT", "TOO MANY REQUESTS", "429"].some(p => upper.includes(p))) return "RATE_LIMIT";
  if (["TIMEOUT", "ETIMEDOUT", "GATEWAY_TIMEOUT"].some(p => upper.includes(p))) return "TIMEOUT";
  if (["ECONNRESET", "SOCKET HANG UP", "FETCH FAILED", "ENOTFOUND", "EAI_AGAIN"].some(p => upper.includes(p))) return "TRANSIENT_NETWORK";
  if (["SSOT_VIOLATION", "SCHEMA_MISMATCH"].some(p => upper.includes(p))) return "PERMANENT_CODE";
  if (["VALIDATION_ERROR", "FOREIGN_KEY"].some(p => upper.includes(p))) return "PERMANENT_DATA";
  if (["RLS_DENIED", "UNAUTHORIZED"].some(p => upper.includes(p))) return "PERMANENT_SECURITY";

  return "UNKNOWN";
}

function getMaxAttempts(category: string, policy: TriagePolicy | null, jobMax: number): number {
  const r = policy?.retry;
  if (!r) return Math.max(jobMax, 8);
  switch (category) {
    case "RATE_LIMIT": return Math.max(jobMax, r.max_attempts_rate_limit);
    case "TIMEOUT": return Math.max(jobMax, r.max_attempts_timeout);
    case "TRANSIENT_NETWORK": return Math.max(jobMax, r.max_attempts_transient);
    default: return jobMax;
  }
}

function computeBackoff(attempts: number, policy: TriagePolicy | null, category: string): number {
  const actionDelay = policy?.actions?.[category]?.delay_seconds;
  const backoff = policy?.retry?.backoff;
  const base = backoff?.base_seconds ?? 10;
  const max = backoff?.max_seconds ?? 600;
  const jitterRange = backoff?.jitter_seconds_range ?? [0, 30];

  const expDelay = Math.min(max, base * Math.pow(2, attempts - 1));
  const jitter = Math.floor(Math.random() * (jitterRange[1] - jitterRange[0])) + jitterRange[0];
  const delay = Math.max(expDelay, actionDelay ?? 0) + jitter;
  return delay;
}

// ─── PROVIDER FALLBACK ──────────────────────────────────────────────
function pickFallbackProvider(
  currentProvider: string,
  fallbackCount: number,
  policy: TriagePolicy | null
): string | null {
  const order = policy?.routing?.default_provider_order ?? ["openai", "anthropic", "google"];
  const maxFallbacks = policy?.routing?.fallback_strategy?.max_fallbacks_per_job ?? 2;
  if (fallbackCount >= maxFallbacks) return null;

  const idx = order.indexOf(currentProvider);
  if (idx < 0 || idx >= order.length - 1) return order.find(p => p !== currentProvider) ?? null;
  return order[idx + 1];
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
  fallback_count: number;
  original_provider: string | null;
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
  if (limit?.is_paused) return { allowed: false, cooldown: 60 };

  const maxConcurrent = limit?.max_concurrent ?? 2;
  const { count, error } = await admin
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .eq("provider", provider);

  if (error) return { allowed: true };
  if ((count ?? 0) >= maxConcurrent) return { allowed: false, cooldown: 30 };
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

// ─── DEAD LETTER ────────────────────────────────────────────────────
async function createDeadLetter(
  admin: ReturnType<typeof createClient>,
  job: JobRecord,
  category: string,
  errorCode: string,
  errorMsg: string
) {
  try {
    const packageId = (job.payload?.package_id ?? job.payload?.packageId ?? null) as string | null;
    await admin.from("dead_letter_jobs").insert({
      job_id: job.id,
      package_id: packageId,
      job_type: job.job_type,
      error_category: category,
      error_code: errorCode,
      error_message: errorMsg.slice(0, 2000),
      payload: job.payload,
    });
  } catch (e) {
    console.warn(`[Runner] Failed to create dead letter:`, (e as Error).message);
  }
}

// ─── BLOCK PACKAGE ──────────────────────────────────────────────────
async function blockPackage(
  admin: ReturnType<typeof createClient>,
  job: JobRecord,
  reason: string
) {
  try {
    const packageId = (job.payload?.package_id ?? job.payload?.packageId) as string | undefined;
    if (!packageId) return;
    await admin
      .from("course_packages")
      .update({ status: "blocked", stuck_reason: reason, updated_at: new Date().toISOString() })
      .eq("id", packageId)
      .in("status", ["building", "queued"]);
  } catch (e) {
    console.warn(`[Runner] Failed to block package:`, (e as Error).message);
  }
}

// ─── ADMIN ALERT ────────────────────────────────────────────────────
async function sendAdminAlert(
  admin: ReturnType<typeof createClient>,
  category: string,
  severity: string,
  job: JobRecord,
  errorMsg: string
) {
  try {
    await admin.from("admin_notifications").insert({
      title: `[${category}] ${job.job_type} failed`,
      body: errorMsg.slice(0, 500),
      category: category.startsWith("PERMANENT_SECURITY") ? "security" : category.startsWith("PERMANENT_CODE") ? "ops" : "quality",
      severity: severity,
      metadata: { job_id: job.id, job_type: job.job_type, provider: job.provider },
    });
  } catch (e) {
    console.warn(`[Runner] Failed to send admin alert:`, (e as Error).message);
  }
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Load triage policy
    const policy = await loadTriagePolicy(admin);

    // 1) Clean stale locks
    const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_SECONDS * 1000).toISOString();
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

    // 2) Global processing cap
    const maxGlobal = policy?.controls?.max_global_processing_jobs ?? 40;
    const { count: globalProcessing } = await admin
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing");
    if ((globalProcessing ?? 0) >= maxGlobal) {
      return new Response(JSON.stringify({ message: "Global processing cap reached", cap: maxGlobal, running: globalProcessing }), { status: 200, headers });
    }

    // 3) Load rate limits config
    const { data: rateLimits } = await admin
      .from("llm_rate_limits")
      .select("provider, max_concurrent, cooldown_seconds, is_paused");
    const rlConfig = (rateLimits ?? []) as RateLimit[];

    // 4) Fetch eligible pending jobs
    const { data: pendingJobs, error: fetchErr } = await admin
      .from("job_queue")
      .select("id, job_type, payload, attempts, max_attempts, priority, provider, scheduled_at, batch_cursor, fallback_count, original_provider")
      .eq("status", "pending")
      .lte("run_after", now)
      .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
      .is("locked_by", null)
      .order("priority", { ascending: true })
      .order("scheduled_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE * 2);

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

    // 5) Claim jobs with concurrency guard
    const claimed: JobRecord[] = [];
    const skippedLLM: string[] = [];

    for (const job of pendingJobs as JobRecord[]) {
      if (claimed.length >= BATCH_SIZE) break;

      const isLLM = LLM_JOB_TYPES.has(job.job_type);
      const provider = job.provider || (isLLM ? DEFAULT_LLM_PROVIDER : null);

      if (isLLM && provider) {
        const { allowed, cooldown } = await canRunLLMJob(admin, provider, rlConfig);
        if (!allowed) {
          const delayUntil = new Date(Date.now() + (cooldown ?? 30) * 1000).toISOString();
          await admin
            .from("job_queue")
            .update({ scheduled_at: delayUntil, updated_at: now })
            .eq("id", job.id)
            .eq("status", "pending");
          skippedLLM.push(job.id.slice(0, 8));
          continue;
        }

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
          original_provider: job.original_provider || provider,
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
        JSON.stringify({ message: "No jobs claimed", runner: RUNNER_ID, skipped_llm: skippedLLM.length }),
        { status: 200, headers }
      );
    }

    console.log(`[Runner:${RUNNER_ID}] Claimed ${claimed.length} jobs: ${claimed.map((j) => j.job_type).join(", ")}`);

    const results: Array<{ id: string; job_type: string; outcome: string }> = [];

    // 6) Process each job
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

        const normalized = { ...job.payload };
        if (normalized.courseId && !normalized.course_id) normalized.course_id = normalized.courseId;
        if (normalized.course_id && !normalized.courseId) normalized.courseId = normalized.course_id;
        if (normalized.curriculumId && !normalized.curriculum_id) normalized.curriculum_id = normalized.curriculumId;
        if (normalized.curriculum_id && !normalized.curriculumId) normalized.curriculumId = normalized.curriculum_id;

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
          const rd = responseData as Record<string, unknown>;
          if (rd?.batch_cursor && rd?.batch_complete === false) {
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
          const MAX_PREREQ_RETRIES = 20;
          const newRetryAttempts = job.attempts + 1;

          if (newRetryAttempts >= MAX_PREREQ_RETRIES) {
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
          // ─── TRIAGE-DRIVEN FAILURE HANDLING ───
          const errorMsg = typeof responseData === "object" && responseData !== null && "error" in responseData
            ? String((responseData as { error: unknown }).error)
            : `HTTP ${response.status}: ${responseText.slice(0, 200)}`;

          const outcome = await handleJobFailureWithTriage(admin, job, errorMsg, response.status, rlConfig, policy);
          results.push({ id: job.id, job_type: job.job_type, outcome });
        }
      } catch (execErr: unknown) {
        const errorMsg = execErr instanceof Error ? execErr.message : String(execErr);
        const outcome = await handleJobFailureWithTriage(admin, job, `Runtime: ${errorMsg}`, 0, rlConfig, policy);
        results.push({ id: job.id, job_type: job.job_type, outcome });
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

// ─── TRIAGE-DRIVEN FAILURE HANDLER ──────────────────────────────────
async function handleJobFailureWithTriage(
  admin: ReturnType<typeof createClient>,
  job: JobRecord,
  errorMsg: string,
  httpStatus: number,
  rateLimits: RateLimit[],
  policy: TriagePolicy | null
): Promise<string> {
  const category = classifyError(errorMsg, httpStatus, policy);
  const actionDef = policy?.actions?.[category];
  const newAttempts = job.attempts + 1;
  const provider = job.provider || DEFAULT_LLM_PROVIDER;
  const now = new Date().toISOString();

  console.log(`[Runner:${RUNNER_ID}] Triage ${job.id.slice(0, 8)}: ${category} (attempt ${newAttempts})`);

  // ─── PERMANENT FAILURES → fail + dead letter + block ──────────
  if (category.startsWith("PERMANENT_") || (actionDef && actionDef.set_status === "failed")) {
    const severity = actionDef?.severity ?? "high";
    await admin
      .from("job_queue")
      .update({
        status: "failed",
        error: errorMsg.slice(0, 2000),
        last_error: errorMsg.slice(0, 500),
        last_error_code: category,
        last_error_severity: severity,
        last_http_status: httpStatus || null,
        attempts: newAttempts,
        completed_at: now,
        locked_at: null,
        locked_by: null,
        updated_at: now,
      })
      .eq("id", job.id);

    if (actionDef?.dead_letter !== false) {
      await createDeadLetter(admin, job, category, category, errorMsg);
    }
    if (actionDef?.block_package !== false) {
      await blockPackage(admin, job, `${category}: ${errorMsg.slice(0, 200)}`);
    }
    await sendAdminAlert(admin, category, severity, job, errorMsg);
    return `failed_${category.toLowerCase()}`;
  }

  // ─── TRANSIENT FAILURES → retry with backoff + optional provider switch ──
  const maxAttempts = getMaxAttempts(category, policy, job.max_attempts);

  if (newAttempts >= maxAttempts) {
    // Exhausted retries → final fail
    console.warn(`[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} exhausted ${category} retries (${newAttempts}/${maxAttempts})`);
    await admin
      .from("job_queue")
      .update({
        status: "failed",
        error: errorMsg.slice(0, 2000),
        last_error: errorMsg.slice(0, 500),
        last_error_code: `${category}_EXHAUSTED`,
        last_error_severity: "high",
        last_http_status: httpStatus || null,
        attempts: newAttempts,
        completed_at: now,
        locked_at: null,
        locked_by: null,
        updated_at: now,
      })
      .eq("id", job.id);
    await createDeadLetter(admin, job, category, `${category}_EXHAUSTED`, errorMsg);
    return `failed_${category.toLowerCase()}_exhausted`;
  }

  // Compute backoff
  const delaySec = computeBackoff(newAttempts, policy, category);
  const scheduledAt = new Date(Date.now() + delaySec * 1000).toISOString();

  // Provider fallback
  let newProvider = provider;
  const fallbackCount = job.fallback_count ?? 0;
  if (actionDef?.maybe_switch_provider && LLM_JOB_TYPES.has(job.job_type)) {
    const fallback = pickFallbackProvider(provider, fallbackCount, policy);
    if (fallback) {
      newProvider = fallback;
      console.log(`[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} switching provider ${provider} → ${newProvider}`);
    }
  }

  const updatePayload: Record<string, unknown> = {
    status: "pending",
    last_error: errorMsg.slice(0, 500),
    last_error_code: category,
    last_error_severity: category === "RATE_LIMIT" ? "low" : "medium",
    last_http_status: httpStatus || null,
    attempts: newAttempts,
    scheduled_at: scheduledAt,
    run_after: scheduledAt,
    locked_at: null,
    locked_by: null,
    updated_at: now,
    provider: newProvider,
    fallback_count: newProvider !== provider ? fallbackCount + 1 : fallbackCount,
  };

  if (category === "RATE_LIMIT") {
    updatePayload.rate_limited_until = scheduledAt;
  }

  await admin.from("job_queue").update(updatePayload).eq("id", job.id);

  console.log(`[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} → ${category} retry #${newAttempts} in ${delaySec}s (provider: ${newProvider})`);
  return `retry_${category.toLowerCase()}`;
}
