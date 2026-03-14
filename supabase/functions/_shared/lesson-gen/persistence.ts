/**
 * lesson-gen/persistence.ts — Save content versions, cleanup, audit, cost logging
 * OPT-2: Audit, cost-log, cleanup run in parallel after insert.
 */

import { logLLMCostEvent } from "../ai-client.ts";
import { canonicalStepKey } from "../step-keys.ts";
import { runV2QualityGate } from "../prompt-kit.ts";
import { STEP_PROMPTS, STEP_BLOOM_MAP } from "../lesson-gen-prompts.ts";
import { MIN_PERSIST_MS, PLATFORM_HARD_LIMIT_MS } from "./constants.ts";
import type { LessonRequest, LessonData, LessonContext, LessonRuntime, LlmResult } from "./types.ts";

/**
 * Run quality gate on content.
 */
export function runQualityGate(
  content: any,
  req: LessonRequest,
  ctx: LessonContext,
  startMs: number,
  json: (body: unknown, status?: number) => Response,
): Response | null {
  if (!req.isMiniCheck && content.html) {
    const v2Result = runV2QualityGate(content.html, req.stepKey, ctx.difficultyLevel);
    if (v2Result.hallucinationRisk.verdict === "regenerate") {
      return json({
        ok: false, retry: true,
        error: `HALLUCINATION_RISK: ${v2Result.hallucinationRisk.riskScore}`,
        elapsed_ms: Date.now() - startMs,
      }, 503);
    }

    const stepConfig = STEP_PROMPTS[req.stepKey] || STEP_PROMPTS.verstehen;
    const charCount = content.html.length;
    const minChars = stepConfig.minChars || 400;
    if (charCount < minChars) {
      return json({
        ok: false, retry: true,
        error: `Content too short: ${charCount}/${minChars} chars`,
        elapsed_ms: Date.now() - startMs,
      }, 503);
    }
  }
  return null;
}

/**
 * Build the final content payload for persistence.
 */
export function buildFinalContent(
  content: any,
  req: LessonRequest,
  data: LessonData,
  ctx: LessonContext,
  plainRetry: boolean,
): any {
  const bloomLevel = STEP_BLOOM_MAP[req.stepKey] || "understand";
  const lfWeightPct = data.lfData?.weight_percent || 0;
  const examRelevanceScore = Math.min(5, Math.max(1,
    Math.round((lfWeightPct > 15 ? 4 : lfWeightPct > 10 ? 3 : 2) + (ctx.difficultyLevel === "hard" ? 1 : 0))
  ));

  if (req.isMiniCheck) {
    const enrichedQuestions = Array.isArray(content.questions)
      ? content.questions.map((q: any) => ({
          question: q.question || q.question_text || "",
          options: q.options || [],
          correct_answer: q.correct_answer ?? q.correctIndex ?? 0,
          explanation: q.explanation || "",
          difficulty: q.difficulty || "mittel",
          bloom_level: q.bloom_level || "apply",
          trap_type: q.trap_type || null,
        }))
      : content.questions;

    return {
      type: "mini_check",
      questions: enrichedQuestions,
      objectives: content.objectives,
      bloom_level: "apply",
      exam_relevance_score: examRelevanceScore,
      competency_id: (data.lesson as any).competency_id || null,
      learning_field_id: data.lfId || null,
      generated_at: new Date().toISOString(),
      version: 6,
    };
  }

  return {
    type: "text",
    html: content.html,
    objectives: content.objectives || [],
    key_terms: content.key_terms || [],
    common_mistakes: content.common_mistakes || [],
    exam_triggers: content.exam_triggers || [],
    transfer_questions: content.transfer_questions || [],
    bloom_level: bloomLevel,
    exam_relevance_score: examRelevanceScore,
    step: req.stepKey,
    competency_id: (data.lesson as any).competency_id || null,
    learning_field_id: data.lfId || null,
    mastery_weight: lfWeightPct > 15 ? "high" : lfWeightPct > 10 ? "medium" : "low",
    generated_at: new Date().toISOString(),
    version: 5,
    meta: { plain_retry: plainRetry },
  };
}

/**
 * Persist content version, sync to lesson, cleanup checkpoint, audit + cost log.
 * OPT-2: After the critical insert, all side-effects run in parallel.
 */
export async function persistLessonResult(
  sb: any,
  req: LessonRequest,
  data: LessonData,
  runtime: LessonRuntime,
  llm: LlmResult,
  finalContent: any,
  startMs: number,
  json: (body: unknown, status?: number) => Response,
): Promise<Response> {
  // Pre-persist budget check
  const prePersistRemaining = PLATFORM_HARD_LIMIT_MS - (Date.now() - startMs);
  if (prePersistRemaining < MIN_PERSIST_MS) {
    console.warn(`[lesson-gen] SOFTSTOP pre-persist: only ${prePersistRemaining}ms left.`);
    return json({
      ok: false, retry: true,
      error: `SOFTSTOP: pre_persist_budget (remaining=${prePersistRemaining}ms)`,
      elapsed_ms: Date.now() - startMs,
    }, 503);
  }

  const stepKeyCanonical = canonicalStepKey(req.stepKey);

  // ── Critical path: Insert content version (must succeed) ──
  const { data: newVersion, error: vErr } = await sb.from("content_versions").insert({
    course_id: req.courseId,
    lesson_id: req.lessonId,
    step_key: stepKeyCanonical,
    content_json: finalContent,
    created_by_agent: "lesson-generate-content",
    status: "approved",
    council_round: 1,
    entity_type: req.isMiniCheck ? "minicheck" : "lesson_step",
    published_at: new Date().toISOString(),
    published_by: "pipeline-auto-approve",
  }).select("id").single();

  if (vErr) {
    if (vErr.message?.includes("idx_cv_idempotency") || vErr.code === "23505") {
      return json({ ok: true, skipped: true, reason: "deduped_on_persist" });
    }
    const isConstraint = vErr.code?.startsWith("23");
    return json({
      ok: false, retry: !isConstraint, transient: !isConstraint,
      error: `persist_failed: ${vErr.message?.slice(0, 150)}`,
      elapsed_ms: Date.now() - startMs,
    }, isConstraint ? 500 : 503);
  }

  // ── OPT-2: All side-effects in parallel (fire-and-await-all) ──
  // These are independent: sync, cleanup, audit, cost-log
  // Note: Supabase query builders are Thenables, not Promises — wrap in async for .catch()
  await Promise.all([
    // Direct sync to lessons.content
    (async () => {
      try {
        await sb.rpc("pipeline_write_lesson_content", { p_lesson_id: req.lessonId, p_content: finalContent });
      } catch (_syncErr: unknown) {
        console.warn(`[lesson-gen] direct sync fallback failed for ${req.lessonId.slice(0, 8)}: ${(_syncErr as Error)?.message?.slice(0, 100)}`);
      }
    })(),

    // Cleanup checkpoint
    (async () => {
      try {
        await sb.from("content_versions")
          .delete()
          .eq("lesson_id", req.lessonId)
          .eq("step_key", stepKeyCanonical)
          .eq("created_by_agent", "lesson-gen-checkpoint")
          .eq("status", "draft");
      } catch { /* best-effort */ }
    })(),

    // Audit: council message
    (async () => {
      try {
        await sb.from("council_messages").insert({
          content_version_id: newVersion!.id,
          agent_name: "lesson-generate-content",
          message_type: "proposal",
          message_json: {
            source: "single-unit-worker",
            profession: data.professionName,
            used_provider: llm.result.provider,
            used_model: llm.result.model,
            plain_retry: llm.plainRetry,
            autopilot: runtime.autopilotAction,
          },
        });
      } catch (e: unknown) {
        console.warn(`[lesson-gen] council_message insert failed: ${(e as Error)?.message?.slice(0, 100)}`);
      }
    })(),

    // Cost logging
    (async () => {
      try {
        await logLLMCostEvent(sb, {
          job_type: "lesson_generate_content",
          provider: llm.result.provider,
          model: llm.result.model,
          tokens_in: llm.result.usage?.input_tokens || 0,
          tokens_out: llm.result.usage?.output_tokens || 0,
          package_id: req.packageId,
          certification_id: req.certificationId,
          course_id: req.courseId,
          estimatedUsage: llm.result.estimatedUsage,
          meta: {
            plain_retry: llm.plainRetry,
            step_key: req.stepKey,
            autopilot: runtime.autopilotAction,
            attempt_index: req.attemptIndex,
          },
        });
      } catch (e: unknown) {
        console.warn(`[lesson-gen] cost_log failed: ${(e as Error)?.message?.slice(0, 100)}`);
      }
    })(),
  ]);

    // Cost logging
    logLLMCostEvent(sb, {
      job_type: "lesson_generate_content",
      provider: llm.result.provider,
      model: llm.result.model,
      tokens_in: llm.result.usage?.input_tokens || 0,
      tokens_out: llm.result.usage?.output_tokens || 0,
      package_id: req.packageId,
      certification_id: req.certificationId,
      course_id: req.courseId,
      estimatedUsage: llm.result.estimatedUsage,
      meta: {
        plain_retry: llm.plainRetry,
        step_key: req.stepKey,
        autopilot: runtime.autopilotAction,
        attempt_index: req.attemptIndex,
      },
    }).catch((e: Error) => {
      console.warn(`[lesson-gen] cost_log failed: ${e?.message?.slice(0, 100)}`);
    }),
  ]);

  return json({
    ok: true,
    package_id: req.packageId,
    lesson_id: req.lessonId,
    step_key: req.stepKey,
    version_id: newVersion!.id,
    provider: llm.result.provider,
    model: llm.result.model,
    used_provider: llm.result.provider,
    used_model: llm.result.model,
    plain_retry: llm.plainRetry,
    autopilot: runtime.autopilotAction,
    elapsed_ms: Date.now() - startMs,
    llm_timeout_ms: runtime.llmTimeoutMs,
    chars: req.isMiniCheck ? undefined : llm.content.html?.length,
  });
}
