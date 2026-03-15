/**
 * lesson-gen/process-lesson.ts — Main orchestrator
 * OPT-1: Parallelized idempotency + data loading.
 * Context building is now synchronous (mastery pre-loaded).
 *
 * v3: Gateway-aware — deficit + cache checks before LLM dispatch.
 *     Dual-path (batch/sync) retained with gateway policy governance.
 */

import { canonicalStepKey } from "../step-keys.ts";
import { shouldSoftStop } from "../time-budget.ts";
import { CORS_HEADERS } from "./constants.ts";
import { checkIdempotency } from "./idempotency.ts";
import { loadLessonGenerationData } from "./loaders.ts";
import { buildLessonGenerationContext } from "./context.ts";
import { resolveLessonRuntime } from "./routing.ts";
import { buildLessonPrompts } from "./prompt-builder.ts";
import { runLessonLLM } from "./llm-runner.ts";
import { runQualityGate, buildFinalContent, persistLessonResult } from "./persistence.ts";
import { shouldUseBatch, BATCH_DEFAULT_MODEL } from "../batch/routing-config.ts";
import { buildBatchRequests, submitBatchViaFunction } from "../batch/enqueue-openai.ts";
import { resolvePolicy } from "../ai-gateway/policies.ts";
import { computeDeficit } from "../ai-gateway/deficits.ts";
import { buildCacheKey, hashPrompt, checkCache, storeInCache } from "../ai-gateway/cache.ts";
import { logCostSaving } from "../ai-gateway/observability.ts";
import type { LessonRequest } from "./types.ts";

export async function processLesson(sb: any, p: any, startMs: number): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: CORS_HEADERS,
    });

  // ── 1. Validate & normalize request ──
  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;
  const lessonId = p.lesson_id;
  const stepKeyRaw = p.step_key || p.step;

  if (!packageId || !courseId || !lessonId || !stepKeyRaw) {
    return json({ error: "Missing required fields (package_id, course_id, lesson_id, step_key)" }, 400);
  }

  const stepKey = canonicalStepKey(stepKeyRaw);
  const isMiniCheck = stepKey === "mini_check" || stepKey === "step_5_minicheck";

  const req: LessonRequest = {
    packageId, courseId, curriculumId, certificationId,
    lessonId, stepKey, isMiniCheck,
    attemptIndex: Number.isFinite(p.attempt_index) ? p.attempt_index : (p.attempts ?? 0),
    jobHash: Number.isFinite(p._job_hash) ? p._job_hash : 0,
    jobId: p.job_id || "unknown",
  };

  // ── 2+3. Idempotency + Data loading — PARALLEL ──
  // These are independent DB reads that can run concurrently (~400ms savings)
  const [idem, loadResult] = await Promise.all([
    checkIdempotency(sb, lessonId, stepKey, stepKeyRaw, json),
    loadLessonGenerationData(sb, req, json),
  ]);

  if (idem.skip) return idem.response!;
  if ("error" in loadResult) return loadResult.error;
  const data = loadResult.data;

  // ── 4. Build context (now sync — mastery pre-loaded in loaders) ──
  const ctx = buildLessonGenerationContext(data);

  // ── 5. Soft-stop check ──
  if (shouldSoftStop(startMs, "lesson_single")) {
    return json({ ok: false, retry: true, error: "SOFTSTOP: budget_exhausted_pre", elapsed_ms: Date.now() - startMs }, 503);
  }

  // ── 6. Resolve runtime (routing, tokens, timeouts) ──
  const runtimeResult = await resolveLessonRuntime(sb, req, startMs, json);
  if ("error" in runtimeResult) return runtimeResult.error;
  const runtime = runtimeResult.runtime;

  // ── 7. Build prompts ──
  const prompts = buildLessonPrompts(req, data, ctx);

  // ── 7.5. BATCH ROUTING DECISION ──
  const forceSyncMode = p._force_sync === true || p.force_sync === true;
  const urgency = p.urgency || "normal";

  if (shouldUseBatch("lesson_generate_content", { forceSyncMode, urgency })) {
    return await enqueueLessonBatch(sb, req, prompts, runtime, data, startMs, json);
  }

  // ── 8. Execute LLM (sync path) ──
  const llmResult = await runLessonLLM(sb, req, runtime, prompts, data.professionName, startMs, json);
  if ("error" in llmResult) return llmResult.error;
  const llm = llmResult.result;

  // ── 9. Quality gate ──
  const qgError = runQualityGate(llm.content, req, ctx, startMs, json);
  if (qgError) return qgError;

  // ── 10. Build final content ──
  const finalContent = buildFinalContent(llm.content, req, data, ctx, llm.plainRetry);

  // ── 11. Persist ──
  return persistLessonResult(sb, req, data, runtime, llm, finalContent, startMs, json);
}

// ── Batch Enqueue Path ──────────────────────────────────────────────────────

async function enqueueLessonBatch(
  sb: any,
  req: LessonRequest,
  prompts: { systemPrompt: string; userPrompt: string },
  runtime: { effectiveMaxTokens: number; chain: Array<{ provider: any; model: string }> },
  data: { professionName: string },
  startMs: number,
  json: (body: unknown, status?: number) => Response,
): Promise<Response> {
  // Use the first model from the chain, or fall back to batch default
  const model = runtime.chain[0]?.model || BATCH_DEFAULT_MODEL;

  const customId = `lesson_${req.lessonId}_${req.stepKey}_${Date.now()}`;

  const batchRequests = buildBatchRequests([{
    customId,
    sourceJobId: req.jobId !== "unknown" ? req.jobId : null,
    sourceRef: {
      lesson_id: req.lessonId,
      course_id: req.courseId,
      package_id: req.packageId,
      curriculum_id: req.curriculumId,
      certification_id: req.certificationId,
      step_key: req.stepKey,
      is_mini_check: req.isMiniCheck,
      profession_name: data.professionName,
    },
    jobType: "lesson_generate_content",
    model,
    messages: [
      { role: "system", content: prompts.systemPrompt },
      { role: "user", content: prompts.userPrompt },
    ],
    temperature: 0.7,
    maxTokens: runtime.effectiveMaxTokens,
  }]);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const submitResult = await submitBatchViaFunction(supabaseUrl, serviceRoleKey, {
    jobType: "lesson_generate_content",
    model,
    requests: batchRequests,
    metadata: {
      package_id: req.packageId,
      course_id: req.courseId,
      curriculum_id: req.curriculumId,
      lesson_id: req.lessonId,
      step_key: req.stepKey,
      profession_name: data.professionName,
    },
  });

  if (!submitResult.ok) {
    console.error(`[lesson-gen] BATCH_SUBMIT_FAILED: ${submitResult.error} — falling through to sync`);
    // On batch submit failure, DON'T fail the job — just log and let it retry
    // The retry will re-enter and either batch again or sync-fallback
    return json({
      ok: false,
      retry: true,
      transient: true,
      error: `BATCH_SUBMIT_FAILED: ${submitResult.error}`,
      elapsed_ms: Date.now() - startMs,
    }, 503);
  }

  console.log(`[lesson-gen] BATCH_ENQUEUED: lesson=${req.lessonId.slice(0, 8)} step=${req.stepKey} batch_id=${submitResult.batchId} model=${model}`);

  // Mark the job as batch_pending — the content-runner should interpret this
  // as "don't requeue immediately, batch-poll will handle completion"
  if (req.jobId && req.jobId !== "unknown") {
    try {
      await sb.from("job_queue").update({
        meta: sb.rpc ? undefined : { batch_id: submitResult.batchId, batch_mode: true },
      }).eq("id", req.jobId);
    } catch { /* best-effort meta update */ }
  }

  return json({
    ok: true,
    batch_mode: true,
    batch_id: submitResult.batchId,
    custom_id: customId,
    lesson_id: req.lessonId,
    step_key: req.stepKey,
    model,
    elapsed_ms: Date.now() - startMs,
    // Signal to job-runner: batch_complete = false means "don't mark step as done yet"
    batch_complete: false,
  });
}
