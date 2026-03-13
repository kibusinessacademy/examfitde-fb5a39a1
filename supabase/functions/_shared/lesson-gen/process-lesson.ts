/**
 * lesson-gen/process-lesson.ts — Main orchestrator
 * Reads like a clean pipeline. All implementation details are in sub-modules.
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

  // ── 2. Idempotency check ──
  const idem = await checkIdempotency(sb, lessonId, stepKey, stepKeyRaw, json);
  if (idem.skip) return idem.response!;

  // ── 3. Load data ──
  const loaded = await loadLessonGenerationData(sb, req, json);
  if ("error" in loaded) return loaded.error;
  const data = loaded.data;

  // ── 4. Build context ──
  const ctx = await buildLessonGenerationContext(sb, data, curriculumId);

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

  // ── 8. Execute LLM ──
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
