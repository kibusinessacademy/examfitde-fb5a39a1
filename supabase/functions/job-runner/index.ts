import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Runner instance ID for lock ownership
const RUNNER_ID = crypto.randomUUID().slice(0, 8);

// Lock timeout: if a job is locked for more than this, it's considered stale
const LOCK_TIMEOUT_SECONDS = 300; // 5 minutes

// Max jobs per invocation (stay under edge function timeout)
const BATCH_SIZE = 5;

/**
 * Maps job_type → Edge Function name.
 * SSOT: every valid job_type MUST be listed here.
 */
const JOB_TYPE_MAP: Record<string, string> = {
  // Curriculum & Course Pipeline
  extract_curriculum: "extract-curriculum",
  generate_course: "generate-course",
  generate_course_batch: "generate-course-batch",
  seed_exam_questions: "generate-blueprint-questions",
  enrich_exam_solutions: "blooms-taxonomy",
  upgrade_minichecks_v1: "regenerate-minichecks",
  
  // Quality Gates
  quality_gate_precheck: "run-quality-checks",
  curriculum_smoke: "run-quality-checks",
  qc_worker_full: "qc-worker",
  quality_gate_7: "quality-gate-check",
  
  // SEO Pipeline
  seo_foundation: "generate-seo-slug",
  seo_audit: "ihk-quality-audit",
  seo_internal_links: "seo-internal-linker",
  seo_sitemap_refresh: "generate-sitemap",
  seo_generate: "seo-generate",
  seo_qc_check: "seo-qc-check",
  seo_publish: "seo-publish",
  seo_content_batch: "seo-generate",
  
  // Product Lifecycle
  publish_product: "product-orchestrator",
  
  // Repair / Improve / Upgrade
  repair_lessons: "repair-lessons",
  improve_lesson: "improve-lesson",
  validate_content: "validate-content",
  upgrade_ihk: "course-upgrade-ihk",
  
  // Assessment Council (Council 4)
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

  // AutoPilot Final Gate
  course_finalize: "course-finalizer",
  post_validation: "post-validation",

  // Council v2 Deliberative Architecture
  council_run_step: "council-run-step",
  council_propose_step: "council-worker",
  council_critique_step: "council-worker",
  council_revise_step: "council-worker",
  council_vote_and_verdict: "council-worker",
  council_publish_step: "council-worker",
  council_recompute_course_ready: "council-worker",

  // Tech Council (Security & Infrastructure Governance)
  tech_scan_rls: "tech-council-run",
  tech_scan_edge: "tech-council-run",
  tech_scan_queue: "tech-council-run",
  tech_propose_patch: "tech-council-run",
  tech_validate_patch: "tech-council-run",
  tech_full_pipeline: "tech-council-run",

  // Marketing & SEO Council (Council 3)
  marketing_seed_assets: "marketing-council-run",
  marketing_propose: "marketing-council-run",
  marketing_critique: "marketing-council-run",
  marketing_revise: "marketing-council-run",
  marketing_verdict: "marketing-council-run",
  marketing_publish: "marketing-council-run",
  marketing_full_pipeline: "marketing-council-run",

  // Tutor Council (Council 5)
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

  // Compliance & Data Protection Council (Council 6)
  compliance_scan: "compliance-council-scan",
  compliance_scan_pii: "compliance-council-scan",
  compliance_scan_rls: "compliance-council-scan",
  compliance_scan_retention: "compliance-council-scan",
  compliance_scan_ai_act: "compliance-council-scan",
  compliance_scan_azav: "compliance-council-scan",
  compliance_recompute_block: "compliance-council-scan",
};

// Non-retryable error patterns (SSOT violations, missing data)
const PERMANENT_FAILURE_PATTERNS = [
  "SSOT_VIOLATION",
  "INVALID_PAYLOAD",
  "Missing curriculum_id",
  "Invalid curriculum_id",
  "not found",
  "SSOT Guard",
];

function isPermanentFailure(error: string): boolean {
  return PERMANENT_FAILURE_PATTERNS.some((p) =>
    error.toUpperCase().includes(p.toUpperCase())
  );
}

interface JobRecord {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  priority: number;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1) Clean stale locks (jobs locked longer than LOCK_TIMEOUT_SECONDS)
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

    // 2) Fetch eligible pending jobs (ordered by priority, then creation)
    const { data: pendingJobs, error: fetchErr } = await admin
      .from("job_queue")
      .select("id, job_type, payload, attempts, max_attempts, priority")
      .eq("status", "pending")
      .lte("run_after", now)
      .is("locked_by", null)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) {
      console.error("[Runner] Fetch error:", fetchErr.message);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers,
      });
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending jobs", runner: RUNNER_ID }),
        { status: 200, headers }
      );
    }

    // Claim each job individually (atomic lock)
    const claimed: JobRecord[] = [];
    for (const job of pendingJobs as JobRecord[]) {
      const { data: locked, error: lockErr } = await admin
        .from("job_queue")
        .update({
          status: "processing",
          locked_at: now,
          locked_by: RUNNER_ID,
          started_at: now,
          updated_at: now,
        })
        .eq("id", job.id)
        .eq("status", "pending")
        .is("locked_by", null)
        .select("id")
        .maybeSingle();

      if (!lockErr && locked) {
        claimed.push(job);
      }
    }
    if (claimed.length === 0) {
      return new Response(
        JSON.stringify({ message: "No jobs claimed (all locked by others)", runner: RUNNER_ID }),
        { status: 200, headers }
      );
    }

    console.log(
      `[Runner:${RUNNER_ID}] Claimed ${claimed.length} jobs: ${claimed.map((j: JobRecord) => j.job_type).join(", ")}`
    );

    const results: Array<{ id: string; job_type: string; outcome: string }> = [];

    // 3) Process each job
    for (const job of claimed as JobRecord[]) {
      const functionName = JOB_TYPE_MAP[job.job_type];

      if (!functionName) {
        // Unknown job type → permanent failure
        await admin
          .from("job_queue")
          .update({
            status: "failed",
            error: `Unknown job_type: "${job.job_type}" – no mapping in JOB_TYPE_MAP`,
            last_error: `Unknown job_type: "${job.job_type}"`,
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
        // Invoke the target Edge Function
        const functionUrl = `${SUPABASE_URL}/functions/v1/${functionName}`;
        console.log(
          `[Runner:${RUNNER_ID}] Executing job ${job.id.slice(0, 8)} → ${functionName}`
        );

        // Normalize payload: ensure both camelCase and snake_case keys exist
        const normalized = { ...job.payload };
        if (normalized.courseId && !normalized.course_id) normalized.course_id = normalized.courseId;
        if (normalized.course_id && !normalized.courseId) normalized.courseId = normalized.course_id;
        if (normalized.curriculumId && !normalized.curriculum_id) normalized.curriculum_id = normalized.curriculumId;
        if (normalized.curriculum_id && !normalized.curriculumId) normalized.curriculumId = normalized.curriculum_id;

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
          // Success
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
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          results.push({ id: job.id, job_type: job.job_type, outcome: "completed" });
        } else {
          // Function returned error
          const errorMsg = typeof responseData === "object" && responseData !== null && "error" in responseData
            ? String((responseData as { error: unknown }).error)
            : `HTTP ${response.status}: ${responseText.slice(0, 200)}`;

          await handleJobFailure(admin, job, errorMsg);
          results.push({
            id: job.id,
            job_type: job.job_type,
            outcome: isPermanentFailure(errorMsg) ? "failed_permanent" : "failed_retry",
          });
        }
      } catch (execErr: unknown) {
        const errorMsg = execErr instanceof Error ? execErr.message : String(execErr);
        await handleJobFailure(admin, job, `Runtime: ${errorMsg}`);
        results.push({ id: job.id, job_type: job.job_type, outcome: "failed_runtime" });
      }
    }

    return new Response(
      JSON.stringify({
        runner: RUNNER_ID,
        processed: results.length,
        results,
      }),
      { status: 200, headers }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Runner] Fatal error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
  }
});

/**
 * Handles a job failure: decides between retry and permanent failure.
 */
async function handleJobFailure(
  admin: ReturnType<typeof createClient>,
  job: JobRecord,
  errorMsg: string
) {
  const newAttempts = job.attempts + 1;
  const permanent = isPermanentFailure(errorMsg) || newAttempts >= job.max_attempts;

  if (permanent) {
    console.warn(
      `[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} PERMANENTLY FAILED: ${errorMsg.slice(0, 100)}`
    );
    await admin
      .from("job_queue")
      .update({
        status: "failed",
        error: errorMsg.slice(0, 2000),
        last_error: errorMsg.slice(0, 500),
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
    
    console.log(
      `[Runner:${RUNNER_ID}] Job ${job.id.slice(0, 8)} retry #${newAttempts} in ${backoffSeconds}s`
    );
    await admin
      .from("job_queue")
      .update({
        status: "pending",
        last_error: errorMsg.slice(0, 500),
        attempts: newAttempts,
        run_after: runAfter,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  }
}
