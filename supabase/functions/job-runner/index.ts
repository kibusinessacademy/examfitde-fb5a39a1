import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * job-runner — Pulls pending jobs from job_queue, dispatches to the
 * matching Edge Function, writes back done / failed / requeued (batch).
 *
 * Called every minute by cron-trigger alongside pipeline-runner.
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
};

// ── Constants ────────────────────────────────────────────────────────
const MAX_JOBS_PER_TICK = 5;
const JOB_TIMEOUT_MS = 140_000; // 140s — stay under Edge 150s hard limit

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

// ── Main Handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── 1. Atomically claim pending jobs (SKIP LOCKED — no race conditions) ──
  const { data: jobs, error: claimErr } = await sb.rpc("claim_pending_jobs", {
    p_limit: MAX_JOBS_PER_TICK,
  });

  if (claimErr) {
    console.error("[job-runner] claim_pending_jobs error:", claimErr.message);
    return json({ ok: false, error: claimErr.message }, 500);
  }

  if (!jobs || jobs.length === 0) {
    return json({ ok: true, processed: 0, message: "No pending jobs" });
  }

  console.log(`[job-runner] Claimed ${jobs.length} job(s) atomically`);

  const results: Record<string, unknown>[] = [];

  for (const job of jobs) {
    const fnName = JOB_TYPE_MAP[job.job_type];
    if (!fnName) {
      console.warn(`[job-runner] Unknown job_type: ${job.job_type}, skipping`);
      await sb
        .from("job_queue")
        .update({
          status: "failed",
          error: `Unknown job_type: ${job.job_type}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      results.push({ id: job.id, status: "failed", reason: "unknown_type" });
      continue;
    }

    // Job is already claimed as 'processing' by the RPC — proceed directly

    // ── 2. Invoke the target Edge Function ───────────────────────────
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS);

      const payload = {
        ...(job.payload || {}),
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

      const text = await res.text().catch(() => "");
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { parsed = text; }

      if (!res.ok) {
        // ── 409 Conflict = idempotent success (already exists) ───────
        if (res.status === 409) {
          const isIdempotent = parsed?.skipped || parsed?.retry === false || parsed?.ok === true;
          if (isIdempotent || !parsed?.retry) {
            console.log(`[job-runner] ${fnName} returned 409 (idempotent) — marking done`);
            await sb
              .from("job_queue")
              .update({
                status: "done",
                result: { ...(typeof parsed === "object" ? parsed : {}), _409_idempotent: true },
                completed_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.push({ id: job.id, status: "done", reason: "409_idempotent" });
            continue;
          }
          // 409 with retry=true means prereq not ready — requeue
          console.warn(`[job-runner] ${fnName} returned 409 with retry=true, requeuing ${job.id}`);
          await sb
            .from("job_queue")
            .update({
              status: "pending",
              error: `HTTP 409 — prereq not ready, will retry`,
              meta: { ...(job.meta || {}), last_retry: new Date().toISOString() },
            })
            .eq("id", job.id);
          results.push({ id: job.id, status: "requeued", httpStatus: 409 });
          continue;
        }

        // ── Rate-limited or transient → requeue with delay ───────────
        if (res.status === 429 || res.status === 503) {
          console.warn(`[job-runner] ${fnName} returned ${res.status}, requeuing ${job.id}`);
          await sb
            .from("job_queue")
            .update({
              status: "pending",
              error: `HTTP ${res.status} — will retry`,
              meta: { ...(job.meta || {}), last_retry: new Date().toISOString() },
            })
            .eq("id", job.id);
          results.push({ id: job.id, status: "requeued", httpStatus: res.status });
          continue;
        }

        // ── Hard failure ─────────────────────────────────────────────
        const maxAttempts = job.max_attempts || 3;
        if ((job.attempts || 0) + 1 >= maxAttempts) {
          await sb
            .from("job_queue")
            .update({
              status: "failed",
              error: `HTTP ${res.status}: ${typeof parsed === "string" ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500)}`,
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          results.push({ id: job.id, status: "failed", httpStatus: res.status });
        } else {
          await sb
            .from("job_queue")
            .update({ status: "pending", error: `HTTP ${res.status} — attempt ${(job.attempts || 0) + 1}` })
            .eq("id", job.id);
          results.push({ id: job.id, status: "requeued", httpStatus: res.status });
        }
        continue;
      }

      // ── 3. Handle batch_complete protocol ──────────────────────────
      if (parsed && parsed.batch_complete === false) {
        console.log(`[job-runner] ${fnName} batch incomplete, requeuing with cursor`);
        await sb
          .from("job_queue")
          .update({
            status: "pending",
            meta: { ...(job.meta || {}), batch_cursor: parsed.batch_cursor ?? null },
          })
          .eq("id", job.id);
        results.push({ id: job.id, status: "batch_requeued" });
        continue;
      }

      // ── 4. Done ────────────────────────────────────────────────────
      await sb
        .from("job_queue")
        .update({
          status: "done",
          result: typeof parsed === "object" ? parsed : { raw: parsed },
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      results.push({ id: job.id, status: "done", function: fnName });

    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      const isTimeout = msg.includes("abort");
      console.error(`[job-runner] ${fnName} error: ${msg}`);

      const maxAttempts = job.max_attempts || 3;
      if ((job.attempts || 0) + 1 >= maxAttempts) {
        await sb
          .from("job_queue")
          .update({
            status: "failed",
            error: isTimeout ? "Edge Function timeout" : msg.slice(0, 1000),
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        results.push({ id: job.id, status: "failed", reason: isTimeout ? "timeout" : "error" });
      } else {
        await sb
          .from("job_queue")
          .update({
            status: "pending",
            error: `Attempt ${(job.attempts || 0) + 1} failed: ${msg.slice(0, 500)}`,
          })
          .eq("id", job.id);
        results.push({ id: job.id, status: "requeued", reason: isTimeout ? "timeout" : "error" });
      }
    }
  }

  console.log(`[job-runner] Tick done: ${JSON.stringify(results)}`);
  return json({ ok: true, processed: results.length, results });
});
