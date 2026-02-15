import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const RUNNER_ID = crypto.randomUUID().slice(0, 8);
const LOCK_TIMEOUT_SECONDS = 300;
const BATCH_SIZE = 5;

// ─── BACKPRESSURE THRESHOLDS ────────────────────────────────────────
const BACKPRESSURE_WARN = 300;
const BACKPRESSURE_THROTTLE = 500;

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
};

// ─── LLM-INTENSIVE JOB TYPES (need concurrency control) ─────────────
const LLM_JOB_TYPES: Set<string> = new Set([
  "generate_curriculum_content",
  "generate_course",
  "generate_course_batch",
  "seed_exam_questions",
  "enrich_exam_solutions",
  "package_auto_seed_exam_blueprints",
  "package_generate_exam_pool",
  "package_generate_oral_exam",
  "package_build_ai_tutor_index",
  "package_generate_handbook",
  "improve_lesson",
  "repair_lessons",
  "seo_generate",
  "seo_content_batch",
  "auto_gap_close",
  "generate_image",
  "assessment_questions_generate",
  "council_propose_step",
  "council_critique_step",
  "council_revise_step",
]);

// ─── PIPELINE-INDEPENDENT JOB TYPES (run without active slot) ───────
// These "factory" jobs CREATE packages — they must not be gated by WIP isolation
// or the system deadlocks (no packages → no slots → no jobs → no packages).
const PIPELINE_INDEPENDENT_TYPES: Set<string> = new Set([
  "setup_course_package",
  "generate_curriculum_content",
  "extract_curriculum",
  "package_queue_next",
  // Pipeline build steps — WIP isolation is handled by pipeline-runner (lease/slots),
  // so the job-runner must NOT double-gate them or they get stuck in DEFER loops.
  "package_scaffold_learning_course",
  "package_auto_seed_exam_blueprints",
  "package_generate_exam_pool",
  "package_generate_oral_exam",
  "package_build_ai_tutor_index",
  "package_generate_handbook",
  "package_run_integrity_check",
  "package_quality_council",
  "package_auto_publish",
]);

const DEFAULT_LLM_PROVIDER = "openai";

// ─── DB-DRIVEN PROVIDER AUTOPILOT ───────────────────────────────────
async function selectBestProvider(
  admin: ReturnType<typeof createClient>,
  preferred: string | null,
  exclude: string[] = [],
  jobType: string | null = null
): Promise<string | null> {
  const { data, error } = await admin.rpc("select_best_provider", {
    p_preferred: preferred,
    p_exclude: exclude,
    p_job_type: jobType,
  });
  if (error) {
    console.warn(`[Runner:${RUNNER_ID}] select_best_provider error: ${error.message}`);
    return preferred;
  }
  return data as string | null;
}

// ─── USAGE LOGGING (for adaptive scoring) ───────────────────────────
async function logProviderUsage(
  admin: ReturnType<typeof createClient>,
  provider: string,
  jobType: string,
  success: boolean,
  latencyMs: number | null = null,
  tokens: number = 0,
  cost: number = 0,
  errorCategory: string | null = null
): Promise<void> {
  try {
    await admin.rpc("log_provider_usage", {
      p_provider: provider,
      p_job_type: jobType,
      p_success: success,
      p_latency_ms: latencyMs,
      p_tokens: tokens,
      p_cost: cost,
      p_error_category: errorCategory,
    });
  } catch { /* ignore */ }
}

// ─── JOB COST LEDGER LOGGING ────────────────────────────────────────
async function logJobCost(
  admin: ReturnType<typeof createClient>,
  job: JobRecord,
  provider: string,
  latencyMs: number,
  responseData: unknown
): Promise<void> {
  try {
    const rd = (responseData && typeof responseData === "object") ? responseData as Record<string, unknown> : {};
    const tokensInput = Number(rd.tokens_input ?? rd.input_tokens ?? rd.usage?.prompt_tokens ?? 0);
    const tokensOutput = Number(rd.tokens_output ?? rd.output_tokens ?? rd.usage?.completion_tokens ?? 0);
    const costEur = Number(rd.cost_eur ?? rd.cost ?? 0) || null;
    const model = String(rd.model ?? rd.model_used ?? "");
    const packageId = (job.payload?.package_id ?? job.payload?.packageId ?? null) as string | null;
    const certId = (job.payload?.certification_id ?? null) as string | null;
    const currId = (job.payload?.curriculum_id ?? job.payload?.curriculumId ?? null) as string | null;

    await admin.rpc("log_job_cost", {
      p_job_id: job.id,
      p_job_type: job.job_type,
      p_provider: provider,
      p_tokens_input: tokensInput,
      p_tokens_output: tokensOutput,
      p_cost_eur: costEur,
      p_package_id: packageId,
      p_certification_id: certId,
      p_curriculum_id: currId,
      p_latency_ms: latencyMs,
      p_model: model || null,
    });
  } catch (e) {
    console.warn(`[Runner] logJobCost failed:`, (e as Error).message);
  }
}

// ─── PREDICTIVE BACKPRESSURE SNAPSHOT ────────────────────────────────
async function recordBackpressureSnapshot(
  admin: ReturnType<typeof createClient>,
  pendingCount: number,
  processingCount: number,
  throttle: boolean
): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const [completedRes, failedRes] = await Promise.all([
    admin.from("job_queue").select("id", { count: "exact", head: true })
      .eq("status", "completed").gte("completed_at", oneHourAgo),
    admin.from("job_queue").select("id", { count: "exact", head: true })
      .eq("status", "failed").gte("completed_at", oneHourAgo),
  ]);
  const completed1h = completedRes.count ?? 0;
  const failed1h = failedRes.count ?? 0;
  const throughputPerMin = completed1h / 60.0;
  const etaClearMin = throughputPerMin > 0 ? pendingCount / throughputPerMin : 0;

  // Get previous snapshot for trend
  const { data: prev } = await admin.from("backpressure_snapshots")
    .select("pending_count").order("snapshot_at", { ascending: false }).limit(1).maybeSingle();
  const prevPending = prev?.pending_count ?? pendingCount;
  const trend = pendingCount > prevPending * 1.1 ? "rising" : pendingCount < prevPending * 0.9 ? "falling" : "stable";

  try {
    await admin.from("backpressure_snapshots").insert({
      pending_count: pendingCount,
      processing_count: processingCount,
      completed_1h: completed1h,
      failed_1h: failed1h,
      throughput_per_min: Math.round(throughputPerMin * 100) / 100,
      eta_clear_minutes: Math.round(etaClearMin * 10) / 10,
      forecast_trend: trend,
      throttle_active: throttle,
    });
  } catch { /* ignore */ }

  if (trend === "rising" && pendingCount > BACKPRESSURE_WARN) {
    console.warn(`[Runner:${RUNNER_ID}] 📈 Backpressure RISING: ${pendingCount} pending, ETA ${etaClearMin.toFixed(0)}min`);
  }
}

// ─── RECALCULATE SCORES (every ~5 min) ──────────────────────────────
let _lastScoreRecalc = 0;
async function maybeRecalcScores(admin: ReturnType<typeof createClient>): Promise<void> {
  const now = Date.now();
  if (now - _lastScoreRecalc < 300_000) return; // 5 min
  _lastScoreRecalc = now;
  try { await admin.rpc("recalculate_routing_scores"); } catch { /* ignore */ }
  console.log(`[Runner:${RUNNER_ID}] 📊 Routing scores recalculated`);
}

async function claimProviderSlot(admin: ReturnType<typeof createClient>, provider: string): Promise<boolean> {
  const { data, error } = await admin.rpc("claim_provider_slot", { p_provider: provider });
  if (error) {
    console.warn(`[Runner:${RUNNER_ID}] claim_provider_slot error: ${error.message}`);
    return false;
  }
  return data as boolean;
}

async function releaseProviderSlot(admin: ReturnType<typeof createClient>, provider: string): Promise<void> {
  try { await admin.rpc("release_provider_slot", { p_provider: provider }); } catch { /* ignore */ }
}

async function markProviderRateLimited(
  admin: ReturnType<typeof createClient>,
  provider: string,
  cooldownSec: number,
  errorMsg: string
): Promise<void> {
  try {
    await admin.rpc("mark_provider_rate_limited", {
      p_provider: provider,
      p_cooldown_seconds: cooldownSec,
      p_error: errorMsg.slice(0, 500),
    });
  } catch { /* ignore */ }
}

async function recoverProviders(admin: ReturnType<typeof createClient>): Promise<number> {
  const { data, error } = await admin.rpc("recover_providers");
  if (error) return 0;
  return (data as number) ?? 0;
}

async function getProviderStatusLog(admin: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await admin
    .from("provider_status")
    .select("provider, is_healthy, current_load, max_concurrency, rate_limited_until")
    .order("priority");
  if (!data) return "no data";
  return data.map((p: Record<string, unknown>) =>
    `${p.provider}:${p.is_healthy ? '✓' : '✗'} ${p.current_load}/${p.max_concurrency}${p.rate_limited_until ? ' RL' : ''}`
  ).join(' | ');
}

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
  if (httpStatus === 429 || map[String(httpStatus)] === "RATE_LIMIT") return "RATE_LIMIT";
  const upper = errorMsg.toUpperCase();
  for (const [pattern, category] of Object.entries(map)) {
    if (upper.includes(pattern.toUpperCase())) return category;
  }
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
  return Math.max(expDelay, actionDelay ?? 0) + jitter;
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

// ─── BACKPRESSURE CHECK ─────────────────────────────────────────────
async function checkBackpressure(
  admin: ReturnType<typeof createClient>
): Promise<{ pendingCount: number; throttle: boolean; warn: boolean }> {
  const { count } = await admin
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  const pendingCount = count ?? 0;
  const throttle = pendingCount >= BACKPRESSURE_THROTTLE;
  const warn = pendingCount >= BACKPRESSURE_WARN;

  if (throttle) {
    console.warn(`[Runner:${RUNNER_ID}] 🚨 BACKPRESSURE: ${pendingCount} pending jobs – THROTTLING`);
    await admin.from("admin_notifications").insert({
      title: `🚨 Backpressure: ${pendingCount} pending jobs`,
      body: `Queue exceeds ${BACKPRESSURE_THROTTLE} pending jobs. New job intake is being throttled. Consider scaling providers or pausing non-critical jobs.`,
      category: "ops",
      severity: "critical",
      metadata: { pending_count: pendingCount, threshold: BACKPRESSURE_THROTTLE },
    }).then(() => {}, () => {});
  } else if (warn) {
    console.warn(`[Runner:${RUNNER_ID}] ⚠️ Queue growing: ${pendingCount} pending jobs`);
  }

  return { pendingCount, throttle, warn };
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

    // 0) Recover providers past their cooldown
    const recovered = await recoverProviders(admin);
    if (recovered > 0) {
      console.log(`[Runner:${RUNNER_ID}] Recovered ${recovered} provider(s) from rate-limit cooldown`);
    }

    // Log provider status + recalculate scores periodically
    const providerLog = await getProviderStatusLog(admin);
    console.log(`[Runner:${RUNNER_ID}] Providers: ${providerLog}`);
    await maybeRecalcScores(admin);

    // 1) Clean stale locks + release their provider slots
    const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_SECONDS * 1000).toISOString();
    const { data: staleJobs } = await admin
      .from("job_queue")
      .select("id, provider")
      .eq("status", "processing")
      .lt("locked_at", staleThreshold);

    if (staleJobs && staleJobs.length > 0) {
      for (const sj of staleJobs) {
        if (sj.provider) await releaseProviderSlot(admin, sj.provider);
      }
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
      console.log(`[Runner:${RUNNER_ID}] Released ${staleJobs.length} stale locks`);
    }

    const now = new Date().toISOString();

    // 2) Backpressure check + predictive snapshot
    const bp = await checkBackpressure(admin);
    const { count: processingNow } = await admin
      .from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing");
    await recordBackpressureSnapshot(admin, bp.pendingCount, processingNow ?? 0, bp.throttle);

    // 3) Global processing cap
    const maxGlobal = policy?.controls?.max_global_processing_jobs ?? 40;
    const { count: globalProcessing } = await admin
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing");
    if ((globalProcessing ?? 0) >= maxGlobal) {
      return new Response(JSON.stringify({
        message: "Global processing cap reached",
        cap: maxGlobal,
        running: globalProcessing,
        pending: bp.pendingCount,
        providers: providerLog,
      }), { status: 200, headers });
    }

    // 4) Fetch eligible pending jobs (reduced batch if backpressure throttling)
    const effectiveBatch = bp.throttle ? Math.max(2, Math.floor(BATCH_SIZE / 2)) : BATCH_SIZE;

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
      .limit(effectiveBatch * 3);

    if (fetchErr) {
      console.error("[Runner] Fetch error:", fetchErr.message);
      return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers });
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending jobs", runner: RUNNER_ID, providers: providerLog }),
        { status: 200, headers }
      );
    }

    // ─── STEP-LEVEL CONCURRENCY LIMITS (DB-driven from jobtype_limits) ──
    const { data: dbLimits } = await admin
      .from("jobtype_limits")
      .select("job_type, max_processing");

    const STEP_CONCURRENCY_LIMITS: Record<string, number> = {};
    for (const row of dbLimits ?? []) {
      STEP_CONCURRENCY_LIMITS[row.job_type] = row.max_processing;
    }

    // Pre-fetch current processing counts per limited job type
    const limitedTypes = Object.keys(STEP_CONCURRENCY_LIMITS);
    const { data: processingByType } = limitedTypes.length > 0
      ? await admin
          .from("job_queue")
          .select("job_type")
          .eq("status", "processing")
          .in("job_type", limitedTypes)
      : { data: [] };
    
    const typeProcessingCounts: Record<string, number> = {};
    for (const row of processingByType ?? []) {
      typeProcessingCounts[row.job_type] = (typeProcessingCounts[row.job_type] || 0) + 1;
    }

    // 5) Claim jobs with DB-DRIVEN PROVIDER AUTOPILOT + step-level concurrency
    const claimed: JobRecord[] = [];
    const skippedLLM: string[] = [];
    const skippedConcurrency: string[] = [];

    for (const job of pendingJobs as JobRecord[]) {
      if (claimed.length >= effectiveBatch) break;

      // ─── STEP-LEVEL CONCURRENCY CHECK ──────────────────────────────
      const typeLimit = STEP_CONCURRENCY_LIMITS[job.job_type];
      if (typeLimit !== undefined) {
        const currentCount = typeProcessingCounts[job.job_type] || 0;
        if (currentCount >= typeLimit) {
          const delayUntil = new Date(Date.now() + 20_000).toISOString();
          await admin
            .from("job_queue")
            .update({ scheduled_at: delayUntil, updated_at: now })
            .eq("id", job.id)
            .eq("status", "pending");
          skippedConcurrency.push(`${job.job_type}(${currentCount}/${typeLimit})`);
          continue;
        }
      }

      const isLLM = LLM_JOB_TYPES.has(job.job_type);
      let provider = job.provider || (isLLM ? DEFAULT_LLM_PROVIDER : null);

      if (isLLM) {
        // ─── PROVIDER AUTOPILOT: Resolve 'auto' or find best available with intent ───
        const preferredProvider = (provider === "auto" || !provider) ? null : provider;
        const bestProvider = await selectBestProvider(admin, preferredProvider, [], job.job_type);

        if (!bestProvider) {
          // All providers at capacity – delay job
          const delayUntil = new Date(Date.now() + 30_000).toISOString();
          await admin
            .from("job_queue")
            .update({ scheduled_at: delayUntil, updated_at: now })
            .eq("id", job.id)
            .eq("status", "pending");
          skippedLLM.push(job.id.slice(0, 8));
          continue;
        }

        provider = bestProvider;

        // Atomically claim a slot
        const slotClaimed = await claimProviderSlot(admin, provider);
        if (!slotClaimed) {
          // Race condition: slot taken between select and claim
          const delayUntil = new Date(Date.now() + 15_000).toISOString();
          await admin
            .from("job_queue")
            .update({ scheduled_at: delayUntil, updated_at: now })
            .eq("id", job.id)
            .eq("status", "pending");
          skippedLLM.push(job.id.slice(0, 8));
          continue;
        }

        // Budget check
        const budget = await checkBudget(admin);
        if (!budget.ok) {
          await releaseProviderSlot(admin, provider);
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

      // Track provider changes for fallback counting
      const originalProvider = job.original_provider || job.provider || (isLLM ? DEFAULT_LLM_PROVIDER : null);
      const providerChanged = provider !== (job.provider || DEFAULT_LLM_PROVIDER);
      const newFallbackCount = providerChanged ? (job.fallback_count ?? 0) + 1 : (job.fallback_count ?? 0);

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
          original_provider: originalProvider,
          fallback_count: newFallbackCount,
        })
        .eq("id", job.id)
        .eq("status", "pending")
        .is("locked_by", null)
        .select("id")
        .maybeSingle();

      if (!lockErr && locked) {
        claimed.push({ ...job, provider });
        // Update local concurrency tracking
        if (STEP_CONCURRENCY_LIMITS[job.job_type] !== undefined) {
          typeProcessingCounts[job.job_type] = (typeProcessingCounts[job.job_type] || 0) + 1;
        }
      } else if (isLLM && provider) {
        // Failed to claim – release the provider slot
        await releaseProviderSlot(admin, provider);
      }
    }

    if (skippedLLM.length > 0) {
      console.log(`[Runner:${RUNNER_ID}] Delayed ${skippedLLM.length} LLM jobs (all providers at capacity)`);
    }
    if (skippedConcurrency.length > 0) {
      console.log(`[Runner:${RUNNER_ID}] Deferred ${skippedConcurrency.length} jobs (step-level concurrency): ${skippedConcurrency.join(', ')}`);
    }

    if (claimed.length === 0) {
      return new Response(
        JSON.stringify({ message: "No jobs claimed", runner: RUNNER_ID, skipped_llm: skippedLLM.length, skipped_concurrency: skippedConcurrency.length, providers: providerLog }),
        { status: 200, headers }
      );
    }

    console.log(`[Runner:${RUNNER_ID}] Claimed ${claimed.length} jobs: ${claimed.map((j) => `${j.job_type}@${j.provider}`).join(", ")}`);

    const results: Array<{ id: string; job_type: string; outcome: string; provider?: string | null }> = [];

    // 6) Process each job
    for (const job of claimed) {
      const functionName = JOB_TYPE_MAP[job.job_type];

      if (!functionName) {
        if (job.provider && LLM_JOB_TYPES.has(job.job_type)) {
          await releaseProviderSlot(admin, job.provider);
        }
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

      const jobStartMs = Date.now();
      let slotReleased = false;

      try {
        const functionUrl = `${SUPABASE_URL}/functions/v1/${functionName}`;
        console.log(`[Runner:${RUNNER_ID}] Executing ${job.id.slice(0, 8)} → ${functionName} @${job.provider}`);

        const normalized = { ...job.payload };
        if (normalized.courseId && !normalized.course_id) normalized.course_id = normalized.courseId;
        if (normalized.course_id && !normalized.courseId) normalized.courseId = normalized.course_id;
        if (normalized.curriculumId && !normalized.curriculum_id) normalized.curriculum_id = normalized.curriculumId;
        if (normalized.curriculum_id && !normalized.curriculumId) normalized.curriculumId = normalized.curriculum_id;

        if (job.batch_cursor) {
          normalized._batch_cursor = job.batch_cursor;
        }

        // ── Patch A: Keep global pipeline lock alive while package jobs run ──
        const pkgId = (normalized.package_id ?? normalized.packageId ?? null) as string | null;
        if (pkgId) {
          try {
            await admin.rpc("heartbeat_pipeline_lock", { p_package_id: pkgId });
          } catch { /* ignore */ }
        }

        // ── Patch: WIP=N — Only execute BUILD jobs for active pipeline packages ──
        // Factory/pipeline-independent jobs bypass this check entirely
        const isPipelineIndependent = PIPELINE_INDEPENDENT_TYPES.has(job.job_type);

        if (!isPipelineIndependent) {
          const { data: activePackageIds } = await admin.rpc("get_active_pipeline_packages");
          const activeList = (activePackageIds as string[] | null) ?? [];

          // Fallback: also check legacy single-lock
          if (activeList.length === 0) {
            const activeData = await admin.rpc("get_active_pipeline_package");
            const activeRow = Array.isArray(activeData?.data) ? activeData.data[0] : activeData?.data;
            const legacyId = activeRow?.active_package_id ?? null;
            if (legacyId) activeList.push(legacyId);
          }

          if (activeList.length > 0 && pkgId && !activeList.includes(pkgId)) {
            // This job belongs to a non-active package — defer it
            if (job.provider && LLM_JOB_TYPES.has(job.job_type)) {
              await releaseProviderSlot(admin, job.provider);
              slotReleased = true;
            }
            try {
              await admin.rpc("defer_job", {
                p_job_id: job.id,
                p_delay_seconds: 300,
                p_reason: `WIP=N: active=[${activeList.map(id => id.slice(0, 8)).join(',')}], job_package=${pkgId.slice(0, 8)}`,
              });
            } catch { /* ignore */ }
            results.push({ id: job.id, job_type: job.job_type, outcome: "deferred_wip", provider: job.provider });
            continue;
          }
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

        const latencyMs = Date.now() - jobStartMs;

        // ─── Release provider slot on completion (guaranteed by finally) ───
        if (job.provider && LLM_JOB_TYPES.has(job.job_type)) {
          await releaseProviderSlot(admin, job.provider);
          slotReleased = true;
        }

        if (response.ok) {
          const rd = responseData as Record<string, unknown>;

          // Log success usage + cost ledger
          if (job.provider) {
            await logProviderUsage(admin, job.provider, job.job_type, true, latencyMs);
            await logJobCost(admin, job, job.provider, latencyMs, responseData);
          }

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
                provider: "auto",
              })
              .eq("id", job.id);
            results.push({ id: job.id, job_type: job.job_type, outcome: "batch_continue", provider: job.provider });
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

            results.push({ id: job.id, job_type: job.job_type, outcome: "completed", provider: job.provider });
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
                provider: "auto", // Re-evaluate provider on retry
              })
              .eq("id", job.id);
            results.push({ id: job.id, job_type: job.job_type, outcome: "retry_prereq" });
          }
        } else {
          // ─── TRIAGE-DRIVEN FAILURE HANDLING with provider health update ───
          const errorMsg = typeof responseData === "object" && responseData !== null && "error" in responseData
            ? String((responseData as { error: unknown }).error)
            : `HTTP ${response.status}: ${responseText.slice(0, 200)}`;

          // Log failure usage
          const category = classifyError(errorMsg, response.status, policy);
          if (job.provider) {
            await logProviderUsage(admin, job.provider, job.job_type, false, latencyMs, 0, 0, category);
          }

          // Mark provider rate-limited if 429 (exponential cooldown now handles escalation)
          if (response.status === 429 && job.provider) {
            await markProviderRateLimited(admin, job.provider, 120, errorMsg);
            console.warn(`[Runner:${RUNNER_ID}] 🔴 Provider ${job.provider} rate-limited → exponential cooldown`);
          } else if (response.status === 503 && job.provider) {
            await markProviderRateLimited(admin, job.provider, 300, errorMsg);
            console.warn(`[Runner:${RUNNER_ID}] 🔴 Provider ${job.provider} unavailable → exponential cooldown`);
          }

          const outcome = await handleJobFailureWithTriage(admin, job, errorMsg, response.status, policy);
          results.push({ id: job.id, job_type: job.job_type, outcome, provider: job.provider });
        }
      } catch (execErr: unknown) {
        const errorMsg = execErr instanceof Error ? execErr.message : String(execErr);

        // Log failure usage
        if (job.provider) {
          await logProviderUsage(admin, job.provider, job.job_type, false, Date.now() - jobStartMs, 0, 0, "RUNTIME_ERROR");
        }

        // Detect timeout/network errors → mark provider
        if (job.provider && (errorMsg.includes("timeout") || errorMsg.includes("ETIMEDOUT"))) {
          await markProviderRateLimited(admin, job.provider, 60, errorMsg);
        }

        const outcome = await handleJobFailureWithTriage(admin, job, `Runtime: ${errorMsg}`, 0, policy);
        results.push({ id: job.id, job_type: job.job_type, outcome, provider: job.provider });
      } finally {
        // ─── SLOT-LEAK PROTECTION: Always release slot ───
        if (!slotReleased && job.provider && LLM_JOB_TYPES.has(job.job_type)) {
          await releaseProviderSlot(admin, job.provider);
          console.log(`[Runner:${RUNNER_ID}] 🔒 Finally-released slot for ${job.provider}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        runner: RUNNER_ID,
        processed: results.length,
        results,
        pending: bp.pendingCount,
        backpressure: bp.throttle ? "throttled" : bp.warn ? "warning" : "ok",
        providers: providerLog,
      }),
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
  policy: TriagePolicy | null
): Promise<string> {
  const category = classifyError(errorMsg, httpStatus, policy);
  const actionDef = policy?.actions?.[category];
  const newAttempts = job.attempts + 1;
  const provider = job.provider || DEFAULT_LLM_PROVIDER;
  const now = new Date().toISOString();

  console.log(`[Runner:${RUNNER_ID}] Triage ${job.id.slice(0, 8)}: ${category} (attempt ${newAttempts}) @${provider}`);

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

  // ─── TRANSIENT FAILURES → retry with backoff + auto-provider switch ──
  const maxAttempts = getMaxAttempts(category, policy, job.max_attempts);

  if (newAttempts >= maxAttempts) {
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

  // On transient errors, always set provider to 'auto' so next attempt picks best available
  const shouldAutoRoute = ["RATE_LIMIT", "TIMEOUT", "TRANSIENT_NETWORK"].includes(category) && LLM_JOB_TYPES.has(job.job_type);
  const newProvider = shouldAutoRoute ? "auto" : provider;

  if (shouldAutoRoute) {
    console.log(`[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} → auto-route on retry (was ${provider}, ${category})`);
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
    fallback_count: (job.fallback_count ?? 0) + (shouldAutoRoute ? 1 : 0),
  };

  if (category === "RATE_LIMIT") {
    updatePayload.rate_limited_until = scheduledAt;
  }

  await admin.from("job_queue").update(updatePayload).eq("id", job.id);

  console.log(`[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} → ${category} retry #${newAttempts} in ${delaySec}s (provider: ${newProvider})`);
  return `retry_${category.toLowerCase()}`;
}
